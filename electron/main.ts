import { app, BrowserWindow, ipcMain, dialog, clipboard, Tray, Menu, nativeImage, shell, nativeTheme, Notification } from 'electron';
import path from 'path';
import fs from 'fs';
import { StorageManager } from './engine/storage';
import { DownloadManager, AddTaskOptions } from './engine/download-manager';
import { LocalApiService } from './server/local-api';
import { VideoStreamDownloader } from './engine/video-stream-downloader';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}
app.setAppUserModelId('com.quantum.downloader');

// Last line of defence: log unexpected errors instead of showing a crash dialog
process.on('uncaughtException', (err) => console.error('[Quantum] Uncaught exception:', err));
process.on('unhandledRejection', (reason) => console.error('[Quantum] Unhandled rejection:', reason));

let mainWindow: BrowserWindow | null = null;
let dialogWindow: BrowserWindow | null = null;
let currentDialogData: any = null;
let tray: Tray | null = null;
let isQuitting = false;
let trayHintShown = false;

let storageManager: StorageManager;
let downloadManager: DownloadManager;
let localApi: LocalApiService;
let lastClipboardText = '';
let clipboardInterval: NodeJS.Timeout | null = null;

const isDev = !app.isPackaged;
const devServer = process.env.VITE_DEV_SERVER_URL;

const THEME = {
  light: { bg: '#f6f7fb', symbol: '#1f2333' },
  dark: { bg: '#0f1117', symbol: '#e7e9f0' },
};

function currentTheme(): 'light' | 'dark' {
  const t = downloadManager?.getSettings().theme;
  if (t === 'dark' || t === 'light') return t;
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function getAppIcon(): string | undefined {
  const candidates = [
    path.join(__dirname, '../build/icon.ico'),
    path.join(__dirname, '../build/icon.png'),
    path.join(process.resourcesPath || '', 'build/icon.ico'),
    path.join(app.getAppPath(), 'build/icon.ico'),
    path.join(app.getAppPath(), 'build/icon.png'),
  ];
  return candidates.find((p) => p && fs.existsSync(p));
}

function hardenWebContents(win: BrowserWindow) {
  // Never navigate the app window away or open new Electron windows from content
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const allowed = devServer ? url.startsWith(devServer) : url.startsWith('file://');
    if (!allowed) e.preventDefault();
  });
}

function loadRenderer(win: BrowserWindow, extra: Record<string, string> = {}) {
  const query = { ...extra, theme: currentTheme() };
  if (isDev && devServer) {
    const q = new URLSearchParams(query).toString();
    win.loadURL(devServer + (q ? `?${q}` : ''));
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'), { query });
  }
}

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

function showDownloadDialogWindow(downloadData: any) {
  currentDialogData = downloadData;

  if (dialogWindow && !dialogWindow.isDestroyed()) {
    dialogWindow.webContents.send('init-dialog-data', downloadData);
    dialogWindow.show();
    dialogWindow.focus();
    return;
  }

  const theme = THEME[currentTheme()];
  dialogWindow = new BrowserWindow({
    width: 520,
    height: 560,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    center: true,
    show: false,
    frame: false,
    title: 'New download – Quantum Downloader',
    icon: getAppIcon(),
    backgroundColor: theme.bg,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  hardenWebContents(dialogWindow);
  loadRenderer(dialogWindow, { dialog: 'true' });
  dialogWindow.once('ready-to-show', () => {
    dialogWindow?.show();
    dialogWindow?.focus();
  });
  dialogWindow.webContents.once('did-finish-load', () => {
    dialogWindow?.webContents.send('init-dialog-data', currentDialogData);
  });
  dialogWindow.on('closed', () => {
    dialogWindow = null;
  });
}

function createTray() {
  if (tray) return;
  try {
    const iconPath = getAppIcon();
    let image = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
    if (!image.isEmpty()) image = image.resize({ width: 16, height: 16 });
    tray = new Tray(image);
    tray.setToolTip('Quantum Downloader');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Quantum Downloader', click: showMainWindow },
        {
          label: 'New download…',
          click: () => {
            const clip = clipboard.readText().trim();
            showDownloadDialogWindow({ url: /^(https?:|magnet:)/i.test(clip) ? clip : '' });
          },
        },
        { type: 'separator' },
        { label: 'Pause all', click: () => downloadManager.pauseAll() },
        { label: 'Resume all', click: () => downloadManager.resumeAll() },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ])
    );
    tray.on('click', showMainWindow);
    tray.on('double-click', showMainWindow);
  } catch (err) {
    console.error('Failed to create tray icon:', err);
  }
}

function createWindow() {
  const theme = THEME[currentTheme()];
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'Quantum Downloader',
    icon: getAppIcon(),
    backgroundColor: theme.bg,
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? undefined : { color: theme.bg, symbolColor: theme.symbol, height: 44 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  hardenWebContents(mainWindow);
  downloadManager.setMainWindow(mainWindow);
  localApi.setMainWindow(mainWindow);
  loadRenderer(mainWindow);

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    mainWindow?.hide();
    if (!trayHintShown && Notification.isSupported()) {
      trayHintShown = true;
      new Notification({
        title: 'Quantum Downloader is still running',
        body: 'Downloads continue in the background. Right-click the tray icon to quit.',
      }).show();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    downloadManager.setMainWindow(null);
    localApi.setMainWindow(null);
  });
}

function setupClipboardMonitor() {
  if (clipboardInterval) clearInterval(clipboardInterval);
  try {
    lastClipboardText = clipboard.readText().trim(); // don't pop up for what was already copied
  } catch {
    /* ignore */
  }
  clipboardInterval = setInterval(() => {
    if (!downloadManager.getSettings().enableClipboardMonitor) return;
    try {
      const text = clipboard.readText().trim();
      if (!text || text === lastClipboardText) return;
      lastClipboardText = text;
      if (text.length > 4000 || /\s/.test(text)) return;
      const isLink = /^magnet:\?xt=/i.test(text) || /^https?:\/\/\S+$/i.test(text);
      if (!isLink) return;
      const likely =
        /^magnet:/i.test(text) ||
        /\.(mp4|mkv|webm|avi|mov|m3u8|zip|rar|7z|tar|gz|exe|msi|iso|pdf|mp3|flac|m4a|apk|dmg|torrent)($|[?#])/i.test(text) ||
        /(youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts|vimeo\.com\/\d|soundcloud\.com\/)/i.test(text);
      if (!likely) return;
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.webContents.send('clipboard-url-detected', text);
      } else {
        showDownloadDialogWindow({ url: text });
      }
    } catch {
      /* ignore */
    }
  }, 1200);
}

function senderWindow(e: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender);
}

function registerIpcHandlers() {
  ipcMain.handle('get-downloads', () => downloadManager.getAllTasks());

  ipcMain.handle('add-download', (_e, opts: AddTaskOptions) => {
    try {
      return { ok: true, task: downloadManager.addTask(opts || ({} as AddTaskOptions)) };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Could not add download' };
    }
  });

  ipcMain.handle('probe-formats', async (_e, url: string) => {
    try {
      const r = await VideoStreamDownloader.probeVideoFormats(String(url));
      return { ok: true, title: r.title, formats: r.formats };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Could not read video information' };
    }
  });

  ipcMain.handle('pause-download', (_e, id: string) => downloadManager.pauseTask(id));
  ipcMain.handle('stop-download', (_e, id: string) => downloadManager.stopTask(id));
  ipcMain.handle('resume-download', (_e, id: string) => downloadManager.resumeTask(id));
  ipcMain.handle('restart-download', (_e, id: string) => downloadManager.restartTask(id));
  ipcMain.handle('cancel-download', (_e, id: string) => downloadManager.cancelTask(id));
  ipcMain.handle('delete-download', (_e, { id, deleteFileFromDisk }) => downloadManager.deleteTask(id, Boolean(deleteFileFromDisk)));
  ipcMain.handle('pause-all', () => downloadManager.pauseAll());
  ipcMain.handle('resume-all', () => downloadManager.resumeAll());
  ipcMain.handle('clear-completed', () => downloadManager.clearCompleted());
  ipcMain.handle('cancel-shutdown', () => downloadManager.cancelPendingShutdown());
  ipcMain.handle('open-file', async (_e, id: string) => {
    const err = await downloadManager.openFile(id);
    return err || '';
  });
  ipcMain.handle('open-folder', (_e, id: string) => downloadManager.openFolder(id));
  ipcMain.handle('open-download-dir', () => shell.openPath(downloadManager.getSettings().downloadDir));
  ipcMain.handle('open-external', (_e, url: string) => {
    if (/^https:\/\//i.test(String(url))) shell.openExternal(url);
  });
  ipcMain.handle('open-extension-folder', () => {
    const p = app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(app.getAppPath(), 'extension');
    if (fs.existsSync(p)) shell.openPath(p);
    return fs.existsSync(p) ? p : '';
  });

  ipcMain.handle('get-settings', () => downloadManager.getSettings());
  ipcMain.handle('save-settings', (_e, settings) => {
    const saved = downloadManager.updateSettings(settings || {});
    if (settings && 'theme' in settings) applyTheme();
    return saved;
  });
  ipcMain.handle('get-app-info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    downloadsDir: app.getPath('downloads'),
    bridgeOnline: Boolean(localApi?.listening),
  }));

  ipcMain.handle('select-download-folder', async (e) => {
    const parent = senderWindow(e);
    const opts: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose download folder',
      defaultPath: downloadManager.getSettings().downloadDir,
    };
    const result = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
    return !result.canceled && result.filePaths[0] ? result.filePaths[0] : null;
  });

  ipcMain.handle('window-minimize', (e) => senderWindow(e)?.minimize());
  ipcMain.handle('window-maximize', (e) => {
    const w = senderWindow(e);
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.handle('window-close', (e) => senderWindow(e)?.close());
  ipcMain.handle('close-dialog-window', () => {
    if (dialogWindow && !dialogWindow.isDestroyed()) dialogWindow.close();
  });
  ipcMain.handle('show-main-window', () => showMainWindow());
  ipcMain.handle('get-dialog-data', () => currentDialogData);
}

function applyTheme() {
  const theme = THEME[currentTheme()];
  for (const w of [mainWindow, dialogWindow]) {
    if (!w || w.isDestroyed()) continue;
    w.setBackgroundColor(theme.bg);
    if (w === mainWindow && process.platform !== 'darwin') {
      try {
        w.setTitleBarOverlay({ color: theme.bg, symbolColor: theme.symbol, height: 44 });
      } catch {
        /* overlay unsupported */
      }
    }
  }
}

app.on('second-instance', (_e, argv) => {
  showMainWindow();
  const link = argv.find((a) => /^(magnet:|https?:\/\/)/i.test(a));
  if (link) showDownloadDialogWindow({ url: link });
});

app.whenReady().then(() => {
  storageManager = new StorageManager();
  downloadManager = new DownloadManager(storageManager);
  localApi = new LocalApiService(downloadManager, downloadManager.getSettings().serverPort || 52345);
  localApi.setShowDialogHandler((data) => showDownloadDialogWindow(data));
  localApi.start();

  registerIpcHandlers();
  createWindow();
  createTray();
  setupClipboardMonitor();
  downloadManager.init();

  nativeTheme.on('updated', applyTheme);
  app.on('activate', showMainWindow);
});

app.on('before-quit', () => {
  isQuitting = true;
  if (clipboardInterval) clearInterval(clipboardInterval);
  localApi?.stop();
  downloadManager?.shutdown();
});

app.on('window-all-closed', () => {
  if (isQuitting && process.platform !== 'darwin') app.quit();
});
