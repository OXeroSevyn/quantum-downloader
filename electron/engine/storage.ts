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
      schedule: {
        enabled: false,
        startHour: 1,
        startMinute: 0,
        stopHour: 6,
        stopMinute: 0,
        autoShutdownOnComplete: false,
      },
      autoShutdownOnQueueComplete: false,
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
      writeAtomic(this.configPath, JSON.stringify(settings, null, 2));
    } catch (err) {
      console.error('Error saving settings:', err);
    }
  }

  public getDownloads(): DownloadTask[] {
    try {
      if (fs.existsSync(this.downloadsPath)) {
        const raw = fs.readFileSync(this.downloadsPath, 'utf-8');
        const parsed: DownloadTask[] = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        // Speeds are transient; the manager decides whether interrupted work resumes
        return parsed.filter((t) => t && t.id && t.url).map((task) => ({
          ...task,
          speed: 0,
          segments: task.segments ? task.segments.map(s => ({
            ...s,
            speed: 0,
            status: s.status === 'downloading' ? 'pending' : s.status,
          })) : [],
        }));
      }
    } catch (err) {
      console.error('Error loading downloads:', err);
    }
    return [];
  }

  public saveDownloads(downloads: DownloadTask[]): void {
    try {
      // Don't save transient internal objects
      const serialized = downloads.map((d) => ({ ...d, speed: 0 }));
      writeAtomic(this.downloadsPath, JSON.stringify(serialized));
    } catch (err) {
      console.error('Error saving downloads:', err);
    }
  }
}

/** Write to a temp file then rename, so a crash never leaves half-written JSON. */
function writeAtomic(file: string, data: string): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data, 'utf-8');
  fs.renameSync(tmp, file);
}
