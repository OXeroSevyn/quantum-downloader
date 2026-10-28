export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'error';
export type DownloadCategory = 'video' | 'audio' | 'compressed' | 'document' | 'program' | 'image' | 'other';

export interface DownloadSegment {
  id: number;
  startByte: number;
  endByte: number;
  currentByte: number;
  downloaded: number;
  total: number;
  status: 'pending' | 'downloading' | 'completed' | 'error';
  speed: number;
}

export interface VideoFormatOption {
  formatId: string;
  resolution: string;
  quality: string;
  ext: string;
  filesize?: number;
  filesizeText?: string;
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
  quality?: string;
  formatId?: string;
  thumbnailUrl?: string;
  description?: string;
  lastTry?: string;
  logs?: string[];
}

export interface AppSettings {
  downloadDir: string;
  defaultConnections: number;
  maxActiveDownloads: number;
  speedLimitKBps: number;
  theme: 'light' | 'dark' | string;
  autoResumeOnStartup: boolean;
  enableClipboardMonitor: boolean;
  serverPort: number;
  hasCompletedWelcome?: boolean;
}

declare global {
  interface Window {
    quantumApi?: {
      getDownloads: () => Promise<DownloadTask[]>;
      addDownload: (
        url: string,
        filename?: string,
        category?: DownloadCategory,
        headers?: Record<string, string>,
        quality?: string,
        formatId?: string
      ) => Promise<DownloadTask>;
      pauseDownload: (id: string) => Promise<boolean>;
      stopDownload: (id: string) => Promise<boolean>;
      resumeDownload: (id: string) => Promise<boolean>;
      cancelDownload: (id: string) => Promise<boolean>;
      deleteDownload: (id: string, deleteFileFromDisk: boolean) => Promise<boolean>;
      openFile: (id: string) => Promise<boolean>;
      openFolder: (id: string) => Promise<boolean>;
      getSettings: () => Promise<AppSettings>;
      saveSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
      selectDownloadFolder: () => Promise<string | null>;
      minimizeWindow: () => Promise<void>;
      maximizeWindow: () => Promise<void>;
      closeWindow: () => Promise<void>;
      closeDialog: () => Promise<void>;
      showMainWindow: () => Promise<void>;
      getDialogData: () => Promise<any>;
      on: (channel: string, callback: (...args: any[]) => void) => () => void;
    };
  }
}
