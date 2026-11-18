export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'error';

export type DownloadCategory = 'video' | 'audio' | 'compressed' | 'document' | 'program' | 'torrent' | 'other';

export interface DownloadSegment {
  id: number;
  startByte: number;
  endByte: number;
  currentByte: number;
  downloaded: number;
  total: number;
  status: 'pending' | 'downloading' | 'completed' | 'error';
  speed: number; // bytes/sec for this segment
  retries?: number;
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
  isTorrent?: boolean;
  torrentPeers?: number;
  torrentProgress?: number;
  quality?: string;
  formatId?: string;
  thumbnailUrl?: string;
  description?: string;
  lastTry?: string;
  logs?: string[];
  queueName?: string;
  priority?: number; // Higher number = higher priority
}

export interface QueueSchedule {
  enabled: boolean;
  startHour: number; // 0-23
  startMinute: number; // 0-59
  stopHour: number; // 0-23
  stopMinute: number; // 0-59
  autoShutdownOnComplete?: boolean;
}

export interface AppSettings {
  downloadDir: string;
  defaultConnections: number;
  maxActiveDownloads: number;
  speedLimitKBps: number; // 0 = unlimited
  theme: 'light' | 'dark' | string;
  autoResumeOnStartup: boolean;
  enableClipboardMonitor: boolean;
  serverPort: number;
  hasCompletedWelcome?: boolean;
  schedule?: QueueSchedule;
  autoShutdownOnQueueComplete?: boolean;
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
