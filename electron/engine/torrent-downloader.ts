import path from 'path';
import fs from 'fs';
import { DownloadTask, DownloadSegment } from './types';
import { DownloaderEvents } from './segmented-downloader';

export class TorrentDownloader {
  public task: DownloadTask;
  private events: DownloaderEvents;
  private isPaused: boolean = false;
  private client: any = null;
  private torrent: any = null;
  private speedTimer: NodeJS.Timeout | null = null;
  private lastBytes: number = 0;

  constructor(task: DownloadTask, events: DownloaderEvents) {
    this.task = task;
    this.events = events;
  }

  public async start(): Promise<void> {
    this.isPaused = false;
    this.task.status = 'downloading';
    this.task.isTorrent = true;
    this.lastBytes = this.task.downloadedBytes;

    try {
      // Dynamic import because WebTorrent is an ESM module
      const webtorrentModule = await import('webtorrent');
      const WebTorrent = webtorrentModule.default || webtorrentModule;

      this.client = new WebTorrent({
        maxConns: 55,
      });

      const downloadDir = path.dirname(this.task.filepath);
      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
      }

      this.client.add(this.task.url, { path: downloadDir }, (torrent: any) => {
        this.torrent = torrent;

        if (torrent.name && (!this.task.filename || this.task.filename.startsWith('download_'))) {
          this.task.filename = torrent.name;
          this.task.filepath = path.join(downloadDir, torrent.name);
        }

        this.task.totalBytes = torrent.length || this.task.totalBytes || 0;
        this.task.resumable = true;

        // Map torrent pieces/files into segments for visualizer
        this.updateSegmentsFromTorrent(torrent);

        torrent.on('download', (bytes: number) => {
          if (this.isPaused) return;

          this.task.downloadedBytes = torrent.downloaded;
          this.task.speed = torrent.downloadSpeed || 0;
          this.task.torrentPeers = torrent.numPeers || 0;
          this.task.torrentProgress = Math.round((torrent.progress || 0) * 100);

          this.updateSegmentsFromTorrent(torrent);
          this.events.onProgress(this.task);
        });

        torrent.on('done', () => {
          if (!this.isPaused) {
            this.task.status = 'completed';
            this.task.completedAt = Date.now();
            this.task.speed = 0;
            this.task.downloadedBytes = this.task.totalBytes;
            this.events.onComplete(this.task);
            this.destroyClient();
          }
        });

        torrent.on('error', (err: any) => {
          this.handleError(err);
        });
      });

      this.client.on('error', (err: any) => {
        this.handleError(err);
      });

    } catch (err: any) {
      this.handleError(err);
    }
  }

  private updateSegmentsFromTorrent(torrent: any): void {
    if (!torrent || !torrent.pieces || torrent.pieces.length === 0) return;

    // Aggregate torrent pieces into 16 visual segment bars
    const numBars = 16;
    const piecesPerBar = Math.max(1, Math.floor(torrent.pieces.length / numBars));
    const segments: DownloadSegment[] = [];

    const totalLength = torrent.length || 1;
    const bytesPerBar = Math.floor(totalLength / numBars);

    for (let i = 0; i < numBars; i++) {
      const pieceStart = i * piecesPerBar;
      const pieceEnd = Math.min((i + 1) * piecesPerBar, torrent.pieces.length);
      
      let downloadedInBar = 0;
      let totalInBar = pieceEnd - pieceStart;
      for (let p = pieceStart; p < pieceEnd; p++) {
        if (torrent.pieces[p] && torrent.pieces[p].missing === 0) {
          downloadedInBar++;
        }
      }

      const fraction = totalInBar > 0 ? downloadedInBar / totalInBar : 0;
      const barBytes = Math.floor(bytesPerBar * fraction);

      segments.push({
        id: i,
        startByte: i * bytesPerBar,
        endByte: (i + 1) * bytesPerBar - 1,
        currentByte: i * bytesPerBar + barBytes,
        downloaded: barBytes,
        total: bytesPerBar,
        status: fraction >= 1 ? 'completed' : (fraction > 0 ? 'downloading' : 'pending'),
        speed: Math.round(this.task.speed / numBars),
      });
    }

    this.task.segments = segments;
  }

  public pause(): void {
    this.isPaused = true;
    this.task.status = 'paused';
    this.task.speed = 0;
    this.destroyClient();
    this.events.onProgress(this.task);
  }

  public cancel(): void {
    this.pause();
    this.destroyClient();
    try {
      if (fs.existsSync(this.task.filepath)) {
        const stat = fs.statSync(this.task.filepath);
        if (stat.isDirectory()) {
          fs.rmSync(this.task.filepath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(this.task.filepath);
        }
      }
    } catch {}
  }

  private destroyClient(): void {
    if (this.speedTimer) {
      clearInterval(this.speedTimer);
      this.speedTimer = null;
    }
    if (this.client) {
      try {
        this.client.destroy();
      } catch {}
      this.client = null;
    }
  }

  private handleError(err: any): void {
    this.task.status = 'error';
    this.task.errorMessage = err?.message || 'Torrent network error';
    this.task.speed = 0;
    this.destroyClient();
    this.events.onError(this.task, err instanceof Error ? err : new Error(String(err)));
  }
}
