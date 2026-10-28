import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { DownloadTask, DownloadSegment, DownloadCategory } from './types';

export interface DownloaderEvents {
  onProgress: (task: DownloadTask) => void;
  onComplete: (task: DownloadTask) => void;
  onError: (task: DownloadTask, error: Error) => void;
}

export class SegmentedDownloader {
  public task: DownloadTask;
  private events: DownloaderEvents;
  private isPaused: boolean = false;
  private activeStreams: http.ClientRequest[] = [];
  private fileHandle: number | null = null;
  private speedTimer: NodeJS.Timeout | null = null;
  private lastBytesDownloaded: number = 0;
  private speedWindow: number[] = [];

  constructor(task: DownloadTask, events: DownloaderEvents) {
    this.task = task;
    this.events = events;
  }

  public async start(): Promise<void> {
    this.isPaused = false;
    this.task.status = 'downloading';
    this.lastBytesDownloaded = this.task.downloadedBytes;

    try {
      // 1. Probe remote server if totalBytes is unknown or not initialized
      if (!this.task.totalBytes || this.task.segments.length === 0) {
        await this.probeServer();
      }

      // Ensure target directory exists
      const targetDir = path.dirname(this.task.filepath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Open file handle for writing at specific byte offsets
      // 'r+' if file exists and we are resuming, otherwise 'w+'
      const mode = fs.existsSync(this.task.filepath) ? 'r+' : 'w+';
      this.fileHandle = fs.openSync(this.task.filepath, mode);

      // Start speed calculation timer
      this.startSpeedCalculation();

      if (this.task.resumable && this.task.totalBytes > 0 && this.task.segments.length > 1) {
        // Multi-segment parallel download
        await this.runSegmentedDownload();
      } else {
        // Single stream download
        await this.runSingleStreamDownload();
      }
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
    } catch (e) {
      // Ignore
    }
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

      this.speedWindow.push(diff);
      if (this.speedWindow.length > 3) this.speedWindow.shift();
      const avg = this.speedWindow.reduce((a, b) => a + b, 0) / this.speedWindow.length;
      this.task.speed = Math.round(avg);

      this.events.onProgress(this.task);
    }, 1000);
  }

  private stopSpeedCalculation(): void {
    if (this.speedTimer) {
      clearInterval(this.speedTimer);
      this.speedTimer = null;
    }
  }

  private async probeServer(): Promise<void> {
    const parsed = new URL(this.task.url);
    const client = parsed.protocol === 'https:' ? https : http;

    return new Promise<void>((resolve, reject) => {
      const userAgent = this.task.headers?.['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

      const options: http.RequestOptions = {
        method: 'HEAD',
        headers: {
          'User-Agent': userAgent,
          'Accept': '*/*',
          'Accept-Encoding': 'identity',
          ...(this.task.headers || {}),
        },
      };

      const req = client.request(this.task.url, options, (res) => {
        // Handle redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.task.url = new URL(res.headers.location, this.task.url).toString();
          return this.probeServer().then(resolve).catch(reject);
        }

        // If server disallows HEAD or returns error, fallback to GET range probe
        if (res.statusCode && res.statusCode >= 400) {
          return this.probeWithGet().then(resolve).catch(reject);
        }

        const contentLength = res.headers['content-length'];
        const acceptRanges = res.headers['accept-ranges'];
        const contentDisposition = res.headers['content-disposition'];
        const contentType = res.headers['content-type'] || '';

        if (contentLength) {
          this.task.totalBytes = parseInt(contentLength, 10);
        }
        this.task.etag = res.headers['etag'] as string;
        this.task.lastModified = res.headers['last-modified'] as string;
        this.task.resumable = acceptRanges === 'bytes' || Boolean(res.headers['content-range']);

        // Detect real filename from Content-Disposition or redirected URL
        const detectedName = this.detectFilename(contentDisposition, this.task.url, contentType);
        if (detectedName && (!this.task.filename || this.task.filename === 'download' || (!this.task.filename.includes('.') && detectedName.includes('.')))) {
          this.task.filename = detectedName;
          const dir = path.dirname(this.task.filepath);
          this.task.filepath = path.join(dir, detectedName);
        }

        this.task.category = this.detectCategory(this.task.filename, contentType);

        // Partition into segments if file size > 512KB and resumable
        if (this.task.resumable && this.task.totalBytes > 512 * 1024) {
          this.createSegments();
        } else {
          this.task.segments = [{
            id: 0,
            startByte: 0,
            endByte: this.task.totalBytes || 0,
            currentByte: 0,
            downloaded: 0,
            total: this.task.totalBytes || 0,
            status: 'pending',
            speed: 0,
          }];
        }

        resolve();
      });

      req.on('error', () => {
        // Fallback: try GET with range 0-0 in case HEAD is blocked
        this.probeWithGet().then(resolve).catch(reject);
      });

      req.end();
    });
  }

  private async probeWithGet(): Promise<void> {
    const parsed = new URL(this.task.url);
    const client = parsed.protocol === 'https:' ? https : http;

    return new Promise<void>((resolve, reject) => {
      const userAgent = this.task.headers?.['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

      const options: http.RequestOptions = {
        method: 'GET',
        headers: {
          'Range': 'bytes=0-0',
          'User-Agent': userAgent,
          'Accept': '*/*',
          'Accept-Encoding': 'identity',
          ...(this.task.headers || {}),
        },
      };

      const req = client.request(this.task.url, options, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.task.url = new URL(res.headers.location, this.task.url).toString();
          return this.probeWithGet().then(resolve).catch(reject);
        }

        if (res.statusCode && res.statusCode >= 400) {
          res.destroy();
          return reject(new Error(`Server responded with HTTP ${res.statusCode} (${res.statusMessage || 'Access Denied'})`));
        }

        const contentRange = res.headers['content-range'];
        const contentDisposition = res.headers['content-disposition'];
        const contentType = res.headers['content-type'] || '';

        if (contentRange) {
          const match = contentRange.match(/\/(\d+)/);
          if (match) {
            this.task.totalBytes = parseInt(match[1], 10);
            this.task.resumable = true;
          }
        } else if (res.headers['content-length']) {
          this.task.totalBytes = parseInt(res.headers['content-length'], 10);
        }

        // Detect real filename
        const detectedName = this.detectFilename(contentDisposition, this.task.url, contentType);
        if (detectedName && (!this.task.filename || this.task.filename === 'download' || (!this.task.filename.includes('.') && detectedName.includes('.')))) {
          this.task.filename = detectedName;
          const dir = path.dirname(this.task.filepath);
          this.task.filepath = path.join(dir, detectedName);
        }

        this.task.category = this.detectCategory(this.task.filename, contentType);

        if (this.task.resumable && this.task.totalBytes > 512 * 1024) {
          this.createSegments();
        } else {
          this.task.segments = [{
            id: 0,
            startByte: 0,
            endByte: this.task.totalBytes || 0,
            currentByte: 0,
            downloaded: 0,
            total: this.task.totalBytes || 0,
            status: 'pending',
            speed: 0,
          }];
        }
        res.destroy();
        resolve();
      });

      req.on('error', reject);
      req.end();
    });
  }

  private createSegments(): void {
    const numConnections = Math.min(this.task.connections || 16, 32);
    const chunkSize = Math.floor(this.task.totalBytes / numConnections);
    const segments: DownloadSegment[] = [];

    for (let i = 0; i < numConnections; i++) {
      const start = i * chunkSize;
      const end = i === numConnections - 1 ? this.task.totalBytes - 1 : (i + 1) * chunkSize - 1;
      segments.push({
        id: i,
        startByte: start,
        endByte: end,
        currentByte: start,
        downloaded: 0,
        total: end - start + 1,
        status: 'pending',
        speed: 0,
      });
    }

    this.task.segments = segments;
  }

  private async runSegmentedDownload(): Promise<void> {
    const pendingSegments = this.task.segments.filter(s => s.status !== 'completed');

    const downloadPromises = pendingSegments.map(segment => this.downloadSegment(segment));
    await Promise.all(downloadPromises);

    if (!this.isPaused) {
      this.checkCompletion();
    }
  }

  private downloadSegment(segment: DownloadSegment, customUrl?: string, redirectCount: number = 0): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.isPaused) return resolve();
      if (redirectCount > 5) return reject(new Error('Too many redirects in segment stream'));

      const start = segment.currentByte;
      const end = segment.endByte;

      if (start > end) {
        segment.status = 'completed';
        return resolve();
      }

      segment.status = 'downloading';
      const targetUrl = customUrl || this.task.url;
      const parsed = new URL(targetUrl);
      const client = parsed.protocol === 'https:' ? https : http;

      const userAgent = this.task.headers?.['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

      const options: http.RequestOptions = {
        method: 'GET',
        headers: {
          'Range': `bytes=${start}-${end}`,
          'User-Agent': userAgent,
          'Accept': '*/*',
          'Accept-Encoding': 'identity',
          ...(this.task.headers || {}),
        },
      };

      const req = client.request(targetUrl, options, (res) => {
        // Follow redirects in segments
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, targetUrl).toString();
          this.task.url = redirectUrl;
          return this.downloadSegment(segment, redirectUrl, redirectCount + 1).then(resolve).catch(reject);
        }

        if (res.statusCode !== 200 && res.statusCode !== 206) {
          segment.status = 'error';
          return reject(new Error(`Server responded with HTTP ${res.statusCode} (${res.statusMessage || ''})`));
        }

        let offset = start;

        res.on('data', (chunk: Buffer) => {
          if (this.isPaused) {
            req.destroy();
            return;
          }

          if (this.fileHandle !== null) {
            try {
              fs.writeSync(this.fileHandle, chunk, 0, chunk.length, offset);
              offset += chunk.length;
              segment.currentByte = offset;
              segment.downloaded += chunk.length;
              this.task.downloadedBytes += chunk.length;
            } catch (err) {
              req.destroy();
              reject(err);
            }
          }
        });

        res.on('end', () => {
          if (!this.isPaused) {
            segment.status = 'completed';
            // Dynamic chunk stealing / sharing:
            // Check if another segment still has work left, split it to help finish faster!
            this.attemptChunkStealing().then(resolve).catch(resolve);
          } else {
            resolve();
          }
        });

        res.on('error', (err) => {
          if (this.isPaused) return resolve();
          segment.status = 'error';
          reject(err);
        });
      });

      req.on('error', (err) => {
        if (this.isPaused) return resolve();
        segment.status = 'error';
        reject(err);
      });

      this.activeStreams.push(req);
      req.end();
    });
  }

  // Dynamic chunk stealing (IDM dynamic multi-threading):
  // When one thread completes, it checks if any other active thread has > 1MB remaining.
  // If so, it takes over the second half of that segment!
  private async attemptChunkStealing(): Promise<void> {
    if (this.isPaused) return;

    let targetSegment: DownloadSegment | null = null;
    let maxRemaining = 1024 * 1024 * 2; // At least 2MB remaining to split

    for (const seg of this.task.segments) {
      if (seg.status === 'downloading') {
        const remaining = seg.endByte - seg.currentByte;
        if (remaining > maxRemaining) {
          maxRemaining = remaining;
          targetSegment = seg;
        }
      }
    }

    if (targetSegment) {
      const remaining = targetSegment.endByte - targetSegment.currentByte;
      const half = Math.floor(remaining / 2);
      const newStart = targetSegment.endByte - half + 1;
      const oldEnd = targetSegment.endByte;

      // Adjust original target segment end
      targetSegment.endByte = newStart - 1;

      // Create new stolen segment
      const newSegment: DownloadSegment = {
        id: this.task.segments.length,
        startByte: newStart,
        endByte: oldEnd,
        currentByte: newStart,
        downloaded: 0,
        total: oldEnd - newStart + 1,
        status: 'pending',
        speed: 0,
      };

      this.task.segments.push(newSegment);
      await this.downloadSegment(newSegment);
    }
  }

  private async runSingleStreamDownload(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const parsed = new URL(this.task.url);
      const client = parsed.protocol === 'https:' ? https : http;

      const start = this.task.downloadedBytes;
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...(this.task.headers || {}),
      };

      if (start > 0 && this.task.resumable) {
        headers['Range'] = `bytes=${start}-`;
      }

      const req = client.request(this.task.url, { method: 'GET', headers }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.task.url = new URL(res.headers.location, this.task.url).toString();
          return this.runSingleStreamDownload().then(resolve).catch(reject);
        }

        if (res.statusCode !== 200 && res.statusCode !== 206) {
          return reject(new Error(`Server responded with ${res.statusCode}`));
        }

        let offset = start;

        res.on('data', (chunk: Buffer) => {
          if (this.isPaused) {
            req.destroy();
            return;
          }

          if (this.fileHandle !== null) {
            try {
              fs.writeSync(this.fileHandle, chunk, 0, chunk.length, offset);
              offset += chunk.length;
              this.task.downloadedBytes += chunk.length;
              if (this.task.segments[0]) {
                this.task.segments[0].currentByte = offset;
                this.task.segments[0].downloaded += chunk.length;
              }
            } catch (err) {
              req.destroy();
              reject(err);
            }
          }
        });

        res.on('end', () => {
          if (!this.isPaused) {
            if (this.task.segments[0]) {
              this.task.segments[0].status = 'completed';
            }
            this.checkCompletion();
          }
          resolve();
        });

        res.on('error', (err) => {
          if (this.isPaused) return resolve();
          reject(err);
        });
      });

      req.on('error', (err) => {
        if (this.isPaused) return resolve();
        reject(err);
      });

      this.activeStreams.push(req);
      req.end();
    });
  }

  private checkCompletion(): void {
    const allDone = this.task.segments.every(s => s.status === 'completed');
    if (allDone || (this.task.totalBytes > 0 && this.task.downloadedBytes >= this.task.totalBytes)) {
      this.task.status = 'completed';
      this.task.completedAt = Date.now();
      this.task.speed = 0;
      this.closeFile();
      this.stopSpeedCalculation();
      this.events.onComplete(this.task);
    }
  }

  private handleError(err: Error): void {
    this.task.status = 'error';
    this.task.errorMessage = err.message || 'Unknown network error';
    this.task.speed = 0;
    this.closeFile();
    this.stopSpeedCalculation();
    this.events.onError(this.task, err);
  }

  private detectFilename(contentDisposition: string | undefined, fileUrl: string, contentType: string): string {
    if (contentDisposition) {
      const match = contentDisposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
      if (match && match[1]) {
        return decodeURIComponent(match[1].trim());
      }
    }

    try {
      const parsed = new URL(fileUrl);
      const basename = path.basename(parsed.pathname);
      if (basename && basename.includes('.')) {
        return decodeURIComponent(basename);
      }
    } catch {}

    // Fallback based on MIME type
    const mimeMap: Record<string, string> = {
      'video/mp4': 'video.mp4',
      'video/webm': 'video.webm',
      'audio/mpeg': 'audio.mp3',
      'application/zip': 'archive.zip',
      'application/x-zip-compressed': 'archive.zip',
      'application/pdf': 'document.pdf',
    };

    return mimeMap[contentType] || `download_${Date.now()}`;
  }

  private detectCategory(filename: string, contentType: string): DownloadCategory {
    const ext = path.extname(filename).toLowerCase();
    const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v', '.ts', '.m3u8'];
    const audioExts = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma'];
    const compExts = ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.iso'];
    const docExts = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv'];
    const progExts = ['.exe', '.msi', '.apk', '.bat', '.dmg', '.iso', '.bin'];

    if (videoExts.includes(ext) || contentType.startsWith('video/')) return 'video';
    if (audioExts.includes(ext) || contentType.startsWith('audio/')) return 'audio';
    if (compExts.includes(ext) || contentType.includes('zip') || contentType.includes('compressed')) return 'compressed';
    if (docExts.includes(ext) || contentType.includes('pdf') || contentType.includes('document')) return 'document';
    if (progExts.includes(ext)) return 'program';
    return 'other';
  }
}
