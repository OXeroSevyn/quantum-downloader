import { contextBridge, ipcRenderer } from 'electron';
import { AppSettings, DownloadCategory } from './engine/types';

export const quantumApi = {
  getDownloads: () => ipcRenderer.invoke('get-downloads'),
  addDownload: (url: string, filename?: string, category?: DownloadCategory, headers?: Record<string, string>, quality?: string, formatId?: string) =>
    ipcRenderer.invoke('add-download', { url, filename, category, headers, quality, formatId }),
  pauseDownload: (id: string) => ipcRenderer.invoke('pause-download', id),
  stopDownload: (id: string) => ipcRenderer.invoke('stop-download', id),
  resumeDownload: (id: string) => ipcRenderer.invoke('resume-download', id),
  cancelDownload: (id: string) => ipcRenderer.invoke('cancel-download', id),
  deleteDownload: (id: string, deleteFileFromDisk: boolean) =>
    ipcRenderer.invoke('delete-download', { id, deleteFileFromDisk }),
  openFile: (id: string) => ipcRenderer.invoke('open-file', id),
  openFolder: (id: string) => ipcRenderer.invoke('open-folder', id),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke('save-settings', settings),
  selectDownloadFolder: () => ipcRenderer.invoke('select-download-folder'),

  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),

  // Standalone Dialog controls
  closeDialog: () => ipcRenderer.invoke('close-dialog-window'),
  showMainWindow: () => ipcRenderer.invoke('show-main-window'),
  getDialogData: () => ipcRenderer.invoke('get-dialog-data'),

  // Event listeners
  on: (channel: string, callback: (...args: any[]) => void) => {
    const handler = (_event: any, ...args: any[]) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
};

contextBridge.exposeInMainWorld('quantumApi', quantumApi);
