import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleHelp, Link2, Pause, Play, Plus, Puzzle, Settings as SettingsIcon, Sparkles } from 'lucide-react';
import { AppSettings, DownloadTask, NewDownloadRequest } from './types';
import { classifyLink, friendlyIpcError } from './lib/format';
import { useTheme } from './lib/theme';
import { BrandMark, Lanes, Modal, ToastProvider, useToast } from './components/ui';
import { Sidebar, ViewKey, VIEW_TITLE, matchesView } from './components/Sidebar';
import { DownloadList, TaskActions } from './components/DownloadList';
import { DetailPanel, StatusBar } from './components/DetailPanel';
import { AddDownloadForm } from './components/AddDownloadForm';
import { ExtensionDialog, RemoveDialog, SettingsDialog } from './components/Dialogs';
import { Intro } from './components/Intro';

const DEFAULT_SETTINGS: AppSettings = {
  downloadDir: '',
  defaultConnections: 16,
  maxActiveDownloads: 4,
  speedLimitKBps: 0,
  theme: 'system',
  autoResumeOnStartup: true,
  enableClipboardMonitor: true,
  serverPort: 52345,
  hasCompletedWelcome: true,
};

type Dialog =
  | { type: 'add'; initial: Partial<NewDownloadRequest> | null }
  | { type: 'settings'; section?: 'general' | 'speed' | 'schedule' | 'browser' | 'about' }
  | { type: 'extension' }
  | { type: 'remove'; task: DownloadTask }
  | null;

const Shell: React.FC = () => {
  const api = window.quantumApi;
  const toast = useToast();
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<ViewKey>({ type: 'status', value: 'all' });
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [showIntro, setShowIntro] = useState(false);
  const [themePreview, setThemePreview] = useState<string | null>(null);
  const [quick, setQuick] = useState('');
  const [shutdownPending, setShutdownPending] = useState(false);
  const [bridgeOnline, setBridgeOnline] = useState<boolean | null>(null);
  const quickRef = useRef<HTMLInputElement>(null);

  useTheme(themePreview || settings.theme);

  // ── Load + live updates ──
  useEffect(() => {
    if (!api) return;
    Promise.all([api.getSettings(), api.getDownloads()]).then(([s, t]) => {
      setSettings(s);
      setTasks(t || []);
      setShowIntro(!s.hasCompletedWelcome);
      setLoaded(true);
    });
    // The bridge binds asynchronously; ask after it has had a moment
    const bridgeTimer = setTimeout(() => api.getAppInfo().then((i) => setBridgeOnline(Boolean(i.bridgeOnline))), 1500);
    const upsert = (task: DownloadTask) =>
      setTasks((prev) => {
        const i = prev.findIndex((t) => t.id === task.id);
        if (i === -1) return [task, ...prev];
        const next = prev.slice();
        next[i] = task;
        return next;
      });
    const offs = [
      api.on('task-added', (t: DownloadTask) => {
        upsert(t);
        setSelectedId(t.id);
      }),
      api.on('task-updated', upsert),
      api.on('task-progress', upsert),
      api.on('task-completed', upsert),
      api.on('task-deleted', (id: string) => {
        setTasks((prev) => prev.filter((t) => t.id !== id));
        setSelectedId((cur) => (cur === id ? null : cur));
      }),
      api.on('clipboard-url-detected', (url: string) => setDialog({ type: 'add', initial: { url } })),
      api.on('show-download-dialog', (data: Partial<NewDownloadRequest>) => setDialog({ type: 'add', initial: data })),
      api.on('shutdown-scheduled', () => setShutdownPending(true)),
    ];
    return () => {
      clearTimeout(bridgeTimer);
      offs.forEach((off) => off());
    };
  }, [api]);

  // ── Actions ──
  const actions: TaskActions = useMemo(
    () => ({
      pause: (id) => api?.pauseDownload(id),
      resume: (id) => api?.resumeDownload(id),
      restart: (id) => {
        api?.restartDownload(id);
        toast('Downloading again from the start.');
      },
      remove: (task) => setDialog({ type: 'remove', task }),
      openFile: async (id) => {
        const err = await api?.openFile(id);
        if (err) toast(`Couldn’t open the file: ${err}`, 'error');
      },
      openFolder: (id) => api?.openFolder(id),
      copyLink: (task) => {
        navigator.clipboard.writeText(task.url).then(
          () => toast('Link copied.', 'success'),
          () => toast('Couldn’t copy the link.', 'error')
        );
      },
    }),
    [api, toast]
  );

  const saveSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      if (!api) return;
      const saved = await api.saveSettings(patch);
      setSettings(saved);
    },
    [api]
  );

  const quickAdd = async () => {
    const url = quick.trim();
    if (!url || !api) return;
    const kind = classifyLink(url);
    if (kind === 'invalid') {
      toast('That doesn’t look like a link that can be downloaded.', 'error');
      return;
    }
    // Video pages need a quality choice; several links get the full dialog too
    if (kind === 'video' || /\s/.test(url)) {
      setDialog({ type: 'add', initial: { url } });
      setQuick('');
      return;
    }
    try {
      const res = await api.addDownload({ url });
      if (res.ok) {
        setQuick('');
        setView({ type: 'status', value: 'all' });
      } else toast(res.error, 'error');
    } catch (e) {
      toast(friendlyIpcError(e), 'error');
    }
  };

  // ── Derived ──
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks
      .filter((t) => matchesView(t, view))
      .filter((t) => !q || t.filename.toLowerCase().includes(q) || t.url.toLowerCase().includes(q))
      .sort((a, b) => {
        const rank = (t: DownloadTask) => (t.status === 'downloading' ? 0 : t.status === 'queued' ? 1 : t.status === 'error' ? 2 : t.status === 'paused' ? 3 : 4);
        return rank(a) - rank(b) || (b.priority || 0) - (a.priority || 0) || b.createdAt - a.createdAt;
      });
  }, [tasks, view, search]);

  const selected = tasks.find((t) => t.id === selectedId) || null;

  // Keep something selected so the detail panel is useful
  useEffect(() => {
    if (!visible.length) return;
    if (!selectedId || !visible.some((t) => t.id === selectedId)) setSelectedId(visible[0].id);
  }, [visible, selectedId]);
  const hasActive = tasks.some((t) => t.status === 'downloading' || t.status === 'queued');
  const hasResumable = tasks.some((t) => t.status === 'paused' || t.status === 'error');
  const hasDone = tasks.some((t) => t.status === 'completed');

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog || showIntro) return;
      const mod = e.ctrlKey || e.metaKey;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName);
      if (mod && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        quickRef.current?.focus();
        quickRef.current?.select();
      } else if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setDialog({ type: 'add', initial: null });
      } else if (mod && e.key === ',') {
        e.preventDefault();
        setDialog({ type: 'settings' });
      } else if (!typing && selected) {
        if (e.key === 'Delete') {
          e.preventDefault();
          setDialog({ type: 'remove', task: selected });
        } else if (e.key === ' ') {
          e.preventDefault();
          if (selected.status === 'downloading' || selected.status === 'queued') actions.pause(selected.id);
          else if (selected.status === 'paused' || selected.status === 'error') actions.resume(selected.id);
        } else if (e.key === 'Enter' && selected.status === 'completed') {
          actions.openFile(selected.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, showIntro, selected, actions]);

  const isMac = api?.platform === 'darwin';
  const mod = isMac ? '⌘' : 'Ctrl';

  const emptyState =
    tasks.length === 0 ? (
      <div className="empty">
        <Lanes
          task={{
            id: 'demo',
            url: '',
            filename: '',
            filepath: '',
            totalBytes: 1,
            downloadedBytes: 0,
            speed: 0,
            status: 'paused',
            connections: 8,
            segments: [],
            category: 'other',
            createdAt: 0,
            resumable: true,
          }}
        />
        <h2>Nothing downloading yet</h2>
        <p>
          Paste a link into the bar above, or press <span className="kbd">{mod} N</span> to add several at once.
        </p>
        <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => setDialog({ type: 'add', initial: null })}>
          <Plus />
          Add a download
        </button>
      </div>
    ) : (
      <div className="empty">
        <h2>No downloads here</h2>
        <p>{search ? `Nothing matches “${search}”.` : 'Downloads will show up here when they reach this state.'}</p>
      </div>
    );

  if (!api) {
    return (
      <div className="empty" style={{ height: '100%' }}>
        <h2>Open this inside the Quantum Downloader app</h2>
        <p>The interface needs the desktop app to download files.</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className={`titlebar${isMac ? ' mac' : ''}`}>
        <div className="brand">
          <BrandMark />
          Quantum Downloader
        </div>
        <form
          className="quickadd"
          onSubmit={(e) => {
            e.preventDefault();
            quickAdd();
          }}
        >
          <Link2 />
          <input
            ref={quickRef}
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            placeholder="Paste a link, video page or magnet link"
            aria-label="Paste a link to download"
            spellCheck={false}
          />
          {!quick && <span className="kbd">{mod} L</span>}
          {quick && (
            <button type="submit" className="btn btn-primary">
              Download
            </button>
          )}
        </form>
        <div className="titlebar-tools">
          <button className="icon-btn" title={`Add downloads (${mod} N)`} aria-label="Add downloads" onClick={() => setDialog({ type: 'add', initial: null })}>
            <Plus />
          </button>
          <button className="icon-btn" title="Browser extension" aria-label="Browser extension" onClick={() => setDialog({ type: 'extension' })}>
            <Puzzle />
          </button>
          <button className="icon-btn" title="Introduction" aria-label="Show introduction" onClick={() => setShowIntro(true)}>
            <CircleHelp />
          </button>
          <button className="icon-btn" title={`Settings (${mod} ,)`} aria-label="Settings" onClick={() => setDialog({ type: 'settings' })}>
            <SettingsIcon />
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {shutdownPending && (
          <div className="banner" role="alert">
            All downloads finished. Your computer will shut down in about a minute.
            <button
              className="btn btn-sm"
              onClick={async () => {
                await api.cancelShutdown();
                setShutdownPending(false);
                toast('Shutdown cancelled.', 'success');
              }}
            >
              Cancel shutdown
            </button>
          </div>
        )}
        <div className={`app-body${selected ? '' : ''}`} style={{ flex: 1, minHeight: 0 }}>
          <Sidebar
            tasks={tasks}
            view={view}
            onChange={(v) => {
              setView(v);
              setSearch('');
            }}
            downloadDir={settings.downloadDir}
            onOpenDir={() => api.openDownloadDir()}
          />
          <DownloadList
            title={VIEW_TITLE(view)}
            tasks={visible}
            totalCount={tasks.filter((t) => matchesView(t, view)).length}
            selectedId={selectedId}
            onSelect={setSelectedId}
            actions={actions}
            search={search}
            onSearch={setSearch}
            emptyState={loaded ? emptyState : null}
            headerActions={
              <>
                {hasResumable && (
                  <button className="btn btn-ghost btn-sm" onClick={() => api.resumeAll()} title="Resume all paused and failed downloads">
                    <Play />
                    Resume all
                  </button>
                )}
                {hasActive && (
                  <button className="btn btn-ghost btn-sm" onClick={() => api.pauseAll()}>
                    <Pause />
                    Pause all
                  </button>
                )}
                {hasDone && (view.value === 'completed' || view.value === 'all') && (
                  <button className="btn btn-ghost btn-sm" onClick={() => api.clearCompleted()} title="Remove finished downloads from the list (files stay on disk)">
                    <Sparkles />
                    Clear finished
                  </button>
                )}
              </>
            }
          />
          <DetailPanel key={selected?.id || 'none'} task={selected} actions={actions} />
        </div>
      </div>

      <StatusBar
        tasks={tasks}
        speedLimitKBps={settings.speedLimitKBps}
        bridgePort={settings.serverPort || 52345}
        bridgeOnline={bridgeOnline}
        onOpenSpeed={() => setDialog({ type: 'settings', section: 'speed' })}
      />

      {dialog?.type === 'add' && (
        <Modal
          title="Add downloads"
          subtitle="Paste one link, or several on separate lines."
          onClose={() => setDialog(null)}
          raw
        >
          <AddDownloadForm
            initial={dialog.initial}
            defaultDir={settings.downloadDir}
            onCancel={() => setDialog(null)}
            onDone={(n) => {
              setDialog(null);
              setView({ type: 'status', value: 'all' });
              if (n > 1) toast(`${n} downloads added.`, 'success');
            }}
          />
        </Modal>
      )}
      {dialog?.type === 'settings' && (
        <SettingsDialog
          settings={settings}
          initialSection={dialog.section}
          onClose={() => setDialog(null)}
          onSave={async (patch) => {
            await saveSettings(patch);
            toast('Settings saved.', 'success');
          }}
          onOpenExtension={() => setDialog({ type: 'extension' })}
          onShowIntro={() => {
            setDialog(null);
            setShowIntro(true);
          }}
        />
      )}
      {dialog?.type === 'extension' && <ExtensionDialog port={settings.serverPort || 52345} onClose={() => setDialog(null)} />}
      {dialog?.type === 'remove' && (
        <RemoveDialog
          task={dialog.task}
          onCancel={() => setDialog(null)}
          onConfirm={(deleteFile) => {
            api.deleteDownload(dialog.task.id, deleteFile);
            setDialog(null);
            toast(deleteFile ? 'Download removed and file deleted.' : 'Download removed.', 'success');
          }}
        />
      )}
      {showIntro && loaded && (
        <Intro
          settings={settings}
          onPreview={(p) => setThemePreview(p.theme || null)}
          onFinish={async (patch) => {
            await saveSettings(patch);
            setThemePreview(null);
            setShowIntro(false);
          }}
        />
      )}
    </div>
  );
};

export const App: React.FC = () => (
  <ToastProvider>
    <Shell />
  </ToastProvider>
);

export default App;
