import React, { useState, useEffect } from 'react';
import { DownloadTask, AppSettings, DownloadCategory } from './types';
import { QuickSaveHeader } from './components/QuickSaveHeader';
import { Toolbar } from './components/Toolbar';
import { QuickSaveSidebar } from './components/QuickSaveSidebar';
import { QuickSaveTable } from './components/QuickSaveTable';
import { DetailInspector } from './components/DetailInspector';
import { BottomStatusBar } from './components/BottomStatusBar';
import { WelcomeModal } from './components/WelcomeModal';
import { NewDownloadModal } from './components/NewDownloadModal';
import { SettingsModal } from './components/SettingsModal';
import { BrowserExtensionModal } from './components/BrowserExtensionModal';

export const App: React.FC = () => {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  const [settings, setSettings] = useState<AppSettings>({
    downloadDir: '',
    defaultConnections: 16,
    maxActiveDownloads: 4,
    speedLimitKBps: 0,
    theme: 'light',
    autoResumeOnStartup: true,
    enableClipboardMonitor: true,
    serverPort: 52345,
    hasCompletedWelcome: true,
  });

  // Apply theme to document.body
  useEffect(() => {
    const isDark = settings.theme === 'dark';
    if (isDark) {
      document.body.classList.add('theme-dark');
      document.body.classList.remove('theme-light');
    } else {
      document.body.classList.add('theme-light');
      document.body.classList.remove('theme-dark');
    }
  }, [settings.theme]);

  const [isNewModalOpen, setIsNewModalOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isExtModalOpen, setIsExtModalOpen] = useState<boolean>(false);
  const [showWelcome, setShowWelcome] = useState<boolean>(false);
  const [clipboardUrl, setClipboardUrl] = useState<string>('');
  const [dialogDownloadData, setDialogDownloadData] = useState<{
    url: string;
    filename?: string;
    category?: DownloadCategory;
    headers?: Record<string, string>;
    quality?: string;
    formatId?: string;
  } | null>(null);

  // Initial load
  useEffect(() => {
    if (window.quantumApi) {
      window.quantumApi.getSettings().then((s) => {
        setSettings(s);
      });

      window.quantumApi.getDownloads().then((t) => {
        const realTasks = (t || []).filter(task => !task.id?.startsWith('task-demo-'));
        setTasks(realTasks);
        if (realTasks.length > 0) {
          setSelectedTaskId(realTasks[0].id);
        } else {
          setSelectedTaskId(null);
        }
      });

      // IPC event listeners
      const unsubAdd = window.quantumApi.on('task-added', (newTask: DownloadTask) => {
        setTasks((prev) => [newTask, ...prev.filter(t => t.id !== newTask.id)]);
        setSelectedTaskId(newTask.id);
      });

      const unsubUpdate = window.quantumApi.on('task-updated', (updated: DownloadTask) => {
        setTasks((prev) => prev.map(t => t.id === updated.id ? updated : t));
      });

      const unsubProgress = window.quantumApi.on('task-progress', (prog: DownloadTask) => {
        setTasks((prev) => prev.map(t => t.id === prog.id ? prog : t));
      });

      const unsubComplete = window.quantumApi.on('task-completed', (comp: DownloadTask) => {
        setTasks((prev) => prev.map(t => t.id === comp.id ? comp : t));
      });

      const unsubDelete = window.quantumApi.on('task-deleted', (id: string) => {
        setTasks((prev) => prev.filter(t => t.id !== id));
        setSelectedTaskId(prev => prev === id ? null : prev);
      });

      const unsubError = window.quantumApi.on('task-error', ({ id, error }: { id: string; error: string }) => {
        setTasks((prev) => prev.map(t => t.id === id ? { ...t, status: 'error', errorMessage: error, speed: 0 } : t));
      });

      const unsubClip = window.quantumApi.on('clipboard-url-detected', (url: string) => {
        setDialogDownloadData(null);
        setClipboardUrl(url);
        setIsNewModalOpen(true);
      });

      const unsubDialog = window.quantumApi.on('show-download-dialog', (data: any) => {
        setDialogDownloadData(data);
        setClipboardUrl(data?.url || '');
        setIsNewModalOpen(true);
      });

      return () => {
        unsubAdd();
        unsubUpdate();
        unsubProgress();
        unsubComplete();
        unsubError();
        unsubDelete();
        unsubClip();
        unsubDialog();
      };
    } else {
      setTasks([]);
      setSelectedTaskId(null);
    }
  }, []);

  const handleManualAdd = async (
    url: string,
    filename?: string,
    category?: DownloadCategory,
    headers?: Record<string, string>,
    quality?: string,
    formatId?: string
  ) => {
    if (window.quantumApi) {
      const task = await window.quantumApi.addDownload(url, filename, category, headers, quality, formatId);
      setTasks(prev => [task, ...prev.filter(t => t.id !== task.id)]);
      setSelectedTaskId(task.id);
    }
  };

  const handlePause = (id?: string) => {
    const targetId = id || selectedTaskId;
    if (!targetId && tasks.length > 0) {
      const candidate = tasks.find(t => t.status === 'downloading');
      if (candidate && window.quantumApi) {
        window.quantumApi.pauseDownload(candidate.id);
      }
      return;
    }
    if (targetId && window.quantumApi) {
      window.quantumApi.pauseDownload(targetId);
    }
  };

  const handleResume = (id?: string) => {
    const targetId = id || selectedTaskId;
    if (!targetId && tasks.length > 0) {
      const candidate = tasks.find(t => t.status === 'paused' || t.status === 'error');
      if (candidate && window.quantumApi) {
        window.quantumApi.resumeDownload(candidate.id);
      }
      return;
    }
    if (targetId && window.quantumApi) {
      window.quantumApi.resumeDownload(targetId);
    }
  };

  const handleStop = (id?: string) => {
    const targetId = id || selectedTaskId;
    if (!targetId && tasks.length > 0) {
      const candidate = tasks.find(t => t.status === 'downloading');
      if (candidate && window.quantumApi) {
        window.quantumApi.stopDownload(candidate.id);
      }
      return;
    }
    if (targetId && window.quantumApi) {
      window.quantumApi.stopDownload(targetId);
    }
  };

  const handleDelete = (id?: string) => {
    const targetId = id || selectedTaskId;
    if (targetId) {
      if (window.quantumApi) {
        window.quantumApi.deleteDownload(targetId, false);
      }
      setTasks(prev => prev.filter(t => t.id !== targetId));
      if (selectedTaskId === targetId) {
        const remaining = tasks.filter(t => t.id !== targetId);
        setSelectedTaskId(remaining.length > 0 ? remaining[0].id : null);
      }
    }
  };

  const handleDeleteCompleted = () => {
    const completedTasks = tasks.filter(t => t.status === 'completed');
    if (window.quantumApi) {
      completedTasks.forEach(t => window.quantumApi.deleteDownload(t.id, false));
    }
    setTasks(prev => prev.filter(t => t.status !== 'completed'));
    if (selectedTaskId && completedTasks.some(t => t.id === selectedTaskId)) {
      const remaining = tasks.filter(t => t.status !== 'completed');
      setSelectedTaskId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const handleOpenFile = (id: string) => {
    if (window.quantumApi) window.quantumApi.openFile(id);
  };

  const handleOpenFolder = (id: string) => {
    if (window.quantumApi) window.quantumApi.openFolder(id);
  };

  const handleSaveSettings = async (newSettings: Partial<AppSettings>) => {
    if (window.quantumApi) {
      const updated = await window.quantumApi.saveSettings(newSettings);
      setSettings(updated);
    }
  };

  const handleSelectFolder = async (): Promise<string | null> => {
    if (window.quantumApi) {
      return await window.quantumApi.selectDownloadFolder();
    }
    return null;
  };

  // Filter tasks based on search, category & status
  const filteredTasks = tasks.filter((t) => {
    const matchesSearch = !searchQuery.trim() ||
      t.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.url.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory = selectedCategory === 'all' ||
      t.category === selectedCategory ||
      (selectedCategory === 'video' && /\.(mp4|mkv|avi|mov)$/i.test(t.filename)) ||
      (selectedCategory === 'audio' && /\.(mp3|wav|flac|aac)$/i.test(t.filename)) ||
      (selectedCategory === 'compressed' && /\.(zip|rar|7z|tar)$/i.test(t.filename)) ||
      (selectedCategory === 'document' && /\.(pdf|doc|docx|txt)$/i.test(t.filename)) ||
      (selectedCategory === 'image' && /\.(jpg|jpeg|png|gif)$/i.test(t.filename)) ||
      (selectedCategory === 'program' && /\.(exe|msi|pkg|deb)$/i.test(t.filename));

    const matchesStatus = selectedStatus === 'all' || t.status === selectedStatus;

    return matchesSearch && matchesCategory && matchesStatus;
  });

  const selectedTask = tasks.find(t => t.id === selectedTaskId) || (tasks.length > 0 ? tasks[0] : null);

  return (
    <div className="quantum-app-container">
      {/* 1. Title bar */}
      <QuickSaveHeader
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenHelp={() => setShowWelcome(true)}
      />

      {/* 2. Main Toolbar */}
      <Toolbar
        onAddUrl={() => {
          setClipboardUrl('');
          setDialogDownloadData(null);
          setIsNewModalOpen(true);
        }}
        onResume={() => handleResume()}
        onPause={() => handlePause()}
        onStop={() => handleStop()}
        onDelete={() => handleDelete()}
        onDeleteCompleted={handleDeleteCompleted}
        onOpenScheduler={() => setIsSettingsOpen(true)}
        onOpenGrabber={() => setIsExtModalOpen(true)}
        onOpenOptions={() => setIsSettingsOpen(true)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* 3. Main Workspace: Left Sidebar + (Top Table / Bottom Inspector) */}
      <div className="quantum-main-workspace">
        {/* Left Sidebar */}
        <QuickSaveSidebar
          tasks={tasks}
          selectedCategory={selectedCategory}
          selectedStatus={selectedStatus}
          onSelectCategory={(cat) => {
            setSelectedCategory(cat);
            setSelectedStatus('all');
          }}
          onSelectStatus={(st) => {
            setSelectedStatus(st);
            setSelectedCategory('all');
          }}
        />

        {/* Right Main Split: Table above, Inspector below */}
        <main className="quantum-content-split">
          <QuickSaveTable
            tasks={filteredTasks}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
            onPause={handlePause}
            onResume={handleResume}
            onDelete={handleDelete}
            onOpenFile={handleOpenFile}
            onOpenFolder={handleOpenFolder}
          />

          <DetailInspector
            task={selectedTask}
            onOpenFile={handleOpenFile}
            onOpenFolder={handleOpenFolder}
            onPause={handlePause}
            onResume={handleResume}
          />
        </main>
      </div>

      {/* 4. Bottom Status Bar */}
      <BottomStatusBar tasks={tasks} />

      {/* Modals */}
      <NewDownloadModal
        isOpen={isNewModalOpen}
        initialUrl={dialogDownloadData?.url || clipboardUrl}
        initialFilename={dialogDownloadData?.filename}
        initialCategory={dialogDownloadData?.category}
        initialHeaders={dialogDownloadData?.headers}
        initialQuality={dialogDownloadData?.quality}
        initialFormatId={dialogDownloadData?.formatId}
        onClose={() => {
          setIsNewModalOpen(false);
          setDialogDownloadData(null);
          setClipboardUrl('');
        }}
        onSubmit={handleManualAdd}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        settings={settings}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveSettings}
        onSelectFolder={handleSelectFolder}
      />

      <BrowserExtensionModal
        isOpen={isExtModalOpen}
        onClose={() => setIsExtModalOpen(false)}
        serverPort={settings.serverPort || 52345}
      />

      <WelcomeModal
        isOpen={showWelcome}
        onFinish={() => setShowWelcome(false)}
      />
    </div>
  );
};

export default App;
