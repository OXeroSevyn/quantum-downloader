import path from 'path';
import fs from 'fs';
import { DownloadTask, DownloadSegment } from './types';
import { DownloaderEvents } from './segmented-downloader';
import { safeUnlink, sanitizeFilename } from './file-utils';

// The main process is compiled to CommonJS, which would turn `import()` into
// `require()`. WebTorrent is ESM-only, so keep a real dynamic import.
const esmImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<any>;

let WebTorrentCtor: any = null;
async function loadWebTorrent(): Promise<any> {
  if (!WebTorrentCtor) {
    const mod = await esmImport('webtorrent');
    WebTorrentCtor = mod.default || mod;
  }
  return WebTorrentCtor;
}

const VISUAL_BARS = 16;
const METADATA_TIMEOUT_MS = 3 * 60_000;

export class TorrentDownloader {
  public task: DownloadTask;
  private events: DownloaderEvents;
  private stopped = false;
  private client: any = null;
  private torrent: any = null;
  private progressTimer: NodeJS.Timeout | null = null;
  private metadataTimer: NodeJS.Timeout | null = null;

  constructor(task: DownloadTask, events: DownloaderEvents) {
    this.task = task;
    this.events = events;
  }

  public async start(): Promise<void> {
    this.stopped = false;
    const task = this.task;
    task.status = 'downloading';
    task.isTorrent = true;
    task.errorMessage = undefined;

    try {
      const WebTorrent = await loadWebTorrent();
      if (this.stopped) return;

      // Torrents get their own folder entry in the download dir
      const downloadDir = path.dirname(task.filepath);
      fs.mkdirSync(downloadDir, { recursive: true });

      this.client = new WebTorrent({ maxConns: 80 });
      this.client.on('error', (err: any) => this.fail(err));

      this.metadataTimer = setTimeout(() => {
        if (!this.torrent?.ready) this.fail(new Error('No peers found for this torrent (metadata timed out)'));
      }, METADATA_TIMEOUT_MS);

      this.addLog('Looking for peers…');
      this.client.add(task.url, { path: downloadDir }, (torrent: any) => {
        if (this.stopped) return;
        this.torrent = torrent;
        if (this.metadataTimer) clearTimeout(this.metadataTimer);

        const name = sanitizeFilename(torrent.name, task.filename || 'torrent');
        task.filename = name;
        task.filepath = path.join(downloadDir, name);
        task.totalBytes = torrent.length || 0;
        task.resumable = true;
        this.addLog(`Metadata received: ${torrent.files?.length || 1} file(s)`);

        torrent.on('done', () => this.complete());
        torrent.on('error', (err: any) => this.fail(err));
        if (torrent.done) this.complete();
      });

      // Report progress at a steady rate instead of on every received block
      this.progressTimer = setInterval(() => this.report(), 1000);
    } catch (err: any) {
      this.fail(err);
    }
  }

  private report(): void {
    if (this.stopped) return;
    const task = this.task;
    const t = this.torrent;
    if (t) {
      task.downloadedBytes = t.downloaded || 0;
      task.totalBytes = t.length || task.totalBytes;
      task.speed = Math.round(t.downloadSpeed || 0);
      task.torrentPeers = t.numPeers || 0;
      task.torrentProgress = Math.round((t.progress || 0) * 100);
      this.updateVisualSegments(t);
    } else {
      task.speed = 0;
      task.torrentPeers = this.client?.torrents?.[0]?.numPeers || 0;
    }
    this.events.onProgress(task);
  }

  private updateVisualSegments(torrent: any): void {
    const pieces: any[] = torrent?.pieces || [];
    if (!pieces.length) return;
    const total = torrent.length || 1;
    const perBar = pieces.length / VISUAL_BARS;
    const bytesPerBar = Math.floor(total / VISUAL_BARS);
    const segs: DownloadSegment[] = [];
    for (let i = 0; i < VISUAL_BARS; i++) {
      const from = Math.floor(i * perBar);
      const to = Math.max(from + 1, Math.floor((i + 1) * perBar));
      let have = 0;
      for (let p = from; p < to && p < pieces.length; p++) {
        // WebTorrent sets a piece to null once it is verified on disk
        if (pieces[p] === null || torrent.bitfield?.get?.(p)) have++;
      }
      const fraction = have / (to - from);
      const got = Math.floor(bytesPerBar * fraction);
      segs.push({
        id: i,
        startByte: i * bytesPerBar,
        endByte: (i + 1) * bytesPerBar - 1,
        currentByte: i * bytesPerBar + got,
        downloaded: got,
        total: bytesPerBar,
        status: fraction >= 1 ? 'completed' : fraction > 0 ? 'downloading' : 'pending',
        speed: 0,
      });
    }
    this.task.segments = segs;
  }

  private complete(): void {
    if (this.stopped) return;
    this.stopped = true;
    const task = this.task;
    task.status = 'completed';
    task.completedAt = Date.now();
    task.speed = 0;
    task.downloadedBytes = task.totalBytes;
    task.torrentProgress = 100;
    for (const s of task.segments) {
      s.status = 'completed';
      s.downloaded = s.total;
    }
    this.addLog('Finished');
    this.destroyClient();
    this.events.onComplete(task);
  }

  public pause(): void {
    this.stopped = true;
    this.destroyClient();
    this.task.status = 'paused';
    this.task.speed = 0;
  }

  public cancel(): void {
    const hadMetadata = Boolean(this.torrent);
    this.pause();
    // Only delete when we know the real name; never the shared download folder
    if (hadMetadata) setTimeout(() => safeUnlink(this.task.filepath), 500);
  }

  private destroyClient(): void {
    if (this.progressTimer) clearInterval(this.progressTimer);
    if (this.metadataTimer) clearTimeout(this.metadataTimer);
    this.progressTimer = this.metadataTimer = null;
    const c = this.client;
    this.client = null;
    this.torrent = null;
    if (c) {
      try {
        c.destroy();
      } catch {
        /* ignore */
      }
    }
  }

  private fail(err: any): void {
    if (this.stopped) return;
    this.stopped = true;
    this.destroyClient();
    const message = err?.message || String(err) || 'Torrent error';
    this.task.status = 'error';
    this.task.errorMessage = message;
    this.task.speed = 0;
    this.addLog(`Error: ${message}`);
    this.events.onError(this.task, err instanceof Error ? err : new Error(message));
  }

  private addLog(message: string): void {
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    this.task.logs = [...(this.task.logs || []), `[${time}] ${message}`].slice(-50);
  }
}
