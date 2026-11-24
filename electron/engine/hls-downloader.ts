import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { URL } from 'url';
import { DownloadTask, DownloadSegment } from './types';
import { DownloaderEvents, friendlyNetworkError } from './segmented-downloader';
import { DEFAULT_USER_AGENT, safeUnlink } from './file-utils';
import { getBinaryPath } from './binaries';

interface HlsKey {
  method: string;
  uri?: string;
  iv?: Buffer;
}

interface HlsMediaSegment {
  url: string;
  sequence: number;
  key: HlsKey | null;
}

const VISUAL_BARS = 32;
const SEGMENT_RETRIES = 4;
const MAX_AHEAD = 24;

export class HlsDownloader {
  public task: DownloadTask;
  private events: DownloaderEvents;
  private stopped = false;
  private requests = new Set<http.ClientRequest>();
  private fd: number | null = null;
  private speedTimer: NodeJS.Timeout | null = null;
  private lastBytes = 0;
  private segments: HlsMediaSegment[] = [];
  private initSegmentUrl: string | null = null;
  private keyCache = new Map<string, Promise<Buffer>>();
  private ffmpegProc: ReturnType<typeof spawn> | null = null;

  constructor(task: DownloadTask, events: DownloaderEvents) {
    this.task = task;
    this.events = events;
  }

  public async start(): Promise<void> {
    this.stopped = false;
    const task = this.task;
    task.status = 'downloading';
    task.isHls = true;
    task.errorMessage = undefined;

    try {
      await this.parsePlaylist();
      if (this.stopped) return;

      fs.mkdirSync(path.dirname(task.filepath), { recursive: true });

      const startIndex = task.hlsIndex || 0;
      const canResume =
        startIndex > 0 && startIndex <= this.segments.length && task.downloadedBytes > 0 && fs.existsSync(task.filepath);

      if (canResume) {
        // Drop anything written after the last fully committed segment
        fs.truncateSync(task.filepath, task.downloadedBytes);
        this.fd = fs.openSync(task.filepath, 'a');
      } else {
        task.hlsIndex = 0;
        task.downloadedBytes = 0;
        this.fd = fs.openSync(task.filepath, 'w');
        if (this.initSegmentUrl) {
          const init = await this.fetchWithRetry(this.initSegmentUrl);
          if (this.stopped) return;
          fs.writeSync(this.fd, init);
          task.downloadedBytes += init.length;
        }
      }

      this.startSpeedCalculation();
      await this.downloadSegments();
      if (this.stopped) return;

      this.closeFile();
      await this.finish();
    } catch (err: any) {
      if (!this.stopped) this.fail(err instanceof Error ? err : new Error(String(err)));
    }
  }

  public pause(): void {
    this.stopped = true;
    for (const req of this.requests) {
      try {
        req.destroy();
      } catch {
        /* ignore */
      }
    }
    this.requests.clear();
    if (this.ffmpegProc) {
      try {
        this.ffmpegProc.kill();
      } catch {
        /* ignore */
      }
      this.ffmpegProc = null;
    }
    this.closeFile();
    this.stopSpeedCalculation();
    this.task.status = 'paused';
    this.task.speed = 0;
  }

  public cancel(): void {
    this.pause();
    safeUnlink(this.task.filepath);
  }

  // ───────────────────────────── playlist ─────────────────────────────

  private async parsePlaylist(): Promise<void> {
    const task = this.task;
    let playlistUrl = task.hlsSourceUrl || task.url;
    let text = (await this.fetchWithRetry(playlistUrl)).toString('utf8');
    if (!text.trimStart().startsWith('#EXTM3U')) {
      throw new Error('This link is not a valid HLS (.m3u8) playlist');
    }

    // Master playlist: choose the highest-bandwidth variant
    if (text.includes('#EXT-X-STREAM-INF')) {
      const lines = text.split(/\r?\n/);
      let best = -1;
      let bestUri = '';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
        const bw = parseInt(line.match(/BANDWIDTH=(\d+)/)?.[1] || '0', 10);
        let j = i + 1;
        while (j < lines.length && (lines[j].trim() === '' || lines[j].trim().startsWith('#'))) j++;
        const uri = lines[j]?.trim();
        if (uri && bw > best) {
          best = bw;
          bestUri = uri;
        }
      }
      if (!bestUri) throw new Error('No playable stream variant found in the playlist');
      playlistUrl = new URL(bestUri, playlistUrl).toString();
      text = (await this.fetchWithRetry(playlistUrl)).toString('utf8');
    }
    task.hlsSourceUrl = playlistUrl;

    const segments: HlsMediaSegment[] = [];
    let sequence = 0;
    let key: HlsKey | null = null;
    this.initSegmentUrl = null;

    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
        sequence = parseInt(line.split(':')[1], 10) || 0;
      } else if (line.startsWith('#EXT-X-KEY:')) {
        const attrs = parseAttributes(line.slice('#EXT-X-KEY:'.length));
        const method = (attrs.METHOD || 'NONE').toUpperCase();
        if (method === 'NONE') key = null;
        else if (method === 'AES-128') {
          key = {
            method,
            uri: attrs.URI ? new URL(attrs.URI, playlistUrl).toString() : undefined,
            iv: attrs.IV ? Buffer.from(attrs.IV.replace(/^0x/i, '').padStart(32, '0'), 'hex') : undefined,
          };
        } else {
          throw new Error('This stream is DRM-protected (SAMPLE-AES) and cannot be downloaded');
        }
      } else if (line.startsWith('#EXT-X-MAP:')) {
        const attrs = parseAttributes(line.slice('#EXT-X-MAP:'.length));
        if (attrs.URI && !this.initSegmentUrl) this.initSegmentUrl = new URL(attrs.URI, playlistUrl).toString();
      } else if (!line.startsWith('#')) {
        segments.push({ url: new URL(line, playlistUrl).toString(), sequence, key });
        sequence++;
      }
    }

    if (segments.length === 0) throw new Error('No video segments found in the playlist');
    this.segments = segments;
    task.hlsCount = segments.length;
    task.resumable = true;
    this.updateVisualSegments();
  }

  // ───────────────────────────── downloading ─────────────────────────────

  private async downloadSegments(): Promise<void> {
    const task = this.task;
    const concurrency = Math.max(1, Math.min(task.connections || 8, 12));
    const buffered = new Map<number, Buffer>();
    let nextFetch = task.hlsIndex || 0;
    let firstError: Error | null = null;

    const flush = () => {
      while (buffered.has(task.hlsIndex || 0)) {
        const idx = task.hlsIndex || 0;
        const data = buffered.get(idx)!;
        buffered.delete(idx);
        if (this.fd === null) return;
        fs.writeSync(this.fd, data);
        task.downloadedBytes += data.length;
        task.hlsIndex = idx + 1;
      }
      // Estimate the final size from the average segment so far
      const done = task.hlsIndex || 0;
      if (done > 0) {
        task.totalBytes = Math.max(task.downloadedBytes, Math.round((task.downloadedBytes / done) * this.segments.length));
      }
    };

    const worker = async () => {
      while (!this.stopped && !firstError) {
        const idx = nextFetch++;
        if (idx >= this.segments.length) return;
        // Don't let fast workers run too far ahead of the writer (bounded memory)
        while (!this.stopped && !firstError && idx - (task.hlsIndex || 0) > MAX_AHEAD) await delay(100);
        if (this.stopped || firstError) return;
        try {
          const seg = this.segments[idx];
          let data = await this.fetchWithRetry(seg.url);
          if (seg.key) data = await this.decrypt(data, seg);
          buffered.set(idx, data);
          flush();
          this.updateVisualSegments();
        } catch (err: any) {
          if (!this.stopped && !firstError) firstError = err;
          return;
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    if (this.stopped) return;
    if (firstError) throw firstError;
    if ((task.hlsIndex || 0) < this.segments.length) throw new Error('Stream ended before all segments were saved');
  }

  private async decrypt(data: Buffer, seg: HlsMediaSegment): Promise<Buffer> {
    const k = seg.key!;
    if (!k.uri) throw new Error('Encrypted stream is missing its key');
    if (!this.keyCache.has(k.uri)) this.keyCache.set(k.uri, this.fetchWithRetry(k.uri));
    const key = await this.keyCache.get(k.uri)!;
    if (key.length !== 16) throw new Error('Invalid AES-128 key for this stream');
    let iv = k.iv;
    if (!iv) {
      iv = Buffer.alloc(16);
      iv.writeUInt32BE(Math.floor(seg.sequence / 2 ** 32), 8);
      iv.writeUInt32BE(seg.sequence >>> 0, 12);
    }
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  }

  private async fetchWithRetry(url: string): Promise<Buffer> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= SEGMENT_RETRIES; attempt++) {
      if (this.stopped) throw new Error('Paused');
      try {
        return await this.fetchBuffer(url);
      } catch (err: any) {
        lastErr = err;
        if (err?.permanent) break;
        await delay(Math.min(500 * 2 ** attempt, 6000));
      }
    }
    throw lastErr || new Error('Failed to download stream segment');
  }

  private fetchBuffer(urlStr: string, redirects = 0): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(urlStr);
      const client = parsed.protocol === 'https:' ? https : http;
      const custom = { ...(this.task.headers || {}) };
      for (const k of Object.keys(custom)) if (/^(host|range|content-length)$/i.test(k)) delete custom[k];

      const req = client.get(parsed, { headers: { 'User-Agent': DEFAULT_USER_AGENT, Accept: '*/*', ...custom } }, (res) => {
        const loc = res.headers.location;
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
          res.resume();
          if (redirects > 8) return reject(new Error('Too many redirects'));
          return this.fetchBuffer(new URL(loc, urlStr).toString(), redirects + 1).then(resolve, reject);
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume();
          const e: any = new Error(`Stream server responded with HTTP ${res.statusCode}`);
          e.permanent = res.statusCode === 403 || res.statusCode === 404 || res.statusCode === 410;
          return reject(e);
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          const expected = parseInt(String(res.headers['content-length'] || '0'), 10);
          if (expected && body.length < expected) reject(new Error('Segment download was cut short'));
          else resolve(body);
        });
        res.on('error', reject);
        res.on('aborted', () => reject(new Error('Segment download was interrupted')));
      });
      req.setTimeout(30_000, () => req.destroy(new Error('Connection timed out')));
      req.on('error', reject);
      req.on('close', () => this.requests.delete(req));
      this.requests.add(req);
    });
  }

  // ───────────────────────────── finishing ─────────────────────────────

  private async finish(): Promise<void> {
    const task = this.task;
    task.totalBytes = task.downloadedBytes;
    task.speed = 0;
    this.stopSpeedCalculation();

    // Remux the transport stream into a regular MP4 when ffmpeg is available
    const ffmpeg = getBinaryPath('ffmpeg');
    if (fs.existsSync(ffmpeg) && /\.ts$/i.test(task.filepath)) {
      const dir = path.dirname(task.filepath);
      const desired = path.basename(task.filepath).replace(/\.ts$/i, '.mp4');
      const target = this.events.reservePath ? this.events.reservePath(dir, desired) : path.join(dir, desired);
      task.logs = [...(task.logs || []), 'Converting stream to MP4…'];
      this.events.onProgress(task);
      const ok = await this.remux(ffmpeg, task.filepath, target);
      if (this.stopped) return;
      if (ok && fs.existsSync(target) && fs.statSync(target).size > 0) {
        safeUnlink(task.filepath);
        task.filepath = target;
        task.filename = path.basename(target);
        task.totalBytes = task.downloadedBytes = fs.statSync(target).size;
      } else {
        safeUnlink(target);
      }
    }

    this.stopped = true;
    task.status = 'completed';
    task.completedAt = Date.now();
    for (const s of task.segments) {
      s.status = 'completed';
      s.downloaded = s.total;
      s.currentByte = s.endByte + 1;
      s.speed = 0;
    }
    this.events.onComplete(task);
  }

  private remux(ffmpeg: string, input: string, output: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-i', input, '-c', 'copy', '-bsf:a', 'aac_adtstoasc', output], {
        windowsHide: true,
      });
      this.ffmpegProc = proc;
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => {
        this.ffmpegProc = null;
        resolve(code === 0);
      });
    });
  }

  private fail(err: Error): void {
    this.stopped = true;
    for (const req of this.requests) req.destroy();
    this.requests.clear();
    this.closeFile();
    this.stopSpeedCalculation();
    this.task.status = 'error';
    this.task.errorMessage = friendlyNetworkError(err);
    this.task.speed = 0;
    this.events.onError(this.task, new Error(this.task.errorMessage));
  }

  private updateVisualSegments(): void {
    const total = this.segments.length;
    if (!total) return;
    const bars = Math.min(VISUAL_BARS, total);
    const done = this.task.hlsIndex || 0;
    const per = total / bars;
    const segs: DownloadSegment[] = [];
    for (let i = 0; i < bars; i++) {
      const start = Math.floor(i * per);
      const end = Math.floor((i + 1) * per) - 1;
      const count = end - start + 1;
      const finished = Math.max(0, Math.min(count, done - start));
      segs.push({
        id: i,
        startByte: start,
        endByte: end,
        currentByte: start + finished,
        downloaded: finished,
        total: count,
        status: finished >= count ? 'completed' : finished > 0 || (this.task.status === 'downloading' && done >= start && done <= end) ? 'downloading' : 'pending',
        speed: 0,
      });
    }
    this.task.segments = segs;
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
    const window: number[] = [];
    this.speedTimer = setInterval(() => {
      if (this.stopped) return this.stopSpeedCalculation();
      window.push(Math.max(0, this.task.downloadedBytes - this.lastBytes));
      if (window.length > 4) window.shift();
      this.lastBytes = this.task.downloadedBytes;
      this.task.speed = Math.round(window.reduce((a, b) => a + b, 0) / window.length);
      this.events.onProgress(this.task);
    }, 1000);
  }

  private stopSpeedCalculation(): void {
    if (this.speedTimer) {
      clearInterval(this.speedTimer);
      this.speedTimer = null;
    }
  }
}

function parseAttributes(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) out[m[1].toUpperCase()] = m[2].replace(/^"|"$/g, '');
  return out;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
