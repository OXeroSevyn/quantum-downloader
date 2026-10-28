import { app, BrowserWindow, ipcMain, dialog, clipboard, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import { StorageManager } from './engine/storage';
import { DownloadManager } from './engine/download-manager';
import { LocalApiService } from './server/local-api';

// Enforce single instance so background tray instance doesn't conflict
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

let mainWindow: BrowserWindow | null = null;
let dialogWindow: BrowserWindow | null = null;
let currentDialogData: any = null;
let tray: Tray | null = null;
let isQuitting = false;

let storageManager: StorageManager;
let downloadManager: DownloadManager;
let localApi: LocalApiService;
let lastClipboardText = '';
let clipboardInterval: NodeJS.Timeout | null = null;

function getAppIcon(): string | undefined {
  const possibleIcons = [
    path.join(__dirname, '../build/icon.ico'),
    path.join(__dirname, '../build/icon.png'),
    path.join(__dirname, '../dist/assets/logo.png'),
    path.join(process.resourcesPath, 'build/icon.ico'),
    path.join(app.getAppPath(), 'build/icon.ico'),
    path.join(app.getAppPath(), 'build/icon.png')
  ];
  return possibleIcons.find(p => fs.existsSync(p));
}

function showDownloadDialogWindow(downloadData: any) {
  currentDialogData = downloadData;

  if (dialogWindow && !dialogWindow.isDestroyed()) {
    dialogWindow.webContents.send('init-dialog-data', downloadData);
    if (dialogWindow.isMinimized()) dialogWindow.restore();
    dialogWindow.show();
    dialogWindow.focus();
    return;
  }

  const iconPath = getAppIcon();
  dialogWindow = new BrowserWindow({
    width: 540,
    height: 440,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    center: true,
    title: 'Download File Info - Quantum Downloader',
    icon: iconPath,
    backgroundColor: '#ffffff',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    dialogWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?dialog=true`);
  } else {
    dialogWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      query: { dialog: 'true' }
    });
  }

  dialogWindow.webContents.once('did-finish-load', () => {
    dialogWindow?.webContents.send('init-dialog-data', downloadData);
  });

  dialogWindow.on('closed', () => {
    dialogWindow = null;
  });
}

function createTray(iconPath?: string) {
  if (tray) return;

  try {
    let trayImage = iconPath && fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : null;
    if (!trayImage || trayImage.isEmpty()) {
      trayImage = nativeImage.createEmpty();
    }

    tray = new Tray(trayImage);
    tray.setToolTip('Quantum Downloader - High-Speed Accelerator (Running)');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open Quantum Downloader',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        }
      },
      {
        label: 'Add URL Download...',
        click: () => {
          const clipText = clipboard.readText().trim();
          showDownloadDialogWindow({ url: clipText.startsWith('http') ? clipText : '' });
        }
      },
      { type: 'separator' },
      {
        label: 'Exit Quantum Downloader',
        click: () => {
          isQuitting = true;
          if (clipboardInterval) clearInterval(clipboardInterval);
          if (localApi) localApi.stop();
          app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      } else {
        createWindow();
      }
    });

    tray.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      } else {
        createWindow();
      }
    });
  } catch (err) {
    console.error('Failed to create tray icon:', err);
  }
}

function createWindow() {
  const iconPath = getAppIcon();

  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: 'Quantum Downloader',
    icon: iconPath,
    backgroundColor: '#e6edf4',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  downloadManager.setMainWindow(mainWindow);
  localApi.setMainWindow(mainWindow);

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Minimize to tray on close button click unless quitting
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    localApi.setMainWindow(null);
  });

  setupClipboardMonitor();
}

function setupClipboardMonitor() {
  if (clipboardInterval) clearInterval(clipboardInterval);

  clipboardInterval = setInterval(() => {
    const settings = downloadManager.getSettings();
    if (!settings.enableClipboardMonitor) return;

    try {
      const text = clipboard.readText().trim();
      if (text && text !== lastClipboardText) {
        lastClipboardText = text;
        if (/^https?:\/\/[^\s]+$/i.test(text)) {
          const isDownloadLikely = /\.(mp4|m3u8|mkv|zip|rar|7z|exe|iso|tar|gz|pdf|mp3|flac|apk)($|\?)/i.test(text) ||
            /youtube\.com|youtu\.be|vimeo\.com|soundcloud\.com/i.test(text);

          if (isDownloadLikely) {
            if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
              mainWindow.webContents.send('clipboard-url-detected', text);
            } else {
              showDownloadDialogWindow({ url: text });
            }
          }
        }
      }
    } catch (e) {}
  }, 1500);
}

function registerIpcHandlers() {
  ipcMain.handle('get-downloads', () => {
    return downloadManager.getAllTasks();
  });

  ipcMain.handle('add-download', (_event, { url, filename, category, headers, quality, formatId }) => {
    return downloadManager.addTask(url, filename, category, headers, quality, formatId);
  });

  ipcMain.handle('pause-download', (_event, id: string) => {
    downloadManager.pauseTask(id);
    return true;
  });

  ipcMain.handle('stop-download', (_event, id: string) => {
    downloadManager.stopTask(id);
    return true;
  });

  ipcMain.handle('resume-download', (_event, id: string) => {
    downloadManager.resumeTask(id);
    return true;
  });

  ipcMain.handle('cancel-download', (_event, id: string) => {
    downloadManager.cancelTask(id);
    return true;
  });

  ipcMain.handle('delete-download', (_event, { id, deleteFileFromDisk }) => {
    downloadManager.deleteTask(id, deleteFileFromDisk);
    return true;
  });

  ipcMain.handle('open-file', (_event, id: string) => {
    downloadManager.openFile(id);
    return true;
  });

  ipcMain.handle('open-folder', (_event, id: string) => {
    downloadManager.openFolder(id);
    return true;
  });

  ipcMain.handle('get-settings', () => {
    return downloadManager.getSettings();
  });

  ipcMain.handle('save-settings', (_event, settings) => {
    return downloadManager.updateSettings(settings);
  });

  ipcMain.handle('select-download-folder', async () => {
    const parentWin = dialogWindow && !dialogWindow.isDestroyed() ? dialogWindow : mainWindow;
    const result = await dialog.showOpenDialog(parentWin || undefined as any, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Default Downloads Folder',
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  // Window controls
  ipcMain.handle('window-minimize', () => mainWindow?.minimize());
  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.handle('window-close', () => {
    mainWindow?.hide();
  });

  // Standalone Dialog window controls
  ipcMain.handle('close-dialog-window', () => {
    if (dialogWindow && !dialogWindow.isDestroyed()) {
      dialogWindow.close();
    }
  });

  ipcMain.handle('show-main-window', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  ipcMain.handle('get-dialog-data', () => {
    return currentDialogData;
  });
}

app.whenReady().then(() => {
  storageManager = new StorageManager();
  downloadManager = new DownloadManager(storageManager);
  localApi = new LocalApiService(downloadManager, downloadManager.getSettings().serverPort || 52345);

  // Wire standalone dialog window when browser intercepts download
  localApi.setShowDialogHandler((data) => {
    showDownloadDialogWindow(data);
  });

  localApi.start();

  registerIpcHandlers();
  createWindow();
  createTray(getAppIcon());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (isQuitting) {
    if (clipboardInterval) clearInterval(clipboardInterval);
    if (localApi) localApi.stop();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  }
});
