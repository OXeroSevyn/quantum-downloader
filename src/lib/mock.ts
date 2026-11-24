// Development-only stand-in for the Electron bridge so the UI can be previewed in a browser.
import { AppSettings, DownloadSegment, DownloadTask, QuantumApi } from '../types';

export function installMockApi(): void {
  const listeners = new Map<string, Set<(...a: any[]) => void>>();
  const emit = (ch: string, d: any) => listeners.get(ch)?.forEach((cb) => cb(d));
  const params = new URLSearchParams(location.search);
  let settings: AppSettings = {
    downloadDir: 'C:\\Users\\You\\Downloads\\QuantumDownloads',
    defaultConnections: 16,
    maxActiveDownloads: 4,
    speedLimitKBps: 0,
    theme: params.get('theme') || 'light',
    autoResumeOnStartup: true,
    enableClipboardMonitor: true,
    serverPort: 52345,
    hasCompletedWelcome: !params.has('intro'),
  };
  const segs = (n: number, total: number, fills: number[]): DownloadSegment[] =>
    Array.from({ length: n }, (_, i) => {
      const size = Math.floor(total / n);
      const d = Math.floor(size * (fills[i % fills.length] ?? 0));
      return { id: i, startByte: i * size, endByte: (i + 1) * size - 1, currentByte: i * size + d, downloaded: d, total: size, status: d >= size ? 'completed' : 'downloading', speed: 0 };
    });
  const now = Date.now();
  const base = (p: Partial<DownloadTask>): DownloadTask => ({
    id: Math.random().toString(36).slice(2),
    url: 'https://example.com/file',
    filename: 'file',
    filepath: 'C:\\Users\\You\\Downloads\\QuantumDownloads\\file',
    totalBytes: 0,
    downloadedBytes: 0,
    speed: 0,
    status: 'completed',
    connections: 16,
    segments: [],
    category: 'other',
    createdAt: now,
    resumable: true,
    ...p,
  });
  const tasks: DownloadTask[] = params.has('empty')
    ? []
    : [
        base({ filename: 'ubuntu-24.04.1-desktop-amd64.iso', category: 'compressed', url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04.1-desktop-amd64.iso', totalBytes: 6114656256, downloadedBytes: 3790000000, speed: 41_200_000, status: 'downloading', segments: segs(16, 6114656256, [0.9, 0.55, 0.7, 0.4, 0.62, 0.8, 0.5, 0.66, 0.58, 0.72, 0.45, 0.69, 1, 0.6, 0.52, 0.64]), createdAt: now - 60000 }),
        base({ filename: 'Big Buck Bunny 4K.mp4', category: 'video', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', isVideoStream: true, totalBytes: 812_000_000, downloadedBytes: 233_000_000, speed: 12_400_000, status: 'downloading', segments: segs(16, 812_000_000, [1, 1, 1, 1, 0.6, 0, 0, 0]), thumbnailUrl: 'https://i.ytimg.com/vi/aqz-KE-bpKQ/mqdefault.jpg', logs: ['[10:41:02] Starting video engine…', '[10:41:04] Downloading stream 1'], createdAt: now - 120000 }),
        base({ filename: 'Sintel', category: 'torrent', isTorrent: true, url: 'magnet:?xt=urn:btih:08ada5a7&dn=Sintel', totalBytes: 129_000_000, downloadedBytes: 30_000_000, speed: 2_100_000, torrentPeers: 11, status: 'downloading', segments: segs(16, 129_000_000, [1, 0.2, 0, 0.5, 1, 0, 0.3, 0]), createdAt: now - 200000 }),
        base({ filename: 'Blender-4.2-windows-x64.msi', category: 'program', totalBytes: 342_000_000, status: 'queued', createdAt: now - 260000 }),
        base({ filename: 'annual-report-2025.pdf', category: 'document', totalBytes: 8_400_000, downloadedBytes: 2_100_000, status: 'paused', segments: segs(8, 8_400_000, [0.4, 0.2, 0.3, 0.1]), createdAt: now - 300000 }),
        base({ filename: 'dataset-archive.7z', category: 'compressed', status: 'error', errorMessage: 'The server refused the connection', totalBytes: 2_400_000_000, downloadedBytes: 600_000_000, segments: segs(16, 2_400_000_000, [0.3, 0.2, 0.25]), createdAt: now - 400000 }),
        base({ filename: 'lofi-session-42.mp3', category: 'audio', totalBytes: 94_000_000, downloadedBytes: 94_000_000, status: 'completed', completedAt: now - 3600000, createdAt: now - 3700000, segments: segs(8, 94_000_000, [1]) }),
        base({ filename: 'node-v24.20.0-x64.msi', category: 'program', totalBytes: 31_000_000, downloadedBytes: 31_000_000, status: 'completed', completedAt: now - 86400000, createdAt: now - 86500000, segments: segs(16, 31_000_000, [1]) }),
      ];

  const ok = <T>(v: T) => Promise.resolve(v);
  const api: QuantumApi = {
    getDownloads: () => ok(tasks),
    addDownload: (o) => {
      const t = base({ url: o.url, filename: o.filename || o.url.split('/').pop() || 'download', status: 'downloading' });
      tasks.unshift(t);
      emit('task-added', t);
      return ok({ ok: true as const, task: t });
    },
    probeFormats: () =>
      new Promise((r) =>
        setTimeout(
          () =>
            r({
              ok: true,
              title: 'Big Buck Bunny',
              formats: [
                { formatId: 'a', resolution: '2160p', quality: '4K', ext: 'mp4', label: '2160p 4K Ultra HD · ~812 MB' },
                { formatId: 'b', resolution: '1080p', quality: '1080p', ext: 'mp4', label: '1080p Full HD · ~260 MB' },
                { formatId: 'c', resolution: '720p', quality: '720p', ext: 'mp4', label: '720p HD · ~120 MB' },
                { formatId: 'ba/b', resolution: 'Audio', quality: 'Audio MP3', ext: 'mp3', label: 'Audio only (MP3)' },
              ],
            }),
          700
        )
      ),
    pauseDownload: async (id) => {
      const t = tasks.find((x) => x.id === id);
      if (t) emit('task-updated', { ...t, status: 'paused', speed: 0 });
    },
    stopDownload: async () => {},
    resumeDownload: async (id) => {
      const t = tasks.find((x) => x.id === id);
      if (t) emit('task-updated', { ...t, status: 'downloading' });
    },
    restartDownload: async () => {},
    cancelDownload: async () => {},
    deleteDownload: async (id) => emit('task-deleted', id),
    pauseAll: async () => {},
    resumeAll: async () => {},
    clearCompleted: async () => {},
    cancelShutdown: () => ok(true),
    openFile: () => ok(''),
    openFolder: async () => {},
    openDownloadDir: () => ok(''),
    openExternal: async () => {},
    openExtensionFolder: () => ok('C:\\Program Files\\Quantum Downloader\\resources\\extension'),
    getSettings: () => ok(settings),
    saveSettings: (p) => {
      settings = { ...settings, ...p };
      return ok(settings);
    },
    getAppInfo: () => ok({ version: '1.2.0', platform: 'win32', downloadsDir: 'C:\\Users\\You\\Downloads' }),
    selectDownloadFolder: () => ok('D:\\Media'),
    minimizeWindow: async () => {},
    maximizeWindow: async () => {},
    closeWindow: async () => {},
    closeDialog: async () => {},
    showMainWindow: async () => {},
    getDialogData: () => ok({ url: 'https://cdn.example.com/files/app-setup-2.4.1.exe' }),
    platform: 'win32',
    on: (ch, cb) => {
      if (!listeners.has(ch)) listeners.set(ch, new Set());
      listeners.get(ch)!.add(cb);
      return () => listeners.get(ch)!.delete(cb);
    },
  };
  (window as any).quantumApi = api;

  // Animate the active downloads so lanes move
  setInterval(() => {
    for (const t of tasks) {
      if (t.status !== 'downloading' || !t.totalBytes) continue;
      t.segments = t.segments.map((s) => {
        if (s.downloaded >= s.total) return { ...s, status: 'completed' };
        const add = Math.min(s.total - s.downloaded, Math.floor(s.total * (0.004 + Math.random() * 0.01)));
        return { ...s, downloaded: s.downloaded + add, currentByte: s.currentByte + add, status: 'downloading', speed: add };
      });
      t.downloadedBytes = t.segments.reduce((a, s) => a + s.downloaded, 0);
      emit('task-progress', { ...t });
    }
  }, 1000);
}
