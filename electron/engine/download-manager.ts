import path from 'path';
import { shell, BrowserWindow } from 'electron';
import { StorageManager } from './storage';
import { DownloadTask, AppSettings, DownloadCategory } from './types';
import { SegmentedDownloader } from './segmented-downloader';
import { HlsDownloader } from './hls-downloader';
import { VideoStreamDownloader } from './video-stream-downloader';
import { TorrentDownloader } from './torrent-downloader';
import { RateLimiter } from './rate-limiter';
import { SchedulerManager } from './scheduler';

export class DownloadManager {
  private storage: StorageManager;
  private tasks: Map<string, DownloadTask> = new Map();
  private activeWorkers: Map<string, SegmentedDownloader | HlsDownloader | VideoStreamDownloader | TorrentDownloader> = new Map();
  private settings: AppSettings;
  private mainWindow: BrowserWindow | null = null;
  private rateLimiter: RateLimiter;
  private scheduler: SchedulerManager;

  constructor(storage: StorageManager) {
    this.storage = storage;
    this.settings = this.storage.getSettings();

    // Initialize global bandwidth rate limiter
    this.rateLimiter = new RateLimiter(this.settings.speedLimitKBps || 0);

    // Initialize schedule manager
    this.scheduler = new SchedulerManager(
      () => this.resumeAllQueued(),
      () => this.pauseAllDownloading()
    );
    this.scheduler.setSchedule(this.settings.schedule);

    // Load persisted tasks
    const saved = this.storage.getDownloads();
    for (const t of saved) {
      this.tasks.set(t.id, t);
    }
  }

  public setMainWindow(win: BrowserWindow) {
    this.mainWindow = win;
  }

  public getSettings(): AppSettings {
    return this.settings;
  }

  public updateSettings(newSettings: Partial<AppSettings>): AppSettings {
    this.settings = { ...this.settings, ...newSettings };
    
    // Update rate limiter
    if (newSettings.speedLimitKBps !== undefined) {
      this.rateLimiter.setLimit(this.settings.speedLimitKBps || 0);
    }

    // Update scheduler
    if (newSettings.schedule !== undefined) {
      this.scheduler.setSchedule(this.settings.schedule);
    }

    this.storage.saveSettings(this.settings);
    return this.settings;
  }

  public getAllTasks(): DownloadTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => {
      // Sort by priority (descending), then by createdAt (descending)
      const pA = a.priority || 0;
      const pB = b.priority || 0;
      if (pA !== pB) return pB - pA;
      return b.createdAt - a.createdAt;
    });
  }

  public addTask(
    url: string,
    customFilename?: string,
    category?: DownloadCategory,
    headers?: Record<string, string>,
    quality?: string,
    formatId?: string,
    queueName?: string,
    priority?: number
  ): DownloadTask {
    const id = 'qd_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    
    // Normalize URL
    let cleanUrl = url.trim();

    // Detect BitTorrent / Magnet links
    const isMagnet = cleanUrl.startsWith('magnet:?');
    const isTorrentFile = cleanUrl.endsWith('.torrent') || cleanUrl.includes('.torrent?');
    const isTorrent = isMagnet || isTorrentFile;

    if (!isMagnet && !/^https?:\/\//i.test(cleanUrl)) {
      cleanUrl = 'https://' + cleanUrl;
    }

    // Check if this is an explicit streaming video platform
    const isKnownVideoHost = 
      /youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|tiktok\.com|twitter\.com|x\.com|instagram\.com|twitch\.tv|soundcloud\.com/i.test(cleanUrl);
    const hasExplicitVideoFormat = Boolean(formatId) || (Boolean(quality) && quality !== 'Auto Detect');
    const isVideoPlatform = !isTorrent && (isKnownVideoHost || hasExplicitVideoFormat);
    const isHls = !isTorrent && !isVideoPlatform && (cleanUrl.includes('.m3u8') || cleanUrl.includes('manifest.m3u8'));

    // Ensure target download directory exists
    const downloadDir = this.settings.downloadDir || path.join(process.cwd(), 'QuantumDownloads');
    const fs = require('fs');
    if (!fs.existsSync(downloadDir)) {
      try {
        fs.mkdirSync(downloadDir, { recursive: true });
      } catch (e) {}
    }

    let filename = customFilename || '';
    if (!filename) {
      if (isMagnet) {
        // Extract display name from magnet if available dn=
        const dnMatch = cleanUrl.match(/[?&]dn=([^&]+)/i);
        filename = dnMatch ? decodeURIComponent(dnMatch[1]) : `torrent_${Date.now()}`;
      } else {
        try {
          const parsed = new URL(cleanUrl);
          filename = path.basename(parsed.pathname) || `download_${Date.now()}`;
        } catch {
          filename = `download_${Date.now()}`;
        }
      }
    }

    // Clean up filename and ensure proper extension
    if (isVideoPlatform) {
      filename = filename.replace(/[\\/:*?"<>|]/g, '_');
      if (quality === 'audio' || quality === 'Audio Only (MP3)' || formatId === 'ba/b') {
        if (!filename.endsWith('.mp3')) filename += '.mp3';
      } else {
        if (!filename.endsWith('.mp4') && !filename.endsWith('.mkv')) filename += '.mp4';
      }
    }

    const filepath = path.join(downloadDir, filename);

    // Extract real YouTube thumbnail if applicable
    let thumbnailUrl: string | undefined = undefined;
    if (cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be')) {
      const ytIdMatch = cleanUrl.match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
      if (ytIdMatch && ytIdMatch[1]) {
        thumbnailUrl = `https://img.youtube.com/vi/${ytIdMatch[1]}/mqdefault.jpg`;
      }
    }

    const task: DownloadTask = {
      id,
      url: cleanUrl,
      filename,
      filepath,
      totalBytes: 0,
      downloadedBytes: 0,
      speed: 0,
      status: 'queued',
      connections: this.settings.defaultConnections || 16,
      segments: [],
      category: isTorrent ? 'torrent' : (category || (isHls || isVideoPlatform ? 'video' : 'other')),
      createdAt: Date.now(),
      resumable: true,
      headers,
      isHls,
      isVideoStream: isVideoPlatform,
      isTorrent,
      quality,
      formatId,
      thumbnailUrl,
      queueName: queueName || 'Default',
      priority: priority !== undefined ? priority : 0,
    };

    this.tasks.set(id, task);
    this.persist();
    this.notifyFrontend('task-added', task);

    // Check if we can start immediately
    this.checkQueue();

    return task;
  }

  public resumeTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;

    if (task.status === 'paused' || task.status === 'error') {
      task.status = 'queued';
      task.errorMessage = undefined;
      this.persist();
      this.notifyFrontend('task-updated', task);
      this.checkQueue();
    }
  }

  public pauseTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;

    const worker = this.activeWorkers.get(id);
    if (worker) {
      worker.pause();
      this.activeWorkers.delete(id);
    }

    task.status = 'paused';
    task.speed = 0;
    this.persist();
    this.notifyFrontend('task-updated', task);
    this.checkQueue();
  }

  public stopTask(id: string): void {
    this.pauseTask(id);
  }

  public pauseAllDownloading(): void {
    for (const [id, task] of this.tasks.entries()) {
      if (task.status === 'downloading' || task.status === 'queued') {
        this.pauseTask(id);
      }
    }
  }

  public resumeAllQueued(): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'paused') {
        task.status = 'queued';
        task.errorMessage = undefined;
      }
    }
    this.persist();
    this.checkQueue();
  }

  public cancelTask(id: string): void {
    const worker = this.activeWorkers.get(id);
    if (worker) {
      worker.cancel();
      this.activeWorkers.delete(id);
    }
    this.tasks.delete(id);
    this.persist();
    this.notifyFrontend('task-deleted', id);
    this.checkQueue();
  }

  public deleteTask(id: string, deleteFileFromDisk: boolean = false): void {
    const task = this.tasks.get(id);
    if (!task) return;

    this.cancelTask(id);

    if (deleteFileFromDisk && task.filepath) {
      const fs = require('fs');
      try {
        if (fs.existsSync(task.filepath)) {
          const stat = fs.statSync(task.filepath);
          if (stat.isDirectory()) {
            fs.rmSync(task.filepath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(task.filepath);
          }
        }
      } catch (e) {}
    }
  }

  public openFile(id: string): void {
    const task = this.tasks.get(id);
    if (task && task.filepath) {
      shell.openPath(task.filepath);
    }
  }

  public openFolder(id: string): void {
    const task = this.tasks.get(id);
    if (task && task.filepath) {
      shell.showItemInFolder(task.filepath);
    }
  }

  private checkQueue(): void {
    const activeCount = Array.from(this.tasks.values()).filter(t => t.status === 'downloading').length;
    const maxActive = this.settings.maxActiveDownloads || 4;

    if (activeCount >= maxActive) return;

    // Pick highest priority queued task
    const queuedTasks = Array.from(this.tasks.values())
      .filter(t => t.status === 'queued')
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    if (queuedTasks.length > 0) {
      const nextTask = queuedTasks[0];
      this.startTask(nextTask);
    } else if (activeCount === 0) {
      // Queue is completely finished!
      if (this.settings.autoShutdownOnQueueComplete || (this.settings.schedule?.enabled && this.settings.schedule.autoShutdownOnComplete)) {
        this.scheduler.shutdownSystem();
      }
    }
  }

  private startTask(task: DownloadTask): void {
    if (this.activeWorkers.has(task.id)) return;

    const events = {
      onProgress: (t: DownloadTask) => {
        this.notifyFrontend('task-progress', t);
      },
      onComplete: (t: DownloadTask) => {
        this.activeWorkers.delete(t.id);
        this.persist();
        this.notifyFrontend('task-completed', t);
        this.checkQueue();
      },
      onError: (t: DownloadTask, error: Error) => {
        this.activeWorkers.delete(t.id);
        t.status = 'error';
        t.errorMessage = error.message;
        t.speed = 0;
        this.persist();
        this.notifyFrontend('task-updated', t);
        this.notifyFrontend('task-error', { id: t.id, error: error.message });
        this.checkQueue();
      },
    };

    let worker: SegmentedDownloader | HlsDownloader | VideoStreamDownloader | TorrentDownloader;
    if (task.isTorrent) {
      worker = new TorrentDownloader(task, events);
    } else if (task.isVideoStream) {
      worker = new VideoStreamDownloader(task, events);
    } else if (task.isHls) {
      worker = new HlsDownloader(task, events);
    } else {
      worker = new SegmentedDownloader(task, events, this.rateLimiter);
    }

    this.activeWorkers.set(task.id, worker);
    worker.start();
    this.persist();
    this.notifyFrontend('task-updated', task);
  }

  private notifyFrontend(channel: string, data: any): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  private persist(): void {
    this.storage.saveDownloads(Array.from(this.tasks.values()));
  }
}
