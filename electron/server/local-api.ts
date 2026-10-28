import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { DownloadManager } from '../engine/download-manager';
import { VideoStreamDownloader } from '../engine/video-stream-downloader';

export class LocalApiService {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private downloadManager: DownloadManager;
  private port: number;
  private mainWindow: any = null;

  constructor(downloadManager: DownloadManager, port: number = 52345) {
    this.downloadManager = downloadManager;
    this.port = port;
  }

  private onShowDialogCallback: ((data: any) => void) | null = null;

  public setShowDialogHandler(cb: (data: any) => void): void {
    this.onShowDialogCallback = cb;
  }

  public setMainWindow(win: any): void {
    this.mainWindow = win;
  }

  public start(): void {
    this.server = http.createServer((req, res) => {
      // Enable CORS for universal browser extensions
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);

      if (url.pathname === '/api/status' && req.method === 'GET') {
        const tasks = this.downloadManager.getAllTasks();
        const active = tasks.filter(t => t.status === 'downloading');
        const totalSpeed = active.reduce((sum, t) => sum + (t.speed || 0), 0);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'online',
          version: '1.0.0',
          activeDownloads: active.length,
          totalSpeed,
        }));
        return;
      }

      // Format extraction for streaming videos & players
      if (url.pathname === '/api/extract-formats' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const data = JSON.parse(body);
            if (!data.url) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing URL parameter' }));
              return;
            }

            const probeResult = await VideoStreamDownloader.probeVideoFormats(data.url);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              title: probeResult.title,
              formats: probeResult.formats,
            }));
          } catch (err: any) {
            console.error('Error probing video formats:', err);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            // Return fallback format options so the user still has download choices
            res.end(JSON.stringify({
              success: false,
              title: 'Video Stream',
              formats: [
                { formatId: 'bestvideo+bestaudio/best', resolution: 'Best Available', quality: 'Best', ext: 'mp4', label: 'Best Quality (Auto MP4)' },
                { formatId: 'bv*[height<=2160]+ba/b', resolution: '4K', quality: '4K', ext: 'mp4', label: '2160p 4K Ultra HD (MP4)' },
                { formatId: 'bv*[height<=1440]+ba/b', resolution: '2K', quality: '2K', ext: 'mp4', label: '1440p 2K QHD (MP4)' },
                { formatId: 'bv*[height<=1080]+ba/b', resolution: '1080p', quality: '1080p', ext: 'mp4', label: '1080p Full HD (MP4)' },
                { formatId: 'bv*[height<=720]+ba/b', resolution: '720p', quality: '720p', ext: 'mp4', label: '720p HD (MP4)' },
                { formatId: 'bv*[height<=480]+ba/b', resolution: '480p', quality: '480p', ext: 'mp4', label: '480p Standard (MP4)' },
                { formatId: 'ba/b', resolution: 'Audio', quality: 'Audio Only', ext: 'mp3', label: 'Audio Only (MP3 / High Quality)' },
              ],
            }));
          }
        });
        return;
      }

      if (url.pathname === '/api/download' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (Array.isArray(data.urls) && data.urls.length > 0) {
              const createdTasks = [];
              for (const u of data.urls) {
                if (typeof u === 'string' && u.trim().startsWith('http')) {
                  const t = this.downloadManager.addTask(u.trim());
                  this.broadcast({ event: 'download-added', task: t });
                  createdTasks.push(t);
                }
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, count: createdTasks.length, tasks: createdTasks }));
              return;
            }

            if (!data.url) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing URL parameter' }));
              return;
            }

            if (data.showDialog) {
              const dialogPayload = {
                url: data.url,
                filename: data.filename,
                category: data.category,
                headers: data.headers,
                quality: data.quality,
                formatId: data.formatId,
              };

              if (this.onShowDialogCallback) {
                this.onShowDialogCallback(dialogPayload);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, dialog: true }));
                return;
              } else if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                if (this.mainWindow.isMinimized()) this.mainWindow.restore();
                this.mainWindow.show();
                this.mainWindow.focus();
                this.mainWindow.webContents.send('show-download-dialog', dialogPayload);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, dialog: true }));
                return;
              }
            }

            const task = this.downloadManager.addTask(
              data.url,
              data.filename,
              data.category,
              data.headers,
              data.quality,
              data.formatId
            );

            // Broadcast to connected WebSocket extension clients
            this.broadcast({ event: 'download-added', task });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, task }));
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws: WebSocket) => {
      ws.send(JSON.stringify({
        event: 'welcome',
        message: 'Connected to Quantum Downloader Core'
      }));

      ws.on('message', (message: string) => {
        try {
          const data = JSON.parse(message.toString());
          if (data.action === 'download' && data.url) {
            const task = this.downloadManager.addTask(
              data.url,
              data.filename,
              data.category,
              data.headers,
              data.quality,
              data.formatId
            );
            ws.send(JSON.stringify({ event: 'download-started', task }));
          }
        } catch (e) {
          console.error('WS message error:', e);
        }
      });
    });

    this.server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[Quantum API] Port ${this.port} already in use. Reusing active bridge.`);
      } else {
        console.error(`[Quantum API] Server error:`, err);
      }
    });

    try {
      this.server.listen(this.port, '127.0.0.1', () => {
        console.log(`[Quantum API] Local Extension Bridge running on http://127.0.0.1:${this.port}`);
      });
    } catch (err: any) {
      console.warn('[Quantum API] Server listen warning:', err);
    }
  }

  public broadcast(data: any): void {
    if (!this.wss) return;
    const msg = JSON.stringify(data);
    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }

  public stop(): void {
    if (this.wss) this.wss.close();
    if (this.server) this.server.close();
  }
}
