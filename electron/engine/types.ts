export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'error';

export type DownloadCategory = 'video' | 'audio' | 'compressed' | 'document' | 'program' | 'other';

export interface DownloadSegment {
  id: number;
  startByte: number;
  endByte: number;
  currentByte: number;
  downloaded: number;
  total: number;
  status: 'pending' | 'downloading' | 'completed' | 'error';
  speed: number; // bytes/sec for this segment
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
  speed: number; // bytes/sec
  status: DownloadStatus;
  errorMessage?: string;
  connections: number;
  segments: DownloadSegment[];
  category: DownloadCategory;
  createdAt: number;
  completedAt?: number;
  resumable: boolean;
  etag?: string;
  lastModified?: string;
  headers?: Record<string, string>;
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

export interface SniffedMedia {
  url: string;
  title: string;
  type: string;
  quality?: string;
  size?: number;
  referer?: string;
  isStream?: boolean;
}
