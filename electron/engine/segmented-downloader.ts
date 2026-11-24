import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { DownloadTask, DownloadSegment, DownloadCategory } from './types';
import { RateLimiter } from './rate-limiter';
import { sanitizeFilename, safeUnlink, DEFAULT_USER_AGENT } from './file-utils';

export interface DownloaderEvents {
  onProgress: (task: DownloadTask) => void;
  onComplete: (task: DownloadTask) => void;
  onError: (task: DownloadTask, error: Error) => void;
  /** Returns a free path for `filename` in `dir` (used when the server reveals the real name). */
  reservePath?: (dir: string, filename: string) => string;
}

class RangeNotSupportedError extends Error {
  constructor() {
    super('Server ignored the byte-range request');
  }
}

const MIN_SEGMENT_BYTES = 256 * 1024;
const MIN_STEAL_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 10;
const IDLE_TIMEOUT_MS = 30_000;
const SEGMENT_RETRIES = 5;

export class SegmentedDownloader {
  public task: DownloadTask;
  private events: DownloaderEvents;
  private rateLimiter: RateLimiter | null;

  /** Set once paused, cancelled or failed: every running loop stops. */
  private stopped = false;
  /** Bumped to invalidate in-flight segment loops (pause / fallback to single stream). */
  private generation = 0;
  private requests = new Set<http.ClientRequest>();
  private fd: number | null = null;
  private speedTimer: NodeJS.Timeout | null = null;
  private speedWindow: number[] = [];
  private lastBytes = 0;
  private lastSegmentBytes = new Map<number, number>();
  private resolvedUrl: string | null = null;

  constructor(task: DownloadTask, events: DownloaderEvents, rateLimiter?: RateLimiter) {
    this.task = task;
    this.events = events;
    this.rateLimiter = rateLimiter || null;
  }

  public setRateLimiter(rateLimiter: RateLimiter | null): void {
    this.rateLimiter = rateLimiter;
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  public async start(): Promise<void> {
    this.stopped = false;
    const task = this.task;
    task.status = 'downloading';
    task.errorMessage = undefined;
    task.speed = 0;

    try {
      const fresh = task.segments.length === 0 || (!task.totalBytes && task.downloadedBytes === 0);
      if (fresh) {
        await this.probe();
        task.downloadedBytes = 0;
      }
      if (this.stopped) return;

      fs.mkdirSync(path.dirname(task.filepath), { recursive: true });

      if (!fresh && !fs.existsSync(task.filepath)) {
        // Partial file was removed while paused: start over cleanly.
        this.resetProgress();
      }
      const reuse = !fresh && task.downloadedBytes > 0 && fs.existsSync(task.filepath);
      this.fd = fs.openSync(task.filepath, reuse ? 'r+' : 'w');

      this.startSpeedCalculation();

      if (task.resumable && task.totalBytes > 0) {
        try {
          await this.runSegmented();
        } catch (err) {
          if (!(err instanceof RangeNotSupportedError) || this.stopped) throw err;
          // Server lied about range support: fall back to a single plain stream.
          this.generation++;
          this.destroyRequests();
          task.resumable = false;
          await this.runSingleStreamWithRetry();
        }
      } else {
        await this.runSingleStreamWithRetry();
      }

      if (!this.stopped) this.complete();
    } catch (err: any) {
      if (!this.stopped) this.fail(err instanceof Error ? err : new Error(String(err)));
    }
  }

  public pause(): void {
    this.stopped = true;
    this.generation++;
    this.destroyRequests();
    this.closeFile();
    this.stopSpeedCalculation();
    this.task.status = 'paused';
    this.task.speed = 0;
    for (const s of this.task.segments) {
      s.speed = 0;
      if (s.status === 'downloading') s.status = 'pending';
    }
  }

  public cancel(): void {
    this.pause();
    safeUnlink(this.task.filepath);
  }

  // ───────────────────────────── probing ─────────────────────────────

  private async probe(): Promise<void> {
    const task = this.task;
    let total = 0;
    let resumable = false;
    let disposition: string | undefined;
    let contentType = '';

    // 1) HEAD
    try {
      const { res, url } = await this.open('HEAD', task.url);
      res.resume();
      if (res.statusCode && res.statusCode < 400) {
        this.resolvedUrl = url;
        total = parseInt(String(res.headers['content-length'] || '0'), 10) || 0;
        resumable = String(res.headers['accept-ranges'] || '').toLowerCase().includes('bytes');
        disposition = res.headers['content-disposition'] as string | undefined;
        contentType = String(res.headers['content-type'] || '');
        task.etag = res.headers['etag'] as string | undefined;
        task.lastModified = res.headers['last-modified'] as string | undefined;
      }
    } catch {
      /* fall through to GET probe */
    }
    if (this.stopped) return;

    // 2) GET bytes=0-0 confirms range support and size (many servers block HEAD)
    if (!total || !resumable) {
      const { res, url } = await this.open('GET', this.resolvedUrl || task.url, { Range: 'bytes=0-0' });
      res.destroy();
      if (!res.statusCode || res.statusCode >= 400) {
        throw new Error(`Server responded with HTTP ${res.statusCode} ${res.statusMessage || ''}`.trim());
      }
      this.resolvedUrl = url;
      disposition = disposition || (res.headers['content-disposition'] as string | undefined);
      contentType = contentType || String(res.headers['content-type'] || '');
      const range = String(res.headers['content-range'] || '');
      const m = range.match(/\/(\d+)\s*$/);
      if (res.statusCode === 206 && m) {
        total = parseInt(m[1], 10);
        resumable = true;
      } else {
        resumable = false;
        if (res.statusCode === 200 && res.headers['content-length']) {
          total = parseInt(String(res.headers['content-length']), 10) || total;
        }
      }
    }

    if (this.resolvedUrl) task.url = this.resolvedUrl;
    task.totalBytes = total;
    task.resumable = resumable && total > 0;

    // Real filename (Content-Disposition or final URL) when the user did not choose one
    if (task.autoName) {
      const detected = this.detectFilename(disposition, task.url, contentType);
      if (detected && detected !== task.filename) {
        const dir = path.dirname(task.filepath);
        task.filepath = this.events.reservePath ? this.events.reservePath(dir, detected) : path.join(dir, detected);
        task.filename = path.basename(task.filepath);
      }
    }
    if (!task.category || task.category === 'other') {
      task.category = detectCategory(task.filename, contentType);
    }

    this.createSegments();
  }

  private createSegments(): void {
    const task = this.task;
    const total = task.totalBytes;
    if (!task.resumable || total <= 0) {
      task.segments = [makeSegment(0, 0, Math.max(total - 1, 0))];
      return;
    }
    const wanted = Math.max(1, Math.min(task.connections || 16, 32));
    const count = Math.max(1, Math.min(wanted, Math.floor(total / MIN_SEGMENT_BYTES)));
    const size = Math.floor(total / count);
    task.segments = Array.from({ length: count }, (_, i) =>
      makeSegment(i, i * size, i === count - 1 ? total - 1 : (i + 1) * size - 1)
    );
  }

  private resetProgress(): void {
    this.task.downloadedBytes = 0;
    for (const s of this.task.segments) {
      s.currentByte = s.startByte;
      s.downloaded = 0;
      s.status = 'pending';
    }
  }

  // ─────────────────────────── multi-segment ───────────────────────────

  private async runSegmented(): Promise<void> {
    const gen = this.generation;
    const pending = this.task.segments.filter((s) => s.status !== 'completed');
    for (const s of pending) {
      s.status = 'pending';
      s.total = s.endByte - s.startByte + 1;
      s.downloaded = Math.max(0, s.currentByte - s.startByte);
    }

    try {
      await Promise.all(pending.map((s) => this.segmentWorker(s, gen)));
    } catch (err) {
      // One segment failed for good: stop the others before reporting.
      this.generation++;
      this.destroyRequests();
      throw err;
    }
    if (!this.alive(gen)) return;

    const incomplete = this.task.segments.some((s) => s.currentByte <= s.endByte);
    if (incomplete) throw new Error('Download ended before all data was received');
  }

  /** Downloads its own segment, then keeps helping by splitting the slowest remaining one. */
  private async segmentWorker(segment: DownloadSegment, gen: number): Promise<void> {
    await this.downloadSegmentWithRetry(segment, gen);
    while (this.alive(gen)) {
      const stolen = this.stealWork();
      if (!stolen) return;
      await this.downloadSegmentWithRetry(stolen, gen);
    }
  }

  private async downloadSegmentWithRetry(segment: DownloadSegment, gen: number): Promise<void> {
    let attempt = 0;
    while (this.alive(gen)) {
      const before = segment.currentByte;
      try {
        await this.downloadSegment(segment, gen);
        return;
      } catch (err) {
        if (!this.alive(gen)) return;
        if (err instanceof RangeNotSupportedError) throw err;
        // Progress was made: this is a fresh failure, not a repeated one.
        attempt = segment.currentByte > before ? 1 : attempt + 1;
        segment.retries = (segment.retries || 0) + 1;
        if (attempt > SEGMENT_RETRIES) {
          segment.status = 'error';
          throw err;
        }
        segment.status = 'pending';
        await delay(Math.min(500 * 2 ** (attempt - 1), 8000));
      }
    }
  }

  private async downloadSegment(segment: DownloadSegment, gen: number): Promise<void> {
    if (segment.currentByte > segment.endByte) {
      segment.status = 'completed';
      return;
    }
    segment.status = 'downloading';
    const start = segment.currentByte;
    const { res } = await this.open('GET', this.resolvedUrl || this.task.url, {
      Range: `bytes=${start}-${segment.endByte}`,
    });
    if (!this.alive(gen)) {
      res.destroy();
      return;
    }

    if (res.statusCode === 200) {
      // Full body instead of the slice: only OK if this is the whole file anyway.
      if (start !== 0 || this.task.segments.length > 1) {
        res.destroy();
        throw new RangeNotSupportedError();
      }
    } else if (res.statusCode !== 206) {
      res.destroy();
      throw new Error(`Server responded with HTTP ${res.statusCode} ${res.statusMessage || ''}`.trim());
    }

    await new Promise<void>((resolve, reject) => {
      let offset = start;
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        res.removeAllListeners('data');
        res.destroy();
        if (err) reject(err);
        else resolve();
      };

      const write = (chunk: Buffer) => {
        // endByte may have shrunk since the request (work stolen by another thread)
        const allowed = segment.endByte - offset + 1;
        if (allowed <= 0) {
          segment.status = 'completed';
          return finish();
        }
        const buf = chunk.length > allowed ? chunk.subarray(0, allowed) : chunk;
        if (this.fd === null) return finish();
        fs.writeSync(this.fd, buf, 0, buf.length, offset);
        offset += buf.length;
        segment.currentByte = offset;
        segment.downloaded += buf.length;
        this.task.downloadedBytes += buf.length;
        if (offset > segment.endByte) {
          segment.status = 'completed';
          finish();
        }
      };

      // A throttled chunk may still be waiting for bandwidth when the response
      // ends, so end/close are evaluated only after pending writes are done.
      let pending: Promise<void> = Promise.resolve();
      res.on('data', (chunk: Buffer) => {
        if (!this.alive(gen)) return finish();
        const limiter = this.rateLimiter;
        if (limiter && !limiter.isUnlimited()) {
          res.pause();
          pending = pending
            .then(() => limiter.acquire(chunk.length))
            .then(() => {
              if (settled) return;
              if (!this.alive(gen)) return finish();
              try {
                write(chunk);
              } catch (e: any) {
                return finish(e);
              }
              if (!settled) res.resume();
            });
          return;
        }
        try {
          write(chunk);
        } catch (e: any) {
          finish(e);
        }
      });
      const onEnd = () =>
        pending.then(() => {
          if (offset > segment.endByte || !this.alive(gen)) finish();
          else finish(new Error('Connection closed before the segment finished'));
        });
      res.on('end', onEnd);
      res.on('error', (e) => pending.then(() => finish(this.alive(gen) ? e : undefined)));
      res.on('close', () => {
        pending.then(() => {
          if (settled) return;
          if (offset > segment.endByte || !this.alive(gen)) finish();
          else finish(new Error('Connection closed unexpectedly'));
        });
      });
    });
  }

  /** Splits the segment with the most bytes left; returns the new second half. */
  private stealWork(): DownloadSegment | null {
    let target: DownloadSegment | null = null;
    let best = MIN_STEAL_BYTES * 2;
    for (const s of this.task.segments) {
      if (s.status !== 'downloading') continue;
      const remaining = s.endByte - s.currentByte + 1;
      if (remaining > best) {
        best = remaining;
        target = s;
      }
    }
    if (!target) return null;

    const remaining = target.endByte - target.currentByte + 1;
    const newStart = target.currentByte + Math.ceil(remaining / 2);
    const oldEnd = target.endByte;
    target.endByte = newStart - 1;
    target.total = target.endByte - target.startByte + 1;

    const seg = makeSegment(this.task.segments.length, newStart, oldEnd);
    this.task.segments.push(seg);
    return seg;
  }

  // ─────────────────────────── single stream ───────────────────────────

  private async runSingleStreamWithRetry(): Promise<void> {
    const gen = this.generation;
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 3 && this.alive(gen); attempt++) {
      try {
        await this.runSingleStream(gen);
        return;
      } catch (err: any) {
        lastErr = err;
        if (!this.alive(gen)) return;
        await delay(1000 * (attempt + 1));
      }
    }
    if (lastErr && this.alive(gen)) throw lastErr;
  }

  /** Non-resumable download: always starts from byte 0 with counters reset. */
  private async runSingleStream(gen: number): Promise<void> {
    const task = this.task;
    task.downloadedBytes = 0;
    task.segments = [makeSegment(0, 0, Math.max(task.totalBytes - 1, 0))];
    const seg = task.segments[0];
    if (this.fd !== null) fs.ftruncateSync(this.fd, 0);

    const { res } = await this.open('GET', this.resolvedUrl || task.url, {}, true);
    if (!res.statusCode || res.statusCode >= 400) {
      res.destroy();
      throw new Error(`Server responded with HTTP ${res.statusCode} ${res.statusMessage || ''}`.trim());
    }
    if (!task.totalBytes && res.headers['content-length']) {
      task.totalBytes = parseInt(String(res.headers['content-length']), 10) || 0;
      seg.endByte = Math.max(task.totalBytes - 1, 0);
      seg.total = task.totalBytes;
    }
    seg.status = 'downloading';

    await new Promise<void>((resolve, reject) => {
      let offset = 0;
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        res.removeAllListeners('data');
        res.destroy();
        if (err) reject(err);
        else resolve();
      };
      const write = (chunk: Buffer) => {
        if (this.fd === null) return finish();
        fs.writeSync(this.fd, chunk, 0, chunk.length, offset);
        offset += chunk.length;
        task.downloadedBytes = offset;
        seg.downloaded = offset;
        seg.currentByte = offset;
      };
      let pending: Promise<void> = Promise.resolve();
      res.on('data', (chunk: Buffer) => {
        if (!this.alive(gen)) return finish();
        const limiter = this.rateLimiter;
        if (limiter && !limiter.isUnlimited()) {
          res.pause();
          pending = pending
            .then(() => limiter.acquire(chunk.length))
            .then(() => {
              if (settled) return;
              if (!this.alive(gen)) return finish();
              try {
                write(chunk);
              } catch (e: any) {
                return finish(e);
              }
              res.resume();
            });
          return;
        }
        try {
          write(chunk);
        } catch (e: any) {
          finish(e);
        }
      });
      res.on('end', () => pending.then(() => {
        if (settled) return;
        if (!this.alive(gen)) return finish();
        if (task.totalBytes > 0 && offset < task.totalBytes) {
          return finish(new Error('Connection closed before the download finished'));
        }
        task.totalBytes = offset;
        seg.endByte = Math.max(offset - 1, 0);
        seg.total = offset;
        seg.status = 'completed';
        finish();
      }));
      res.on('error', (e) => pending.then(() => finish(this.alive(gen) ? e : undefined)));
      res.on('close', () => {
        // 'end' runs first when the body is complete; this only catches aborts
        setImmediate(() =>
          pending.then(() => {
            if (!settled) finish(this.alive(gen) ? new Error('Connection closed unexpectedly') : undefined);
          })
        );
      });
    });
  }

  // ───────────────────────────── finishing ─────────────────────────────

  private complete(): void {
    const task = this.task;
    if (this.fd !== null && task.totalBytes > 0) {
      try {
        fs.ftruncateSync(this.fd, task.totalBytes); // drop any stale tail
      } catch {
        /* ignore */
      }
    }
    this.closeFile();
    this.stopSpeedCalculation();
    this.stopped = true;
    task.status = 'completed';
    task.completedAt = Date.now();
    task.speed = 0;
    if (task.totalBytes > 0) task.downloadedBytes = task.totalBytes;
    for (const s of task.segments) {
      s.status = 'completed';
      s.speed = 0;
      s.currentByte = s.endByte + 1;
      s.downloaded = s.endByte - s.startByte + 1;
      s.total = s.downloaded;
    }
    this.events.onComplete(task);
  }

  private fail(err: Error): void {
    this.stopped = true;
    this.generation++;
    this.destroyRequests();
    this.closeFile();
    this.stopSpeedCalculation();
    this.task.status = 'error';
    this.task.errorMessage = friendlyNetworkError(err);
    this.task.speed = 0;
    for (const s of this.task.segments) s.speed = 0;
    this.events.onError(this.task, new Error(this.task.errorMessage));
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private alive(gen: number): boolean {
    return !this.stopped && gen === this.generation;
  }

  private open(
    method: 'GET' | 'HEAD',
    url: string,
    extraHeaders: Record<string, string> = {},
    allowCompression = false,
    redirects = 0
  ): Promise<{ res: http.IncomingMessage; url: string }> {
    return new Promise((resolve, reject) => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return reject(new Error('Invalid download URL'));
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return reject(new Error(`Unsupported protocol ${parsed.protocol}`));
      }
      const client = parsed.protocol === 'https:' ? https : http;
      const custom = { ...(this.task.headers || {}) };
      for (const k of Object.keys(custom)) {
        if (/^(host|range|content-length|connection|accept-encoding)$/i.test(k)) delete custom[k];
      }
      const headers: Record<string, string> = {
        'User-Agent': DEFAULT_USER_AGENT,
        Accept: '*/*',
        ...custom,
        ...extraHeaders,
      };
      if (!allowCompression) headers['Accept-Encoding'] = 'identity';

      const req = client.request(parsed, { method, headers }, (res) => {
        const loc = res.headers.location;
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
          res.resume();
          if (redirects >= MAX_REDIRECTS) return reject(new Error('Too many redirects'));
          const next = new URL(loc, url).toString();
          return this.open(method, next, extraHeaders, allowCompression, redirects + 1).then(resolve, reject);
        }
        resolve({ res, url });
      });
      req.setTimeout(IDLE_TIMEOUT_MS, () => req.destroy(new Error('Connection timed out')));
      req.on('error', reject);
      req.on('close', () => this.requests.delete(req));
      this.requests.add(req);
      req.end();
    });
  }

  private destroyRequests(): void {
    for (const req of this.requests) {
      try {
        req.destroy();
      } catch {
        /* ignore */
      }
    }
    this.requests.clear();
  }

  private closeFile(): void {
    if (this.fd !== null) {
      try {
        fs.closeSync(this.fd);
      } catch {
        /* ignore */
      }
      this.fd = null;
    }
  }

  private startSpeedCalculation(): void {
    this.stopSpeedCalculation();
    this.lastBytes = this.task.downloadedBytes;
    this.speedWindow = [];
    this.lastSegmentBytes.clear();
    for (const s of this.task.segments) this.lastSegmentBytes.set(s.id, s.downloaded);

    this.speedTimer = setInterval(() => {
      if (this.stopped) return this.stopSpeedCalculation();
      const now = this.task.downloadedBytes;
      this.speedWindow.push(Math.max(0, now - this.lastBytes));
      this.lastBytes = now;
      if (this.speedWindow.length > 5) this.speedWindow.shift();
      this.task.speed = Math.round(this.speedWindow.reduce((a, b) => a + b, 0) / this.speedWindow.length);

      for (const s of this.task.segments) {
        const prev = this.lastSegmentBytes.get(s.id) ?? s.downloaded;
        s.speed = s.status === 'downloading' ? Math.max(0, s.downloaded - prev) : 0;
        this.lastSegmentBytes.set(s.id, s.downloaded);
      }
      this.events.onProgress(this.task);
    }, 1000);
  }

  private stopSpeedCalculation(): void {
    if (this.speedTimer) {
      clearInterval(this.speedTimer);
      this.speedTimer = null;
    }
  }

  private detectFilename(disposition: string | undefined, fileUrl: string, contentType: string): string {
    if (disposition) {
      const star = disposition.match(/filename\*\s*=\s*(?:[\w-]+'[^']*')?("?)([^";]+)\1/i);
      const plain = disposition.match(/filename\s*=\s*("?)([^";]+)\1/i);
      const raw = star?.[2] || plain?.[2];
      if (raw) return sanitizeFilename(raw.trim());
    }
    try {
      const base = path.posix.basename(new URL(fileUrl).pathname);
      if (base && base.includes('.')) return sanitizeFilename(base);
    } catch {
      /* ignore */
    }
    const current = this.task.filename;
    const ext = MIME_EXT[contentType.split(';')[0].trim().toLowerCase()];
    if (ext && current && !path.extname(current)) return sanitizeFilename(current + ext);
    return '';
  }
}

const MIME_EXT: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'application/x-7z-compressed': '.7z',
  'application/vnd.rar': '.rar',
  'application/pdf': '.pdf',
  'application/x-msdownload': '.exe',
  'application/x-iso9660-image': '.iso',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

function makeSegment(id: number, start: number, end: number): DownloadSegment {
  return {
    id,
    startByte: start,
    endByte: end,
    currentByte: start,
    downloaded: 0,
    total: end - start + 1,
    status: 'pending',
    speed: 0,
    retries: 0,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function friendlyNetworkError(err: Error & { code?: string }): string {
  switch (err.code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'Could not reach the server (check the address or your connection)';
    case 'ECONNREFUSED':
      return 'The server refused the connection';
    case 'ECONNRESET':
      return 'The connection was reset by the server';
    case 'ENOSPC':
      return 'Not enough disk space';
    case 'EACCES':
    case 'EPERM':
      return 'No permission to write to the download folder';
    case 'CERT_HAS_EXPIRED':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      return 'The server has an invalid security certificate';
  }
  return err.message || 'Unknown network error';
}

export function detectCategory(filename: string, contentType = ''): DownloadCategory {
  const ext = path.extname(filename).toLowerCase();
  const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v', '.ts', '.m3u8'];
  const audioExts = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.opus'];
  const compExts = ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso'];
  const docExts = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.epub'];
  const progExts = ['.exe', '.msi', '.apk', '.dmg', '.deb', '.rpm', '.appimage', '.msix'];

  if (videoExts.includes(ext) || contentType.startsWith('video/')) return 'video';
  if (audioExts.includes(ext) || contentType.startsWith('audio/')) return 'audio';
  if (compExts.includes(ext) || /zip|compressed|rar|7z/.test(contentType)) return 'compressed';
  if (docExts.includes(ext) || /pdf|document|msword|text\//.test(contentType)) return 'document';
  if (progExts.includes(ext) || contentType.includes('msdownload')) return 'program';
  return 'other';
}
