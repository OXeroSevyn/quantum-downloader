import path from 'path';
import fs from 'fs';
import { shell, BrowserWindow, Notification } from 'electron';
import { StorageManager } from './storage';
import { DownloadTask, AppSettings, DownloadCategory } from './types';
import { SegmentedDownloader, DownloaderEvents, detectCategory } from './segmented-downloader';
import { HlsDownloader } from './hls-downloader';
import { VideoStreamDownloader } from './video-stream-downloader';
import { TorrentDownloader } from './torrent-downloader';
import { RateLimiter } from './rate-limiter';
import { SchedulerManager } from './scheduler';
import { sanitizeFilename, uniqueFilePath, safeUnlink, isInsideDir } from './file-utils';

type Worker = SegmentedDownloader | HlsDownloader | VideoStreamDownloader | TorrentDownloader;

export interface AddTaskOptions {
  url: string;
  filename?: string;
  category?: DownloadCategory;
  headers?: Record<string, string>;
  quality?: string;
  formatId?: string;
  queueName?: string;
  priority?: number;
  /** Folder to save into; defaults to the configured download folder. */
  directory?: string;
}

const VIDEO_HOSTS =
  /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|tiktok\.com|twitter\.com|x\.com|instagram\.com|twitch\.tv|soundcloud\.com|facebook\.com|fb\.watch|reddit\.com|bilibili\.com)$/i;

export class DownloadManager {
  private storage: StorageManager;
  private tasks: Map<string, DownloadTask> = new Map();
  private workers: Map<string, Worker> = new Map();
  private settings: AppSettings;
  private mainWindow: BrowserWindow | null = null;
  private rateLimiter: RateLimiter;
  private scheduler: SchedulerManager;
  private bulk = false;
  private persistTimer: NodeJS.Timeout | null = null;
  private shutdownPending = false;

  constructor(storage: StorageManager) {
    this.storage = storage;
    this.settings = this.storage.getSettings();
    this.rateLimiter = new RateLimiter(this.settings.speedLimitKBps || 0);
    this.scheduler = new SchedulerManager(
      () => this.resumeAll(),
      () => this.pauseAll()
    );

    const autoResume = this.settings.autoResumeOnStartup !== false;
    for (const t of this.storage.getDownloads()) {
      if (t.status === 'downloading' || t.status === 'queued') t.status = autoResume ? 'queued' : 'paused';
      this.tasks.set(t.id, t);
    }
  }

  /** Called once the UI exists: starts queued work and the scheduler. */
  public init(): void {
    this.scheduler.setSchedule(this.settings.schedule);
    this.checkQueue();
    // Save progress regularly so a crash loses at most a few seconds
    this.persistTimer = setInterval(() => {
      if (this.workers.size > 0) this.persist();
    }, 5000);
  }

  public shutdown(): void {
    if (this.persistTimer) clearInterval(this.persistTimer);
    this.scheduler.destroy();
    for (const [id, worker] of this.workers) {
      worker.pause();
      const t = this.tasks.get(id);
      if (t) t.status = 'queued'; // resumes next launch when auto-resume is on
    }
    this.workers.clear();
    this.persist();
  }

  public setMainWindow(win: BrowserWindow | null) {
    this.mainWindow = win;
  }

  public getSettings(): AppSettings {
    return this.settings;
  }

  public updateSettings(patch: Partial<AppSettings>): AppSettings {
    const next: AppSettings = { ...this.settings, ...patch };
    next.defaultConnections = clamp(Number(next.defaultConnections) || 16, 1, 32);
    next.maxActiveDownloads = clamp(Number(next.maxActiveDownloads) || 4, 1, 16);
    next.speedLimitKBps = Math.max(0, Number(next.speedLimitKBps) || 0);
    if (!next.downloadDir || !path.isAbsolute(next.downloadDir)) next.downloadDir = this.settings.downloadDir;
    this.settings = next;

    if (patch.speedLimitKBps !== undefined) this.rateLimiter.setLimit(next.speedLimitKBps);
    if (patch.schedule !== undefined) this.scheduler.setSchedule(next.schedule);
    this.storage.saveSettings(next);
    if (patch.maxActiveDownloads !== undefined) this.checkQueue();
    return next;
  }

  public getAllTasks(): DownloadTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => {
      const p = (b.priority || 0) - (a.priority || 0);
      return p !== 0 ? p : b.createdAt - a.createdAt;
    });
  }

  public addTask(opts: AddTaskOptions): DownloadTask {
    let url = String(opts.url || '').trim();
    if (!url) throw new Error('Please enter a download link');

    const isMagnet = /^magnet:\?/i.test(url);
    if (!isMagnet && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
    if (!isMagnet) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error('That does not look like a valid link');
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Only http(s) links and magnet links are supported');
      }
    }

    let host = '';
    let pathname = '';
    if (!isMagnet) {
      const u = new URL(url);
      host = u.hostname;
      pathname = u.pathname;
    }
    const isTorrent = isMagnet || /\.torrent$/i.test(pathname);
    const hasFormat = Boolean(opts.formatId) || (Boolean(opts.quality) && opts.quality !== 'Auto Detect');
    const isVideo = !isTorrent && (VIDEO_HOSTS.test(host) || hasFormat);
    const isHls = !isTorrent && !isVideo && /\.m3u8$/i.test(pathname);

    const baseDir = this.settings.downloadDir || path.join(process.cwd(), 'QuantumDownloads');
    let dir = baseDir;
    if (opts.directory && path.isAbsolute(opts.directory)) dir = opts.directory;
    fs.mkdirSync(dir, { recursive: true });

    const custom = opts.filename ? sanitizeFilename(opts.filename, '') : '';
    let filename = custom;
    if (!filename) {
      if (isMagnet) {
        const dn = url.match(/[?&]dn=([^&]+)/i)?.[1];
        filename = sanitizeFilename(dn ? decodeURIComponent(dn.replace(/\+/g, ' ')) : '', `torrent_${Date.now()}`);
      } else if (isVideo) {
        filename = 'Video';
      } else {
        filename = sanitizeFilename(path.posix.basename(pathname), `download_${Date.now()}`);
      }
    }

    const audioOnly = opts.quality === 'audio' || /audio/i.test(opts.quality || '') || opts.formatId === 'ba/b';
    if (isVideo) {
      const ext = audioOnly ? '.mp3' : '.mp4';
      filename = filename.replace(/\.(mp4|mkv|webm|mp3|m4a)$/i, '') + ext;
    } else if (isHls) {
      filename = sanitizeFilename(filename.replace(/\.m3u8$/i, ''), 'stream') + '.ts';
    }

    const filepath = uniqueFilePath(dir, filename, this.claimedPaths());
    if (!isInsideDir(dir, filepath)) throw new Error('Invalid file name');

    let thumbnailUrl: string | undefined;
    const yt = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (yt) thumbnailUrl = `https://i.ytimg.com/vi/${yt[1]}/mqdefault.jpg`;

    const id = 'qd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    const task: DownloadTask = {
      id,
      url,
      filename: path.basename(filepath),
      filepath,
      totalBytes: 0,
      downloadedBytes: 0,
      speed: 0,
      status: 'queued',
      connections: this.settings.defaultConnections || 16,
      segments: [],
      category: isTorrent ? 'torrent' : opts.category || (isHls || isVideo ? (audioOnly ? 'audio' : 'video') : detectCategory(filename)),
      createdAt: Date.now(),
      resumable: true,
      headers: sanitizeHeaders(opts.headers),
      isHls,
      isVideoStream: isVideo,
      isTorrent,
      quality: opts.quality,
      formatId: opts.formatId,
      thumbnailUrl,
      queueName: opts.queueName || 'Default',
      priority: Number(opts.priority) || 0,
      autoName: !custom,
    };

    this.tasks.set(id, task);
    this.persist();
    this.notify('task-added', task);
    this.checkQueue();
    return task;
  }

  public resumeTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task || this.workers.has(id)) return;
    if (task.status === 'paused' || task.status === 'error') {
      task.status = 'queued';
      task.errorMessage = undefined;
      this.persist();
      this.notify('task-updated', task);
      this.checkQueue();
    }
  }

  /** Discards progress and downloads the file again from the start. */
  public restartTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    this.stopWorker(id);
    if (task.status !== 'completed') safeUnlink(task.filepath);
    task.segments = [];
    task.downloadedBytes = 0;
    task.totalBytes = 0;
    task.hlsIndex = 0;
    task.completedAt = undefined;
    task.errorMessage = undefined;
    if (task.status === 'completed') {
      task.filepath = uniqueFilePath(path.dirname(task.filepath), task.filename, this.claimedPaths(id));
      task.filename = path.basename(task.filepath);
    }
    task.status = 'queued';
    this.persist();
    this.notify('task-updated', task);
    this.checkQueue();
  }

  public pauseTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task || (task.status !== 'downloading' && task.status !== 'queued')) return;
    this.stopWorker(id);
    task.status = 'paused';
    task.speed = 0;
    this.persist();
    this.notify('task-updated', task);
    this.checkQueue();
  }

  public stopTask(id: string): void {
    this.pauseTask(id);
  }

  public pauseAll(): void {
    this.bulk = true;
    for (const [id, task] of this.tasks) {
      if (task.status === 'downloading' || task.status === 'queued') this.pauseTask(id);
    }
    this.bulk = false;
    this.persist();
  }

  public resumeAll(): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'paused' || task.status === 'error') {
        task.status = 'queued';
        task.errorMessage = undefined;
        this.notify('task-updated', task);
      }
    }
    this.persist();
    this.checkQueue();
  }

  /** Removes the task; deletes partial data, and the finished file only when asked. */
  public deleteTask(id: string, deleteFileFromDisk = false): void {
    const task = this.tasks.get(id);
    if (!task) return;
    const worker = this.workers.get(id);
    this.workers.delete(id);
    const incomplete = task.status !== 'completed';
    if (worker) {
      if (incomplete || deleteFileFromDisk) worker.cancel();
      else worker.pause();
    } else if ((incomplete && task.downloadedBytes > 0) || deleteFileFromDisk) {
      if (!task.isTorrent || task.totalBytes > 0) safeUnlink(task.filepath);
    }
    this.tasks.delete(id);
    this.persist();
    this.notify('task-deleted', id);
    this.checkQueue();
  }

  public cancelTask(id: string): void {
    this.deleteTask(id, false);
  }

  public clearCompleted(): void {
    for (const [id, t] of this.tasks) {
      if (t.status === 'completed') {
        this.tasks.delete(id);
        this.notify('task-deleted', id);
      }
    }
    this.persist();
  }

  public openFile(id: string): Promise<string> | void {
    const task = this.tasks.get(id);
    if (task?.filepath && fs.existsSync(task.filepath)) return shell.openPath(task.filepath);
  }

  public openFolder(id: string): void {
    const task = this.tasks.get(id);
    if (!task?.filepath) return;
    if (fs.existsSync(task.filepath)) shell.showItemInFolder(task.filepath);
    else shell.openPath(path.dirname(task.filepath));
  }

  public cancelPendingShutdown(): boolean {
    if (!this.shutdownPending) return false;
    this.shutdownPending = false;
    this.scheduler.cancelShutdown();
    return true;
  }

  // ───────────────────────────── internals ─────────────────────────────

  private claimedPaths(excludeId?: string): string[] {
    const out: string[] = [];
    for (const t of this.tasks.values()) if (t.id !== excludeId && t.filepath) out.push(t.filepath);
    return out;
  }

  private stopWorker(id: string): void {
    const worker = this.workers.get(id);
    if (worker) {
      this.workers.delete(id);
      worker.pause();
    }
  }

  private checkQueue(): void {
    if (this.bulk) return;
    const max = this.settings.maxActiveDownloads || 4;
    const queued = Array.from(this.tasks.values())
      .filter((t) => t.status === 'queued' && !this.workers.has(t.id))
      .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.createdAt - b.createdAt);
    for (const task of queued) {
      if (this.workers.size >= max) break;
      this.startTask(task);
    }
  }

  private maybeShutdownAfterQueue(): void {
    const busy = Array.from(this.tasks.values()).some((t) => t.status === 'downloading' || t.status === 'queued');
    if (busy || this.shutdownPending) return;
    const s = this.settings;
    if (s.autoShutdownOnQueueComplete || (s.schedule?.enabled && s.schedule.autoShutdownOnComplete)) {
      this.shutdownPending = true;
      this.persist();
      this.scheduler.shutdownSystem();
      this.notify('shutdown-scheduled', { seconds: 60 });
    }
  }

  private startTask(task: DownloadTask): void {
    if (this.workers.has(task.id)) return;

    let worker: Worker;
    const guard = <T extends any[]>(fn: (...a: T) => void) => (...a: T) => {
      // Ignore late events from a worker that was paused or replaced
      if (this.workers.get(task.id) === worker) fn(...a);
    };
    const events: DownloaderEvents = {
      onProgress: guard((t: DownloadTask) => this.notify('task-progress', t)),
      onComplete: guard((t: DownloadTask) => {
        this.workers.delete(t.id);
        this.persist();
        this.notify('task-completed', t);
        this.showNotification('Download complete', t.filename);
        this.checkQueue();
        this.maybeShutdownAfterQueue();
      }),
      onError: guard((t: DownloadTask, error: Error) => {
        this.workers.delete(t.id);
        t.status = 'error';
        t.errorMessage = error.message;
        t.speed = 0;
        this.persist();
        this.notify('task-updated', t);
        this.notify('task-error', { id: t.id, error: error.message });
        this.showNotification('Download failed', `${t.filename}: ${error.message}`);
        this.checkQueue();
      }),
      reservePath: (dir: string, filename: string) =>
        uniqueFilePath(dir, sanitizeFilename(filename), this.claimedPaths(task.id)),
    };

    if (task.isTorrent) worker = new TorrentDownloader(task, events);
    else if (task.isVideoStream) worker = new VideoStreamDownloader(task, events);
    else if (task.isHls) worker = new HlsDownloader(task, events);
    else worker = new SegmentedDownloader(task, events, this.rateLimiter);

    this.workers.set(task.id, worker);
    task.status = 'downloading';
    task.lastTry = new Date().toISOString();
    this.persist();
    this.notify('task-updated', task);
    worker.start().catch((err) => events.onError(task, err instanceof Error ? err : new Error(String(err))));
  }

  private showNotification(title: string, body: string): void {
    try {
      const win = this.mainWindow;
      if (win && !win.isDestroyed() && win.isFocused()) return;
      if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
    } catch {
      /* ignore */
    }
  }

  private notify(channel: string, data: any): void {
    const win = this.mainWindow;
    if (win && !win.isDestroyed()) win.webContents.send(channel, data);
  }

  private persist(): void {
    this.storage.saveDownloads(Array.from(this.tasks.values()));
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

function sanitizeHeaders(h?: Record<string, string>): Record<string, string> | undefined {
  if (!h || typeof h !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (typeof v !== 'string' || !v) continue;
    if (!/^[A-Za-z0-9-]{1,64}$/.test(k)) continue;
    if (/[\r\n]/.test(v)) continue;
    out[k] = v.slice(0, 8192);
  }
  return Object.keys(out).length ? out : undefined;
}
