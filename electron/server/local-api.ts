import http from 'http';
import { app, BrowserWindow } from 'electron';
import { WebSocketServer, WebSocket } from 'ws';
import { DownloadManager } from '../engine/download-manager';
import { VideoStreamDownloader } from '../engine/video-stream-downloader';

const MAX_BODY = 1024 * 1024;
const EXTENSION_ORIGIN = /^(chrome-extension|moz-extension|safari-web-extension|extension):\/\/[a-z0-9._-]+$/i;

/**
 * Local bridge for the browser extension. Only the extension (or a local tool
 * that sends no Origin) may call it: ordinary web pages are rejected, so a site
 * you visit cannot start downloads or write files on your machine.
 */
export class LocalApiService {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private downloadManager: DownloadManager;
  private port: number;
  private mainWindow: BrowserWindow | null = null;
  private onShowDialog: ((data: any) => void) | null = null;
  /** True once the bridge is listening; false if the port is taken. */
  public listening = false;

  constructor(downloadManager: DownloadManager, port = 52345) {
    this.downloadManager = downloadManager;
    this.port = port;
  }

  public setShowDialogHandler(cb: (data: any) => void): void {
    this.onShowDialog = cb;
  }

  public setMainWindow(win: BrowserWindow | null): void {
    this.mainWindow = win;
  }

  private isAllowed(req: http.IncomingMessage): boolean {
    // DNS-rebinding guard: the Host must be this machine
    const host = String(req.headers.host || '').toLowerCase();
    const okHosts = [`127.0.0.1:${this.port}`, `localhost:${this.port}`, `[::1]:${this.port}`];
    if (!okHosts.includes(host)) return false;
    const origin = req.headers.origin;
    if (origin === undefined) return true; // non-browser local client
    return EXTENSION_ORIGIN.test(String(origin));
  }

  public start(): void {
    this.server = http.createServer((req, res) => this.handle(req, res));

    this.wss = new WebSocketServer({
      server: this.server,
      maxPayload: MAX_BODY,
      verifyClient: (info: { req: http.IncomingMessage }) => this.isAllowed(info.req),
    });
    // The WebSocket server re-emits HTTP server errors; without a handler they crash the app
    this.wss.on('error', () => {});
    this.wss.on('connection', (ws: WebSocket) => {
      ws.send(JSON.stringify({ event: 'welcome', message: 'Connected to Quantum Downloader' }));
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          if (data.action === 'download' && typeof data.url === 'string') {
            const task = this.downloadManager.addTask({
              url: data.url,
              filename: data.filename,
              category: data.category,
              headers: data.headers,
              quality: data.quality,
              formatId: data.formatId,
            });
            ws.send(JSON.stringify({ event: 'download-started', task }));
          }
        } catch (e: any) {
          ws.send(JSON.stringify({ event: 'error', error: e?.message || 'Invalid request' }));
        }
      });
    });

    this.server.on('error', (err: any) => {
      this.listening = false;
      if (err.code === 'EADDRINUSE') console.warn(`[Quantum API] Port ${this.port} is already in use; extension bridge disabled.`);
      else console.error('[Quantum API] Server error:', err);
    });
    this.server.listen(this.port, '127.0.0.1', () => {
      this.listening = true;
      console.log(`[Quantum API] Extension bridge listening on http://127.0.0.1:${this.port}`);
    });
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const send = (code: number, body: any) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (!this.isAllowed(req)) return send(403, { error: 'Forbidden' });

    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', String(origin));
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);

    if (url.pathname === '/api/status' && req.method === 'GET') {
      const active = this.downloadManager.getAllTasks().filter((t) => t.status === 'downloading');
      return send(200, {
        status: 'online',
        version: app.getVersion(),
        activeDownloads: active.length,
        totalSpeed: active.reduce((sum, t) => sum + (t.speed || 0), 0),
      });
    }

    if (req.method !== 'POST' || (url.pathname !== '/api/download' && url.pathname !== '/api/extract-formats')) {
      return send(404, { error: 'Not found' });
    }

    let body = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on('end', async () => {
      if (tooBig) return;
      let data: any;
      try {
        data = JSON.parse(body || '{}');
      } catch {
        return send(400, { error: 'Invalid JSON' });
      }

      try {
        if (url.pathname === '/api/extract-formats') {
          if (typeof data.url !== 'string') return send(400, { error: 'Missing URL parameter' });
          try {
            const r = await VideoStreamDownloader.probeVideoFormats(data.url);
            return send(200, { success: true, title: r.title, formats: r.formats });
          } catch (err: any) {
            return send(200, { success: false, error: err?.message, title: 'Video', formats: FALLBACK_FORMATS });
          }
        }

        // /api/download
        if (Array.isArray(data.urls)) {
          const created = [];
          for (const u of data.urls.slice(0, 500)) {
            if (typeof u !== 'string' || !/^https?:\/\//i.test(u.trim())) continue;
            try {
              const t = this.downloadManager.addTask({ url: u.trim() });
              this.broadcast({ event: 'download-added', task: t });
              created.push(t);
            } catch {
              /* skip bad link */
            }
          }
          return send(200, { success: true, count: created.length, tasks: created });
        }

        if (typeof data.url !== 'string' || !data.url) return send(400, { error: 'Missing URL parameter' });

        const payload = {
          url: data.url,
          filename: typeof data.filename === 'string' ? data.filename : undefined,
          category: typeof data.category === 'string' ? data.category : undefined,
          headers: data.headers && typeof data.headers === 'object' ? data.headers : undefined,
          quality: typeof data.quality === 'string' && data.quality ? data.quality : undefined,
          formatId: typeof data.formatId === 'string' && data.formatId ? data.formatId : undefined,
        };

        if (data.showDialog && this.onShowDialog) {
          this.onShowDialog(payload);
          return send(200, { success: true, dialog: true });
        }

        const task = this.downloadManager.addTask(payload);
        this.broadcast({ event: 'download-added', task });
        return send(200, { success: true, task });
      } catch (err: any) {
        return send(400, { error: err?.message || 'Request failed' });
      }
    });
  }

  public broadcast(data: any): void {
    if (!this.wss) return;
    const msg = JSON.stringify(data);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
  }

  public stop(): void {
    this.wss?.close();
    this.server?.close();
  }
}

const FALLBACK_FORMATS = [
  { formatId: 'bv*+ba/b', resolution: 'Best', quality: 'Best', ext: 'mp4', label: 'Best available quality' },
  { formatId: 'bv*[height<=1080]+ba/b', resolution: '1080p', quality: '1080p', ext: 'mp4', label: '1080p Full HD' },
  { formatId: 'bv*[height<=720]+ba/b', resolution: '720p', quality: '720p', ext: 'mp4', label: '720p HD' },
  { formatId: 'bv*[height<=480]+ba/b', resolution: '480p', quality: '480p', ext: 'mp4', label: '480p' },
  { formatId: 'ba/b', resolution: 'Audio', quality: 'Audio MP3', ext: 'mp3', label: 'Audio only (MP3)' },
];
