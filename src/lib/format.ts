import { DownloadCategory, DownloadTask } from '../types';

export function formatBytes(bytes: number, digits = 1): string {
  if (!bytes || bytes < 0 || !isFinite(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / 1024 ** i;
  return `${v.toFixed(i === 0 ? 0 : v >= 100 ? 0 : digits)} ${units[i]}`;
}

export function formatSpeed(bps: number): string {
  return bps > 0 ? `${formatBytes(bps)}/s` : '–';
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '–';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function eta(task: DownloadTask): number {
  if (task.status !== 'downloading' || !task.speed || !task.totalBytes) return 0;
  return Math.max(0, task.totalBytes - task.downloadedBytes) / task.speed;
}

export function progress(task: DownloadTask): number {
  if (task.status === 'completed') return 1;
  if (!task.totalBytes) return 0;
  return Math.max(0, Math.min(1, task.downloadedBytes / task.totalBytes));
}

export function formatDate(ts?: number): string {
  if (!ts) return '–';
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export const STATUS_LABEL: Record<DownloadTask['status'], string> = {
  queued: 'Waiting',
  downloading: 'Downloading',
  paused: 'Paused',
  completed: 'Done',
  error: 'Failed',
};

export const CATEGORY_LABEL: Record<DownloadCategory, string> = {
  video: 'Video',
  audio: 'Music',
  compressed: 'Archives',
  document: 'Documents',
  program: 'Programs',
  torrent: 'Torrents',
  image: 'Images',
  other: 'Other',
};

export function guessCategory(name: string): DownloadCategory {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v', 'ts', 'flv', 'wmv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus', 'wma'].includes(ext)) return 'audio';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'].includes(ext)) return 'compressed';
  if (['exe', 'msi', 'apk', 'dmg', 'deb', 'rpm', 'msix', 'appimage'].includes(ext)) return 'program';
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'epub'].includes(ext)) return 'document';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return 'image';
  if (ext === 'torrent') return 'torrent';
  return 'other';
}

export type LinkKind = 'file' | 'video' | 'stream' | 'torrent' | 'invalid' | 'empty';

const VIDEO_HOST =
  /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|tiktok\.com|twitter\.com|x\.com|instagram\.com|twitch\.tv|soundcloud\.com|facebook\.com|fb\.watch|reddit\.com|bilibili\.com)$/i;

export function classifyLink(raw: string): LinkKind {
  const v = raw.trim();
  if (!v) return 'empty';
  if (/^magnet:\?/i.test(v)) return 'torrent';
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'invalid';
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return 'invalid';
    if (/\.torrent$/i.test(u.pathname)) return 'torrent';
    if (VIDEO_HOST.test(u.hostname)) return 'video';
    if (/\.m3u8$/i.test(u.pathname)) return 'stream';
    return 'file';
  } catch {
    return 'invalid';
  }
}

export function nameFromLink(raw: string): string {
  const v = raw.trim();
  if (/^magnet:/i.test(v)) {
    const dn = v.match(/[?&]dn=([^&]+)/i)?.[1];
    try {
      return dn ? decodeURIComponent(dn.replace(/\+/g, ' ')) : '';
    } catch {
      return dn || '';
    }
  }
  try {
    const u = new URL(/^[a-z]+:/i.test(v) ? v : `https://${v}`);
    const base = u.pathname.split('/').filter(Boolean).pop() || '';
    return base.includes('.') ? decodeURIComponent(base) : '';
  } catch {
    return '';
  }
}

export function friendlyIpcError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
}
