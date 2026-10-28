import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { DownloadTask } from './types';
import { DownloaderEvents } from './segmented-downloader';

export class HlsDownloader {
  public task: DownloadTask;
  private events: DownloaderEvents;
  private isPaused: boolean = false;
  private activeStreams: http.ClientRequest[] = [];
  private fileHandle: number | null = null;
  private speedTimer: NodeJS.Timeout | null = null;
  private lastBytesDownloaded: number = 0;
  private segmentUrls: string[] = [];
  private currentSegmentIndex: number = 0;

  constructor(task: DownloadTask, events: DownloaderEvents) {
    this.task = task;
    this.events = events;
  }

  public async start(): Promise<void> {
    this.isPaused = false;
    this.task.status = 'downloading';
    this.task.isHls = true;
    this.lastBytesDownloaded = this.task.downloadedBytes;

    try {
      if (this.segmentUrls.length === 0) {
        await this.parsePlaylist();
      }

      const targetDir = path.dirname(this.task.filepath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Open or append to destination video file
      const mode = fs.existsSync(this.task.filepath) && this.currentSegmentIndex > 0 ? 'a' : 'w';
      this.fileHandle = fs.openSync(this.task.filepath, mode);

      this.startSpeedCalculation();
      await this.downloadHlsSegments();
    } catch (err: any) {
      this.handleError(err);
    }
  }

  public pause(): void {
    this.isPaused = true;
    this.task.status = 'paused';
    this.task.speed = 0;
    this.cleanupActiveRequests();
    this.closeFile();
    this.stopSpeedCalculation();
    this.events.onProgress(this.task);
  }

  public cancel(): void {
    this.pause();
    this.closeFile();
    try {
      if (fs.existsSync(this.task.filepath)) {
        fs.unlinkSync(this.task.filepath);
      }
    } catch (e) {}
  }

  private closeFile(): void {
    if (this.fileHandle !== null) {
      try {
        fs.closeSync(this.fileHandle);
      } catch (e) {}
      this.fileHandle = null;
    }
  }

  private cleanupActiveRequests(): void {
    for (const req of this.activeStreams) {
      try {
        req.destroy();
      } catch (e) {}
    }
    this.activeStreams = [];
  }

  private startSpeedCalculation(): void {
    this.stopSpeedCalculation();
    this.speedTimer = setInterval(() => {
      if (this.isPaused || this.task.status !== 'downloading') return;
      const current = this.task.downloadedBytes;
      const diff = Math.max(0, current - this.lastBytesDownloaded);
      this.lastBytesDownloaded = current;
      this.task.speed = diff;
      this.events.onProgress(this.task);
    }, 1000);
  }

  private stopSpeedCalculation(): void {
    if (this.speedTimer) {
      clearInterval(this.speedTimer);
      this.speedTimer = null;
    }
  }

  private async fetchText(urlStr: string): Promise<string> {
    const parsed = new URL(urlStr);
    const client = parsed.protocol === 'https:' ? https : http;

    return new Promise<string>((resolve, reject) => {
      const req = client.get(urlStr, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          ...(this.task.headers || {}),
        }
      }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, urlStr).toString();
          return this.fetchText(next).then(resolve).catch(reject);
        }

        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(body));
        res.on('error', reject);
      });
      req.on('error', reject);
    });
  }

  private async parsePlaylist(): Promise<void> {
    let playlistContent = await this.fetchText(this.task.url);

    // If master playlist with multiple variant streams, pick the highest bandwidth/resolution
    if (playlistContent.includes('#EXT-X-STREAM-INF')) {
      const lines = playlistContent.split('\n');
      let bestBandwidth = 0;
      let bestUri = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
          const bwMatch = line.match(/BANDWIDTH=(\d+)/);
          const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
          const nextLine = lines[i + 1]?.trim();
          if (nextLine && !nextLine.startsWith('#') && bw >= bestBandwidth) {
            bestBandwidth = bw;
            bestUri = nextLine;
          }
        }
      }

      if (bestUri) {
        const variantUrl = new URL(bestUri, this.task.url).toString();
        this.task.url = variantUrl;
        playlistContent = await this.fetchText(variantUrl);
      }
    }

    // Parse segment URLs
    const rawLines = playlistContent.split('\n');
    const segments: string[] = [];

    for (const raw of rawLines) {
      const line = raw.trim();
      if (line && !line.startsWith('#')) {
        const resolved = new URL(line, this.task.url).toString();
        segments.push(resolved);
      }
    }

    if (segments.length === 0) {
      throw new Error('No video stream segments found in M3U8 playlist.');
    }

    this.segmentUrls = segments;
    this.task.totalBytes = segments.length * 1024 * 1024 * 2; // rough estimated size (2MB per segment)
    this.task.resumable = true;

    // Initialize visual segments (showing chunks)
    this.task.segments = segments.slice(0, 32).map((_, idx) => ({
      id: idx,
      startByte: idx,
      endByte: segments.length,
      currentByte: 0,
      downloaded: 0,
      total: Math.ceil(segments.length / 32),
      status: 'pending',
      speed: 0
    }));
  }

  private async downloadHlsSegments(): Promise<void> {
    // Process segments in order, with concurrency up to 8
    const concurrency = Math.min(this.task.connections || 8, 8);
    const queue = [...this.segmentUrls.entries()].slice(this.currentSegmentIndex);

    // Buffer for ordered writing
    const chunksBuffer = new Map<number, Buffer>();
    let nextWriteIndex = this.currentSegmentIndex;

    const worker = async () => {
      while (queue.length > 0 && !this.isPaused) {
        const item = queue.shift();
        if (!item) break;
        const [index, segUrl] = item;

        try {
          const chunkData = await this.fetchSegmentBinary(segUrl);
          chunksBuffer.set(index, chunkData);

          // Flush ordered chunks into the output file
          while (chunksBuffer.has(nextWriteIndex)) {
            const dataToWrite = chunksBuffer.get(nextWriteIndex)!;
            chunksBuffer.delete(nextWriteIndex);
            if (this.fileHandle !== null) {
              fs.writeSync(this.fileHandle, dataToWrite);
            }
            this.task.downloadedBytes += dataToWrite.length;
            nextWriteIndex++;
            this.currentSegmentIndex = nextWriteIndex;

            // Update visual progress
            const visualSegIdx = Math.floor((nextWriteIndex / this.segmentUrls.length) * (this.task.segments.length - 1));
            if (this.task.segments[visualSegIdx]) {
              this.task.segments[visualSegIdx].status = 'downloading';
              this.task.segments[visualSegIdx].downloaded++;
            }
          }
        } catch (err: any) {
          if (!this.isPaused) {
            console.error(`Error downloading HLS segment ${index}:`, err);
          }
        }
      }
    };

    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);

    if (!this.isPaused && nextWriteIndex >= this.segmentUrls.length) {
      this.task.status = 'completed';
      this.task.completedAt = Date.now();
      this.task.speed = 0;
      this.task.segments.forEach(s => s.status = 'completed');
      this.closeFile();
      this.stopSpeedCalculation();
      this.events.onComplete(this.task);
    }
  }

  private fetchSegmentBinary(urlStr: string): Promise<Buffer> {
    const parsed = new URL(urlStr);
    const client = parsed.protocol === 'https:' ? https : http;

    return new Promise<Buffer>((resolve, reject) => {
      if (this.isPaused) return reject(new Error('Paused'));

      const req = client.get(urlStr, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          ...(this.task.headers || {})
        }
      }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, urlStr).toString();
          return this.fetchSegmentBinary(next).then(resolve).catch(reject);
        }

        const chunks: Buffer[] = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });

      req.on('error', reject);
      this.activeStreams.push(req);
    });
  }

  private handleError(err: Error): void {
    this.task.status = 'error';
    this.task.errorMessage = err.message || 'HLS stream download failed';
    this.task.speed = 0;
    this.closeFile();
    this.stopSpeedCalculation();
    this.events.onError(this.task, err);
  }
}
