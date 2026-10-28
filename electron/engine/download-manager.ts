import path from 'path';
import { shell, BrowserWindow } from 'electron';
import { StorageManager } from './storage';
import { DownloadTask, AppSettings, DownloadCategory } from './types';
import { SegmentedDownloader } from './segmented-downloader';
import { HlsDownloader } from './hls-downloader';
import { VideoStreamDownloader } from './video-stream-downloader';

export class DownloadManager {
  private storage: StorageManager;
  private tasks: Map<string, DownloadTask> = new Map();
  private activeWorkers: Map<string, SegmentedDownloader | HlsDownloader | VideoStreamDownloader> = new Map();
  private settings: AppSettings;
  private mainWindow: BrowserWindow | null = null;

  constructor(storage: StorageManager) {
    this.storage = storage;
    this.settings = this.storage.getSettings();

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
    this.storage.saveSettings(this.settings);
    return this.settings;
  }

  public getAllTasks(): DownloadTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  public addTask(
    url: string,
    customFilename?: string,
    category?: DownloadCategory,
    headers?: Record<string, string>,
    quality?: string,
    formatId?: string
  ): DownloadTask {
    const id = 'qd_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    
    // Normalize URL
    let cleanUrl = url.trim();
    if (!/^https?:\/\//i.test(cleanUrl)) {
      cleanUrl = 'https://' + cleanUrl;
    }

    // Check if this is an explicit streaming video platform
    const isKnownVideoHost = 
      /youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|tiktok\.com|twitter\.com|x\.com|instagram\.com|twitch\.tv|soundcloud\.com/i.test(cleanUrl);
    const hasExplicitVideoFormat = Boolean(formatId) || (Boolean(quality) && quality !== 'Auto Detect');
    const isVideoPlatform = isKnownVideoHost || hasExplicitVideoFormat;
    const isHls = !isVideoPlatform && (cleanUrl.includes('.m3u8') || cleanUrl.includes('manifest.m3u8'));

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
      try {
        const parsed = new URL(cleanUrl);
        filename = path.basename(parsed.pathname) || `download_${Date.now()}`;
      } catch {
        filename = `download_${Date.now()}`;
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
    const ytMatch = cleanUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
    if (ytMatch && ytMatch[1]) {
      thumbnailUrl = `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`;
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

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
      category: category || (isVideoPlatform || isHls ? 'video' : 'other'),
      createdAt: Date.now(),
      resumable: true,
      headers,
      isHls,
      isVideoStream: isVideoPlatform,
      quality,
      formatId,
      thumbnailUrl,
      description: isVideoPlatform ? 'YouTube Video / Stream' : (category ? `${category.toUpperCase()} File` : 'Binary Stream'),
      lastTry: dateStr,
      logs: [
        `[${timeStr}] Download initialized: ${cleanUrl}`,
        `[${timeStr}] Output path assigned: ${filepath}`,
      ],
    };

    this.tasks.set(id, task);
    this.persist();
    this.notifyFrontend('task-added', task);

    // Schedule next
    this.checkQueue();
    return task;
  }

  public resumeTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;

    task.status = 'queued';
    task.errorMessage = undefined;

    // If download failed with 0 bytes downloaded, reset to allow fresh re-probe
    if (task.downloadedBytes === 0) {
      task.segments = [];
      task.totalBytes = 0;
    } else {
      task.segments.forEach(s => {
        if (s.status === 'error') {
          s.status = 'pending';
        }
      });
    }

    this.persist();
    this.notifyFrontend('task-updated', task);
    this.checkQueue();
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
    // Stop is pause with full connection abort
    this.pauseTask(id);
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
          fs.unlinkSync(task.filepath);
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

    const queued = Array.from(this.tasks.values()).find(t => t.status === 'queued');
    if (queued) {
      this.startTask(queued);
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

    let worker: SegmentedDownloader | HlsDownloader | VideoStreamDownloader;
    if (task.isVideoStream) {
      worker = new VideoStreamDownloader(task, events);
    } else if (task.isHls) {
      worker = new HlsDownloader(task, events);
    } else {
      worker = new SegmentedDownloader(task, events);
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
