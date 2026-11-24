import { spawn, execFile, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { DownloadTask, VideoFormatOption, DownloadSegment } from './types';
import { DownloaderEvents } from './segmented-downloader';
import { getBinaryPath, getJsRuntime } from './binaries';

export { getBinaryPath } from './binaries';

const VISUAL_BARS = 16;

function ytdlpBaseArgs(): { args: string[]; env: NodeJS.ProcessEnv } {
  const args = ['--no-colors', '--no-playlist', '--encoding', 'utf-8'];
  const runtime = getJsRuntime();
  if (runtime) args.push('--js-runtimes', runtime.arg);
  return { args, env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...(runtime?.env || {}) } };
}

function killTree(proc: ChildProcess | null): void {
  if (!proc || proc.pid === undefined) return;
  if (process.platform === 'win32') {
    // yt-dlp spawns ffmpeg; kill the whole tree so nothing keeps the file locked
    execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    try {
      proc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
}

function unitMultiplier(unit: string | undefined): number {
  const u = (unit || 'MiB').toUpperCase();
  if (u.startsWith('G')) return 1024 ** 3;
  if (u.startsWith('M')) return 1024 ** 2;
  if (u.startsWith('K')) return 1024;
  return 1;
}

export class VideoStreamDownloader {
  public task: DownloadTask;
  private events: DownloaderEvents;
  private child: ChildProcess | null = null;
  private stopped = false;
  private lastEmit = 0;
  /** Sizes of the streams already finished in this run (video, then audio…) */
  private finishedPhases: number[] = [];
  private currentPhaseTotal = 0;
  private finalPath: string | null = null;

  constructor(task: DownloadTask, events: DownloaderEvents) {
    this.task = task;
    this.events = events;
  }

  public static async probeVideoFormats(videoUrl: string): Promise<{ title: string; formats: VideoFormatOption[] }> {
    const ytdlp = getBinaryPath('yt-dlp');
    if (!fs.existsSync(ytdlp)) throw new Error('The video engine (yt-dlp) is missing from this installation');
    const { args, env } = ytdlpBaseArgs();

    return new Promise((resolve, reject) => {
      const proc = spawn(ytdlp, [...args, '-J', '--no-warnings', '--skip-download', videoUrl], { env, windowsHide: true });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        killTree(proc);
        reject(new Error('Timed out while reading video information'));
      }, 60_000);
      proc.stdout.on('data', (c) => (stdout += c));
      proc.stderr.on('data', (c) => (stderr += c));
      proc.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(lastYtdlpError(stderr) || `Could not read video information (code ${code})`));
        try {
          const info = JSON.parse(stdout);
          resolve({ title: info.title || 'Video', formats: VideoStreamDownloader.parseFormats(info) });
        } catch (err: any) {
          reject(err);
        }
      });
    });
  }

  private static parseFormats(info: any): VideoFormatOption[] {
    const raw: any[] = info.formats || [];
    const heights = Array.from(new Set(raw.filter((f) => f.height && f.vcodec !== 'none').map((f) => f.height as number))).sort(
      (a, b) => b - a
    );
    const labels: Record<number, [string, string]> = {
      2160: ['2160p 4K Ultra HD', '4K'],
      1440: ['1440p 2K QHD', '2K'],
      1080: ['1080p Full HD', '1080p'],
      720: ['720p HD', '720p'],
      480: ['480p', '480p'],
      360: ['360p', '360p'],
      240: ['240p', '240p'],
    };
    const options: VideoFormatOption[] = [];
    for (const target of [2160, 1440, 1080, 720, 480, 360, 240]) {
      const match = heights.find((h) => Math.abs(h - target) <= 20);
      if (!match) continue;
      const f = raw.find((r) => r.height === match && r.vcodec !== 'none');
      const size = f?.filesize || f?.filesize_approx;
      const [label, quality] = labels[target];
      options.push({
        formatId: `bv*[height<=${match}]+ba/b[height<=${match}]/bv*+ba/b`,
        resolution: `${target}p`,
        quality,
        ext: 'mp4',
        filesize: size,
        label: `${label}${size ? ` · ~${(size / 1048576).toFixed(0)} MB` : ''}`,
      });
    }
    if (options.length === 0) {
      options.push({ formatId: 'bv*+ba/b', resolution: 'Best', quality: 'Best', ext: 'mp4', label: 'Best available quality' });
    }
    options.push({ formatId: 'ba/b', resolution: 'Audio', quality: 'Audio MP3', ext: 'mp3', label: 'Audio only (MP3)' });
    return options;
  }

  public async start(): Promise<void> {
    this.stopped = false;
    const task = this.task;
    task.status = 'downloading';
    task.isVideoStream = true;
    task.errorMessage = undefined;
    this.finishedPhases = [];
    this.currentPhaseTotal = 0;
    this.finalPath = null;

    const ytdlp = getBinaryPath('yt-dlp');
    if (!fs.existsSync(ytdlp)) return this.fail('The video engine (yt-dlp) is missing from this installation');
    const ffmpeg = getBinaryPath('ffmpeg');

    const audioOnly =
      task.quality === 'audio' || task.formatId === 'ba/b' || /audio/i.test(task.quality || '') || /\.mp3$/i.test(task.filename);

    let format = task.formatId;
    if (!format) {
      if (audioOnly) format = 'ba/b';
      else if (task.quality && /\d/.test(task.quality)) {
        const h = parseInt(task.quality.replace(/\D/g, ''), 10) || 1080;
        format = `bv*[height<=${h}]+ba/b[height<=${h}]/bv*+ba/b`;
      } else format = 'bv*+ba/b';
    }

    const dir = path.dirname(task.filepath);
    fs.mkdirSync(dir, { recursive: true });
    // Let yt-dlp choose the extension; with an automatic name use the video's title.
    const template = task.autoName
      ? path.join(dir, '%(title).150B [%(id)s].%(ext)s')
      : path.join(dir, path.parse(task.filename).name.replace(/%/g, '%%') + '.%(ext)s');

    const { args, env } = ytdlpBaseArgs();
    args.push(
      '-f', format,
      '--newline',
      '--progress',
      '--no-mtime',
      '--windows-filenames',
      '--concurrent-fragments', String(Math.max(1, Math.min(task.connections || 8, 16))),
      '--print', 'after_move:QD_FINAL:%(filepath)s',
      '-o', template
    );
    if (fs.existsSync(ffmpeg)) args.push('--ffmpeg-location', ffmpeg);
    const h = task.headers || {};
    if (h['Cookie']) args.push('--add-header', `Cookie:${h['Cookie']}`);
    if (h['Referer']) args.push('--referer', h['Referer']);
    if (h['User-Agent']) args.push('--user-agent', h['User-Agent']);
    if (audioOnly) args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
    else args.push('--merge-output-format', 'mp4');
    args.push('--', task.url);

    this.addLog('Starting video engine…');
    if (task.segments.length === 0) this.updateVisualSegments(0);

    let stderr = '';
    let stdoutBuf = '';
    const child = spawn(ytdlp, args, { env, windowsHide: true });
    this.child = child;

    child.stdout?.on('data', (data: Buffer) => {
      stdoutBuf += data.toString('utf8');
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() || '';
      for (const line of lines) this.handleLine(line);
    });
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString('utf8');
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    child.on('error', (err) => {
      if (this.child !== child) return;
      this.child = null;
      if (!this.stopped) this.fail(err.message);
    });
    child.on('close', (code) => {
      if (this.child !== child) return;
      this.child = null;
      if (stdoutBuf) this.handleLine(stdoutBuf);
      if (this.stopped) return;
      if (code === 0) this.complete();
      else this.fail(lastYtdlpError(stderr) || `Video download failed (code ${code})`);
    });
  }

  public pause(): void {
    this.stopped = true;
    const c = this.child;
    this.child = null;
    killTree(c);
    this.task.status = 'paused';
    this.task.speed = 0;
  }

  public cancel(): void {
    this.pause();
    const task = this.task;
    const dir = path.dirname(task.filepath);
    const base = path.parse(task.filepath).name;
    // Give taskkill a moment to release file locks, then remove the partial files.
    setTimeout(() => {
      try {
        for (const f of fs.readdirSync(dir)) {
          if (f.startsWith(base + '.') && /\.(part|ytdl|temp)$|\.part-Frag\d+|\.f\d+\./i.test(f)) {
            fs.rmSync(path.join(dir, f), { force: true });
          }
        }
      } catch {
        /* ignore */
      }
    }, 800);
  }

  // ───────────────────────────── output parsing ─────────────────────────────

  private handleLine(line: string): void {
    const task = this.task;
    const text = line.trim();
    if (!text) return;

    if (text.startsWith('QD_FINAL:')) {
      this.finalPath = text.slice('QD_FINAL:'.length).trim();
      return;
    }
    const dest = text.match(/^\[download\] Destination:\s*(.+)$/);
    if (dest) {
      if (this.currentPhaseTotal > 0) this.finishedPhases.push(this.currentPhaseTotal);
      this.currentPhaseTotal = 0;
      const p = dest[1].trim();
      const clean = path.basename(p).replace(/\.f\d+(?=\.\w+$)/, '');
      if (task.autoName) {
        task.filename = clean;
        task.filepath = path.join(path.dirname(p), clean);
      }
      this.addLog(`Downloading stream ${this.finishedPhases.length + 1}`);
      return;
    }
    if (text.startsWith('[Merger]')) {
      this.addLog('Merging video and audio…');
      return this.emit(true);
    }
    if (text.startsWith('[ExtractAudio]')) {
      this.addLog('Converting audio to MP3…');
      return this.emit(true);
    }

    const m = text.match(
      /^\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*(\d+(?:\.\d+)?)\s*([KMGT]?i?B)(?:\s+at\s+~?\s*(\d+(?:\.\d+)?)\s*([KMGT]?i?B)\/s)?/i
    );
    if (!m) return;
    const percent = Math.min(100, parseFloat(m[1]));
    const size = Math.round(parseFloat(m[2]) * unitMultiplier(m[3]));
    this.currentPhaseTotal = Math.max(this.currentPhaseTotal, size);
    const doneBefore = this.finishedPhases.reduce((a, b) => a + b, 0);
    task.totalBytes = Math.max(task.totalBytes || 0, doneBefore + this.currentPhaseTotal);
    task.downloadedBytes = Math.min(task.totalBytes, doneBefore + Math.round((percent / 100) * this.currentPhaseTotal));
    task.speed = m[4] ? Math.round(parseFloat(m[4]) * unitMultiplier(m[5])) : 0;
    this.updateVisualSegments(task.totalBytes ? task.downloadedBytes / task.totalBytes : 0);
    this.emit();
  }

  private emit(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastEmit < 400) return;
    this.lastEmit = now;
    this.events.onProgress(this.task);
  }

  private updateVisualSegments(fraction: number): void {
    const total = this.task.totalBytes || VISUAL_BARS;
    const per = total / VISUAL_BARS;
    const doneBars = fraction * VISUAL_BARS;
    const segs: DownloadSegment[] = [];
    for (let i = 0; i < VISUAL_BARS; i++) {
      const start = Math.floor(i * per);
      const end = Math.floor((i + 1) * per) - 1;
      const segTotal = Math.max(1, end - start + 1);
      const f = Math.max(0, Math.min(1, doneBars - i));
      const downloaded = Math.round(segTotal * f);
      segs.push({
        id: i,
        startByte: start,
        endByte: end,
        currentByte: start + downloaded,
        downloaded,
        total: segTotal,
        status: f >= 1 ? 'completed' : f > 0 ? 'downloading' : 'pending',
        speed: f > 0 && f < 1 ? this.task.speed : 0,
      });
    }
    this.task.segments = segs;
  }

  private complete(): void {
    const task = this.task;
    let file = this.finalPath && fs.existsSync(this.finalPath) ? this.finalPath : task.filepath;
    if (!fs.existsSync(file)) {
      const parsed = path.parse(file);
      for (const ext of ['.mp4', '.mkv', '.webm', '.mp3', '.m4a', '.opus']) {
        const candidate = path.join(parsed.dir, parsed.name + ext);
        if (fs.existsSync(candidate)) {
          file = candidate;
          break;
        }
      }
    }
    if (fs.existsSync(file)) {
      const size = fs.statSync(file).size;
      task.filepath = file;
      task.filename = path.basename(file);
      task.totalBytes = task.downloadedBytes = size;
    }
    this.stopped = true;
    this.updateVisualSegments(1);
    task.status = 'completed';
    task.completedAt = Date.now();
    task.speed = 0;
    this.addLog('Finished');
    this.events.onComplete(task);
  }

  private fail(message: string): void {
    this.stopped = true;
    this.task.status = 'error';
    this.task.errorMessage = message;
    this.task.speed = 0;
    this.addLog(`Error: ${message}`);
    this.events.onError(this.task, new Error(message));
  }

  private addLog(message: string): void {
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const logs = this.task.logs || [];
    logs.push(`[${time}] ${message}`);
    this.task.logs = logs.slice(-50);
  }
}

function lastYtdlpError(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^ERROR:/i.test(l));
  const last = lines[lines.length - 1];
  return last ? last.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/i, '').slice(0, 300) : '';
}
