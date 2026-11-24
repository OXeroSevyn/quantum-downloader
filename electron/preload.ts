import { contextBridge, ipcRenderer } from 'electron';

const EVENT_CHANNELS = new Set([
  'task-added',
  'task-updated',
  'task-progress',
  'task-completed',
  'task-deleted',
  'task-error',
  'clipboard-url-detected',
  'show-download-dialog',
  'init-dialog-data',
  'shutdown-scheduled',
]);

const quantumApi = {
  getDownloads: () => ipcRenderer.invoke('get-downloads'),
  addDownload: (opts: {
    url: string;
    filename?: string;
    category?: string;
    headers?: Record<string, string>;
    quality?: string;
    formatId?: string;
    queueName?: string;
    priority?: number;
    directory?: string;
  }) => ipcRenderer.invoke('add-download', opts),
  probeFormats: (url: string) => ipcRenderer.invoke('probe-formats', url),
  pauseDownload: (id: string) => ipcRenderer.invoke('pause-download', id),
  stopDownload: (id: string) => ipcRenderer.invoke('stop-download', id),
  resumeDownload: (id: string) => ipcRenderer.invoke('resume-download', id),
  restartDownload: (id: string) => ipcRenderer.invoke('restart-download', id),
  cancelDownload: (id: string) => ipcRenderer.invoke('cancel-download', id),
  deleteDownload: (id: string, deleteFileFromDisk: boolean) => ipcRenderer.invoke('delete-download', { id, deleteFileFromDisk }),
  pauseAll: () => ipcRenderer.invoke('pause-all'),
  resumeAll: () => ipcRenderer.invoke('resume-all'),
  clearCompleted: () => ipcRenderer.invoke('clear-completed'),
  cancelShutdown: () => ipcRenderer.invoke('cancel-shutdown'),
  openFile: (id: string) => ipcRenderer.invoke('open-file', id),
  openFolder: (id: string) => ipcRenderer.invoke('open-folder', id),
  openDownloadDir: () => ipcRenderer.invoke('open-download-dir'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  openExtensionFolder: () => ipcRenderer.invoke('open-extension-folder'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: Record<string, unknown>) => ipcRenderer.invoke('save-settings', settings),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  selectDownloadFolder: () => ipcRenderer.invoke('select-download-folder'),

  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  closeDialog: () => ipcRenderer.invoke('close-dialog-window'),
  showMainWindow: () => ipcRenderer.invoke('show-main-window'),
  getDialogData: () => ipcRenderer.invoke('get-dialog-data'),

  platform: process.platform,

  on: (channel: string, callback: (...args: any[]) => void) => {
    if (!EVENT_CHANNELS.has(channel)) return () => {};
    const handler = (_event: unknown, ...args: any[]) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
};

export type QuantumApi = typeof quantumApi;
contextBridge.exposeInMainWorld('quantumApi', quantumApi);
