import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { AppSettings, DownloadTask } from './types';

export class StorageManager {
  private configPath: string;
  private downloadsPath: string;

  constructor() {
    let baseDir: string;
    try {
      baseDir = app.getPath('userData');
    } catch {
      baseDir = path.join(process.env.APPDATA || process.cwd(), 'QuantumDownloader');
    }

    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    this.configPath = path.join(baseDir, 'quantum_settings.json');
    this.downloadsPath = path.join(baseDir, 'quantum_downloads.json');
  }

  public getSettings(): AppSettings {
    const defaultDownloads = path.join(app ? app.getPath('downloads') : process.cwd(), 'QuantumDownloads');
    const defaults: AppSettings = {
      downloadDir: defaultDownloads,
      defaultConnections: 16,
      maxActiveDownloads: 4,
      speedLimitKBps: 0,
      theme: 'light',
      autoResumeOnStartup: true,
      enableClipboardMonitor: true,
      serverPort: 52345,
    };

    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const loaded = { ...defaults, ...JSON.parse(raw) };
        if (loaded.theme !== 'dark' && loaded.theme !== 'light') {
          loaded.theme = (loaded.theme === 'obsidian' || loaded.theme === 'carbon' || loaded.theme === 'synthwave') ? 'dark' : 'light';
        }
        return loaded;
      }
    } catch (err) {
      console.error('Error loading settings:', err);
    }
    return defaults;
  }

  public saveSettings(settings: AppSettings): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error saving settings:', err);
    }
  }

  public getDownloads(): DownloadTask[] {
    try {
      if (fs.existsSync(this.downloadsPath)) {
        const raw = fs.readFileSync(this.downloadsPath, 'utf-8');
        const tasks = JSON.parse(raw);
        if (Array.isArray(tasks)) {
          // Filter out any legacy dummy/demo tasks and save clean state
          const realTasks: DownloadTask[] = tasks.filter((t: any) => t && t.id && !t.id.startsWith('task-demo-'));
          if (realTasks.length !== tasks.length) {
            this.saveDownloads(realTasks);
          }
          // Mark any tasks that were downloading as paused on startup
          return realTasks.map(t => ({
            ...t,
            status: t.status === 'downloading' ? 'paused' : t.status,
            speed: 0,
          }));
        }
      }
    } catch (err) {
      console.error('Error loading downloads:', err);
    }
    return [];
  }

  public saveDownloads(downloads: DownloadTask[]): void {
    try {
      fs.writeFileSync(this.downloadsPath, JSON.stringify(downloads, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error saving downloads:', err);
    }
  }
}
