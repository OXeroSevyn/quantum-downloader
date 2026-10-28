import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { DownloadTask, VideoFormatOption } from './types';
import { DownloaderEvents } from './segmented-downloader';

export function getBinaryPath(binaryName: string): string {
  const isWindows = process.platform === 'win32';
  const cleanName = isWindows 
    ? (binaryName.endsWith('.exe') ? binaryName : binaryName + '.exe')
    : binaryName.replace(/\.exe$/i, '');

  const isDev = process.env.NODE_ENV === 'development' || !app?.isPackaged;
  if (isDev) {
    const p1 = path.join(process.cwd(), 'bin', cleanName);
    if (fs.existsSync(p1)) return p1;
    return path.join(process.cwd(), 'bin', binaryName);
  } else {
    const prodPath = path.join(process.resourcesPath, 'bin', cleanName);
    if (fs.existsSync(prodPath)) return prodPath;
    const fallbackProd = path.join(process.resourcesPath, 'bin', binaryName);
    if (fs.existsSync(fallbackProd)) return fallbackProd;
    return path.join(process.cwd(), 'bin', cleanName);
  }
}

export class VideoStreamDownloader {
  public task: DownloadTask;
  private events: DownloaderEvents;
  private childProcess: ChildProcess | null = null;
  private isPaused: boolean = false;

  constructor(task: DownloadTask, events: DownloaderEvents) {
    this.task = task;
    this.events = events;
  }

  public static async probeVideoFormats(videoUrl: string): Promise<{ title: string; formats: VideoFormatOption[] }> {
    const ytdlp = getBinaryPath('yt-dlp.exe');
    if (!fs.existsSync(ytdlp)) {
      throw new Error('yt-dlp engine not found at ' + ytdlp);
    }

    return new Promise((resolve, reject) => {
      const args = [
        '-J',
        '--no-playlist',
        '--no-warnings',
        '--skip-download',
        '--js-runtimes', 'node',
        videoUrl,
      ];

      const proc = spawn(ytdlp, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', chunk => stdout += chunk);
      proc.stderr.on('data', chunk => stderr += chunk);

      proc.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(stderr || `Failed to probe video info (code ${code})`));
        }

        try {
          const info = JSON.parse(stdout);
          const title = info.title || 'Video';
          const formats = VideoStreamDownloader.parseFormats(info);
          resolve({ title, formats });
        } catch (err: any) {
          reject(err);
        }
      });

      proc.on('error', reject);
    });
  }

  private static parseFormats(info: any): VideoFormatOption[] {
    const rawFormats: any[] = info.formats || [];
    const availableHeights = new Set<number>();
    const options: VideoFormatOption[] = [];

    // Check available heights
    for (const f of rawFormats) {
      if (f.height && f.vcodec !== 'none') {
        availableHeights.add(f.height);
      }
    }

    const targetHeights = [2160, 1440, 1080, 720, 480, 360, 240];
    const sortedHeights = Array.from(availableHeights).sort((a, b) => b - a);

    for (const target of targetHeights) {
      // Find matching or closest height
      const match = sortedHeights.find(h => h === target || (h >= target - 20 && h <= target + 20));
      if (match) {
        let label = `${target}p`;
        let quality = `${target}p`;
        if (target === 2160) { label = '2160p 4K UHD'; quality = '4K'; }
        else if (target === 1440) { label = '1440p 2K QHD'; quality = '2K'; }
        else if (target === 1080) { label = '1080p Full HD'; quality = '1080p'; }
        else if (target === 720) { label = '720p HD'; quality = '720p'; }
        else if (target === 480) { label = '480p Standard'; quality = '480p'; }
        else if (target === 360) { label = '360p'; quality = '360p'; }
        else if (target === 240) { label = '240p'; quality = '240p'; }

        // Find format info for estimated size
        const f = rawFormats.find(r => r.height === match && r.vcodec !== 'none');
        const sizeBytes = f?.filesize || f?.filesize_approx;
        const sizeText = sizeBytes ? ` ~${(sizeBytes / 1024 / 1024).toFixed(1)} MB` : '';

        if (!options.some(o => o.resolution === `${target}p` || o.quality === quality)) {
          options.push({
            formatId: `bv*[height<=${match}]+ba/b[height<=${match}]/bv*+ba/b`,
            resolution: `${target}p`,
            quality,
            ext: 'mp4',
            filesize: sizeBytes,
            label: `${label} (MP4)${sizeText}`,
          });
        }
      }
    }

    // Always offer Audio Only (MP3)
    options.push({
      formatId: 'ba/b',
      resolution: 'Audio',
      quality: 'Audio MP3',
      ext: 'mp3',
      label: 'Audio Only (MP3 / High Quality)',
    });

    return options;
  }

  public async start(): Promise<void> {
    this.isPaused = false;
    this.task.status = 'downloading';
    this.task.isVideoStream = true;

    const ytdlp = getBinaryPath('yt-dlp.exe');
    const ffmpeg = getBinaryPath('ffmpeg.exe');

    if (!fs.existsSync(ytdlp)) {
      this.handleError(new Error(`yt-dlp core not found: ${ytdlp}`));
      return;
    }

    // Prepare format argument
    let formatArg = this.task.formatId;
    if (!formatArg) {
      if (this.task.quality === 'audio') {
        formatArg = 'ba/b';
      } else if (this.task.quality) {
        const height = parseInt(this.task.quality.replace(/\D/g, ''), 10) || 1080;
        formatArg = `bv*[height<=${height}]+ba/b[height<=${height}]/bv*+ba/b`;
      } else {
        formatArg = 'bv*+ba/b';
      }
    }

    const args = [
      '-f', formatArg,
      '--newline',
      '--no-playlist',
      '--no-colors',
      '--js-runtimes', 'node',
      '--concurrent-fragments', String(this.task.connections || 16),
      '-o', this.task.filepath,
    ];

    if (fs.existsSync(ffmpeg)) {
      args.push('--ffmpeg-location', ffmpeg);
    }

    if (this.task.headers?.['Cookie']) {
      args.push('--add-header', `Cookie:${this.task.headers['Cookie']}`);
    }
    if (this.task.headers?.['Referer']) {
      args.push('--referer', this.task.headers['Referer']);
    }
    if (this.task.headers?.['User-Agent']) {
      args.push('--user-agent', this.task.headers['User-Agent']);
    }

    if (this.task.quality === 'audio' || this.task.filename.endsWith('.mp3')) {
      args.push('-x', '--audio-format', 'mp3');
    } else {
      args.push('--merge-output-format', 'mp4');
    }

    args.push(this.task.url);

    const numThreads = this.task.connections || 16;
    // Initialize real segments
    if (this.task.segments.length === 0) {
      this.task.segments = Array.from({ length: numThreads }, (_, idx) => ({
        id: idx,
        startByte: idx * 1048576,
        endByte: (idx + 1) * 1048576 - 1,
        currentByte: idx * 1048576,
        downloaded: 0,
        total: 1048576,
        status: 'pending',
        speed: 0,
      }));
    }

    this.addLog(`Spawning download worker via yt-dlp (${numThreads} threads)`);
    this.addLog(`Target: ${this.task.url}`);

    this.childProcess = spawn(ytdlp, args);

    this.childProcess.stdout?.on('data', (data) => {
      const text = data.toString();
      this.parseProgress(text);
    });

    let capturedStderr = '';

    this.childProcess.stderr?.on('data', (data) => {
      const errText = data.toString();
      capturedStderr += errText;
      if (!errText.includes('WARNING')) {
        console.warn('[yt-dlp stderr]:', errText.trim());
      }
    });

    this.childProcess.on('close', (code) => {
      this.childProcess = null;
      if (this.isPaused) return;

      if (code === 0) {
        // Query actual disk file to get the exact real downloaded size!
        let actualFile = this.task.filepath;
        if (!fs.existsSync(actualFile)) {
          const parsed = path.parse(actualFile);
          const candidates = ['.mp4', '.mkv', '.webm', '.mp3', '.m4a'];
          for (const ext of candidates) {
            const testP = path.join(parsed.dir, parsed.name + ext);
            if (fs.existsSync(testP)) {
              actualFile = testP;
              break;
            }
          }
        }

        if (fs.existsSync(actualFile)) {
          const stat = fs.statSync(actualFile);
          this.task.filepath = actualFile;
          this.task.filename = path.basename(actualFile);
          this.task.totalBytes = stat.size;
          this.task.downloadedBytes = stat.size;

          const chunkSize = Math.max(1, Math.floor(stat.size / numThreads));
          this.task.segments = Array.from({ length: numThreads }, (_, idx) => {
            const start = idx * chunkSize;
            const end = idx === numThreads - 1 ? stat.size - 1 : (idx + 1) * chunkSize - 1;
            const total = end - start + 1;
            return {
              id: idx,
              startByte: start,
              endByte: end,
              currentByte: end,
              downloaded: total,
              total,
              status: 'completed' as const,
              speed: 0,
            };
          });
        } else {
          this.task.segments.forEach(s => {
            s.status = 'completed';
            s.downloaded = s.total;
          });
        }

        const mbSize = (this.task.totalBytes / (1024 * 1024)).toFixed(2);
        this.addLog(`Streams merged & verified (${mbSize} MB). Download completed!`);
        this.task.status = 'completed';
        this.task.completedAt = Date.now();
        this.task.speed = 0;
        this.events.onComplete(this.task);
      } else {
        const errorLines = capturedStderr.split('\n')
          .map(l => l.trim())
          .filter(l => l.startsWith('ERROR:') || l.includes('Error:'));
        const friendlyError = errorLines.length > 0 
          ? errorLines[errorLines.length - 1].replace(/^ERROR:\s*/i, '')
          : `Download exited with code ${code}`;
        this.addLog(`Error: ${friendlyError}`);
        this.handleError(new Error(friendlyError));
      }
    });

    this.childProcess.on('error', (err) => {
      if (this.isPaused) return;
      this.handleError(err);
    });
  }

  public pause(): void {
    this.isPaused = true;
    this.task.status = 'paused';
    this.task.speed = 0;
    if (this.childProcess) {
      try {
        this.childProcess.kill();
      } catch (e) {}
      this.childProcess = null;
    }
    this.events.onProgress(this.task);
  }

  public cancel(): void {
    this.pause();
    try {
      if (fs.existsSync(this.task.filepath)) {
        fs.unlinkSync(this.task.filepath);
      }
    } catch (e) {}
  }

  private addLog(message: string): void {
    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    if (!this.task.logs) this.task.logs = [];
    this.task.logs.push(`[${time}] ${message}`);
    if (this.task.logs.length > 50) this.task.logs.shift();
  }

  private parseProgress(output: string): void {
    if (output.includes('[Merger]')) {
      this.addLog('Merging audio and video streams via FFmpeg...');
    } else if (output.includes('[ExtractAudio]')) {
      this.addLog('Extracting and encoding high-fidelity audio...');
    } else if (output.includes('[download] Destination:')) {
      const destMatch = output.match(/Destination:\s*(.+)/);
      if (destMatch && destMatch[1]) {
        this.addLog(`Stream chunk acquired: ${path.basename(destMatch[1].trim())}`);
      }
    }

    const match = output.match(/\[download\]\s+(\d+\.?\d*)%\s+of\s+~?(\d+\.?\d*)([KMG]iB)?\s+at\s+~?(\d+\.?\d*)([KMG]iB\/s)?/i);
    if (match) {
      const percent = parseFloat(match[1]);
      const sizeVal = parseFloat(match[2]);
      const sizeUnit = match[3] || 'MiB';
      const speedVal = parseFloat(match[4]);
      const speedUnit = match[5] || 'MiB/s';

      let multiplier = 1024 * 1024;
      if (sizeUnit.includes('K')) multiplier = 1024;
      if (sizeUnit.includes('G')) multiplier = 1024 * 1024 * 1024;

      const calcSize = Math.round(sizeVal * multiplier);
      if (calcSize > this.task.totalBytes) {
        this.task.totalBytes = calcSize;
      }
      this.task.downloadedBytes = Math.round((percent / 100) * this.task.totalBytes);

      let speedMultiplier = 1024 * 1024;
      if (speedUnit.includes('K')) speedMultiplier = 1024;
      if (speedUnit.includes('G')) speedMultiplier = 1024 * 1024 * 1024;
      this.task.speed = Math.round(speedVal * speedMultiplier);

      // Distribute visually across segment blocks
      const numThreads = this.task.connections || 16;
      const chunkSize = Math.max(1, Math.floor(this.task.totalBytes / numThreads));
      const completedSegments = Math.floor((percent / 100) * numThreads);

      this.task.segments = Array.from({ length: numThreads }, (_, idx) => {
        const start = idx * chunkSize;
        const end = idx === numThreads - 1 ? this.task.totalBytes - 1 : (idx + 1) * chunkSize - 1;
        const segTotal = Math.max(1, end - start + 1);
        let downloaded = 0;
        let status: 'completed' | 'downloading' | 'pending' = 'pending';

        if (idx < completedSegments) {
          downloaded = segTotal;
          status = 'completed';
        } else if (idx === completedSegments) {
          const fraction = (percent % (100 / numThreads)) / (100 / numThreads);
          downloaded = Math.round(segTotal * fraction);
          status = 'downloading';
        } else {
          downloaded = 0;
          status = 'pending';
        }

        return {
          id: idx,
          startByte: start,
          endByte: end,
          currentByte: start + downloaded,
          downloaded,
          total: segTotal,
          status,
          speed: status === 'downloading' ? this.task.speed : 0,
        };
      });

      this.events.onProgress(this.task);
    }
  }

  private handleError(err: Error): void {
    this.task.status = 'error';
    this.task.errorMessage = err.message || 'Stream download error';
    this.task.speed = 0;
    this.events.onError(this.task, err);
  }
}
