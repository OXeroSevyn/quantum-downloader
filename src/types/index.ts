export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'error';
export type DownloadCategory = 'video' | 'audio' | 'compressed' | 'document' | 'program' | 'torrent' | 'image' | 'other';

export interface DownloadSegment {
  id: number;
  startByte: number;
  endByte: number;
  currentByte: number;
  downloaded: number;
  total: number;
  status: 'pending' | 'downloading' | 'completed' | 'error';
  speed: number;
  retries?: number;
}

export interface VideoFormatOption {
  formatId: string;
  resolution: string;
  quality: string;
  ext: string;
  filesize?: number;
  label: string;
}

export interface DownloadTask {
  id: string;
  url: string;
  filename: string;
  filepath: string;
  totalBytes: number;
  downloadedBytes: number;
  speed: number;
  status: DownloadStatus;
  errorMessage?: string;
  connections: number;
  segments: DownloadSegment[];
  category: DownloadCategory;
  createdAt: number;
  completedAt?: number;
  resumable: boolean;
  isHls?: boolean;
  isVideoStream?: boolean;
  isTorrent?: boolean;
  torrentPeers?: number;
  torrentProgress?: number;
  quality?: string;
  formatId?: string;
  thumbnailUrl?: string;
  lastTry?: string;
  logs?: string[];
  queueName?: string;
  priority?: number;
  hlsIndex?: number;
  hlsCount?: number;
}

export interface QueueSchedule {
  enabled: boolean;
  startHour: number;
  startMinute: number;
  stopHour: number;
  stopMinute: number;
  autoShutdownOnComplete?: boolean;
}

export interface AppSettings {
  downloadDir: string;
  defaultConnections: number;
  maxActiveDownloads: number;
  speedLimitKBps: number;
  theme: 'light' | 'dark' | 'system' | string;
  autoResumeOnStartup: boolean;
  enableClipboardMonitor: boolean;
  serverPort: number;
  hasCompletedWelcome?: boolean;
  schedule?: QueueSchedule;
  autoShutdownOnQueueComplete?: boolean;
}

export interface NewDownloadRequest {
  url: string;
  filename?: string;
  category?: DownloadCategory;
  headers?: Record<string, string>;
  quality?: string;
  formatId?: string;
  priority?: number;
  directory?: string;
}

export type AddResult = { ok: true; task: DownloadTask } | { ok: false; error: string };

export interface QuantumApi {
  getDownloads: () => Promise<DownloadTask[]>;
  addDownload: (opts: NewDownloadRequest) => Promise<AddResult>;
  probeFormats: (url: string) => Promise<{ ok: boolean; title?: string; formats?: VideoFormatOption[]; error?: string }>;
  pauseDownload: (id: string) => Promise<void>;
  stopDownload: (id: string) => Promise<void>;
  resumeDownload: (id: string) => Promise<void>;
  restartDownload: (id: string) => Promise<void>;
  cancelDownload: (id: string) => Promise<void>;
  deleteDownload: (id: string, deleteFileFromDisk: boolean) => Promise<void>;
  pauseAll: () => Promise<void>;
  resumeAll: () => Promise<void>;
  clearCompleted: () => Promise<void>;
  cancelShutdown: () => Promise<boolean>;
  openFile: (id: string) => Promise<string>;
  openFolder: (id: string) => Promise<void>;
  openDownloadDir: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  openExtensionFolder: () => Promise<string>;
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  getAppInfo: () => Promise<{ version: string; platform: string; downloadsDir: string; bridgeOnline?: boolean }>;
  selectDownloadFolder: () => Promise<string | null>;
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  closeDialog: () => Promise<void>;
  showMainWindow: () => Promise<void>;
  getDialogData: () => Promise<Partial<NewDownloadRequest> | null>;
  platform: string;
  on: (channel: string, callback: (...args: any[]) => void) => () => void;
}

declare global {
  interface Window {
    quantumApi?: QuantumApi;
  }
}
