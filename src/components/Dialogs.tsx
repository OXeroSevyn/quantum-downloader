import React, { useEffect, useState } from 'react';
import { Puzzle, FolderOpen, Gauge, Globe, Info, Palette, Timer } from 'lucide-react';
import { AppSettings, DownloadTask, QueueSchedule } from '../types';
import { Modal, Segmented, Switch } from './ui';

/* ───────────────────────── Remove ───────────────────────── */
export const RemoveDialog: React.FC<{
  task: DownloadTask;
  onCancel: () => void;
  onConfirm: (deleteFile: boolean) => void;
}> = ({ task, onCancel, onConfirm }) => {
  const done = task.status === 'completed';
  const [deleteFile, setDeleteFile] = useState(false);
  return (
    <Modal
      title="Remove this download?"
      subtitle={task.filename}
      onClose={onCancel}
      size="narrow"
      footer={
        <>
          <span style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={onCancel}>
            Keep it
          </button>
          <button className="btn btn-danger" onClick={() => onConfirm(deleteFile)} autoFocus>
            {deleteFile ? 'Remove and delete file' : 'Remove'}
          </button>
        </>
      }
    >
      {done ? (
        <label className="check">
          <input type="checkbox" checked={deleteFile} onChange={(e) => setDeleteFile(e.target.checked)} />
          <span>
            Also delete the file from disk
            <br />
            <span className="field-hint">Otherwise it stays in your folder and only leaves this list.</span>
          </span>
        </label>
      ) : (
        <p style={{ margin: 0, color: 'var(--ink-2)' }}>
          The download stops and the partly downloaded data is deleted. You can add the link again later.
        </p>
      )}
    </Modal>
  );
};

/* ───────────────────────── Browser extension ───────────────────────── */
export const ExtensionDialog: React.FC<{ onClose: () => void; port: number }> = ({ onClose, port }) => {
  const api = window.quantumApi;
  const [browser, setBrowser] = useState<'chromium' | 'firefox'>('chromium');
  const [path, setPath] = useState('');
  const openFolder = async () => setPath((await api?.openExtensionFolder()) || '');

  return (
    <Modal
      title="Add the browser extension"
      subtitle="Catch downloads and videos from your browser and send them here."
      onClose={onClose}
      footer={
        <>
          <span className="left">
            <span className="dot-online" />
            Listening on port {port}
          </span>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="tabs">
        <Segmented
          label="Browser"
          value={browser}
          onChange={setBrowser}
          options={[
            { value: 'chromium', label: 'Chrome, Edge, Brave, Opera' },
            { value: 'firefox', label: 'Firefox' },
          ]}
        />
      </div>
      {browser === 'chromium' ? (
        <ol className="steps">
          <li>
            <span>
              Open <code>chrome://extensions</code> (in Edge: <code>edge://extensions</code>).
            </span>
          </li>
          <li>
            <span>Turn on Developer mode, in the corner of that page.</span>
          </li>
          <li>
            <span>
              Click <strong>Load unpacked</strong> and choose the extension folder.
              <br />
              <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={openFolder}>
                <FolderOpen />
                Show extension folder
              </button>
            </span>
          </li>
        </ol>
      ) : (
        <ol className="steps">
          <li>
            <span>
              Open <code>about:debugging#/runtime/this-firefox</code>.
            </span>
          </li>
          <li>
            <span>
              Click <strong>Load Temporary Add-on</strong> and pick <code>manifest.json</code> in the extension folder.
              <br />
              <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={openFolder}>
                <FolderOpen />
                Show extension folder
              </button>
            </span>
          </li>
        </ol>
      )}
      {path && (
        <p className="field-hint selectable" style={{ marginTop: 14 }}>
          {path}
        </p>
      )}
    </Modal>
  );
};

/* ───────────────────────── Settings ───────────────────────── */
type Section = 'general' | 'speed' | 'schedule' | 'browser' | 'about';
const SECTIONS: { id: Section; label: string; icon: React.FC<any> }[] = [
  { id: 'general', label: 'General', icon: Palette },
  { id: 'speed', label: 'Speed', icon: Gauge },
  { id: 'schedule', label: 'Schedule', icon: Timer },
  { id: 'browser', label: 'Browser', icon: Globe },
  { id: 'about', label: 'About', icon: Info },
];

const pad = (n: number) => String(n).padStart(2, '0');
const toTime = (h: number, m: number) => `${pad(h)}:${pad(m)}`;
const fromTime = (v: string): [number, number] => {
  const [h, m] = v.split(':').map((x) => parseInt(x, 10) || 0);
  return [Math.min(23, h), Math.min(59, m)];
};

const DEFAULT_SCHEDULE: QueueSchedule = { enabled: false, startHour: 1, startMinute: 0, stopHour: 7, stopMinute: 0, autoShutdownOnComplete: false };

export const SettingsDialog: React.FC<{
  settings: AppSettings;
  initialSection?: Section;
  onClose: () => void;
  onSave: (patch: Partial<AppSettings>) => Promise<void>;
  onOpenExtension: () => void;
  onShowIntro: () => void;
}> = ({ settings, initialSection = 'general', onClose, onSave, onOpenExtension, onShowIntro }) => {
  const api = window.quantumApi;
  const [section, setSection] = useState<Section>(initialSection);
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [limitOn, setLimitOn] = useState(settings.speedLimitKBps > 0);
  const [version, setVersion] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api?.getAppInfo().then((i) => setVersion(i.version));
  }, [api]);

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const schedule = draft.schedule || DEFAULT_SCHEDULE;
  const setSchedule = (patch: Partial<QueueSchedule>) => set('schedule', { ...schedule, ...patch });

  const save = async () => {
    setSaving(true);
    await onSave({ ...draft, speedLimitKBps: limitOn ? Math.max(1, draft.speedLimitKBps || 1024) : 0 });
    setSaving(false);
    onClose();
  };

  const browse = async () => {
    const p = await api?.selectDownloadFolder();
    if (p) set('downloadDir', p);
  };

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      size="wide"
      raw
      footer={
        <>
          <span style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            Save changes
          </button>
        </>
      }
    >
      <div className="settings">
        <div className="settings-nav" role="tablist" aria-orientation="vertical">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={section === s.id}
              aria-current={section === s.id}
              className="nav-item"
              onClick={() => setSection(s.id)}
            >
              <s.icon />
              {s.label}
            </button>
          ))}
        </div>
        <div className="settings-pane" role="tabpanel">
          {section === 'general' && (
            <>
              <div className="setting-stack">
                <div className="setting-text">
                  <strong>Download folder</strong>
                  <span>New downloads are saved here unless you choose another folder.</span>
                </div>
                <div className="input-row">
                  <input className="input" readOnly value={draft.downloadDir} title={draft.downloadDir} aria-label="Download folder" />
                  <button className="btn" onClick={browse}>
                    <FolderOpen />
                    Change
                  </button>
                </div>
              </div>
              <div className="setting">
                <div className="setting-text">
                  <strong>Appearance</strong>
                </div>
                <div className="setting-control">
                  <Segmented
                    label="Appearance"
                    value={(draft.theme === 'dark' || draft.theme === 'light' ? draft.theme : 'system') as 'light' | 'dark' | 'system'}
                    onChange={(v) => set('theme', v)}
                    options={[
                      { value: 'light', label: 'Light' },
                      { value: 'dark', label: 'Dark' },
                      { value: 'system', label: 'System' },
                    ]}
                  />
                </div>
              </div>
              <div className="setting">
                <div className="setting-text">
                  <strong>Watch the clipboard</strong>
                  <span>Offer to download when you copy a file, video or magnet link.</span>
                </div>
                <div className="setting-control">
                  <Switch label="Watch the clipboard" checked={draft.enableClipboardMonitor} onChange={(v) => set('enableClipboardMonitor', v)} />
                </div>
              </div>
              <div className="setting">
                <div className="setting-text">
                  <strong>Continue downloads on startup</strong>
                  <span>Unfinished downloads pick up where they stopped when the app opens.</span>
                </div>
                <div className="setting-control">
                  <Switch label="Continue downloads on startup" checked={draft.autoResumeOnStartup} onChange={(v) => set('autoResumeOnStartup', v)} />
                </div>
              </div>
            </>
          )}

          {section === 'speed' && (
            <>
              <div className="setting-stack">
                <div className="setting" style={{ border: 'none', padding: 0 }}>
                  <div className="setting-text">
                    <strong>Connections per download</strong>
                    <span>More connections are usually faster. Some servers limit them.</span>
                  </div>
                  <span className="value-pill">{draft.defaultConnections}</span>
                </div>
                <input
                  className="range"
                  type="range"
                  min={1}
                  max={32}
                  value={draft.defaultConnections}
                  onChange={(e) => set('defaultConnections', Number(e.target.value))}
                  aria-label="Connections per download"
                />
              </div>
              <div className="setting-stack">
                <div className="setting" style={{ border: 'none', padding: 0 }}>
                  <div className="setting-text">
                    <strong>Downloads at the same time</strong>
                    <span>The rest wait in line and start when one finishes.</span>
                  </div>
                  <span className="value-pill">{draft.maxActiveDownloads}</span>
                </div>
                <input
                  className="range"
                  type="range"
                  min={1}
                  max={10}
                  value={draft.maxActiveDownloads}
                  onChange={(e) => set('maxActiveDownloads', Number(e.target.value))}
                  aria-label="Downloads at the same time"
                />
              </div>
              <div className="setting">
                <div className="setting-text">
                  <strong>Limit download speed</strong>
                  <span>Leave bandwidth for browsing and calls.</span>
                </div>
                <div className="setting-control">
                  {limitOn && (
                    <>
                      <input
                        className="input number-input num"
                        type="number"
                        min={1}
                        value={draft.speedLimitKBps || 1024}
                        onChange={(e) => set('speedLimitKBps', Math.max(1, Number(e.target.value) || 1))}
                        aria-label="Speed limit in KB per second"
                      />
                      <span className="field-hint">KB/s</span>
                    </>
                  )}
                  <Switch
                    label="Limit download speed"
                    checked={limitOn}
                    onChange={(v) => {
                      setLimitOn(v);
                      if (v && !draft.speedLimitKBps) set('speedLimitKBps', 1024);
                    }}
                  />
                </div>
              </div>
            </>
          )}

          {section === 'schedule' && (
            <>
              <div className="setting">
                <div className="setting-text">
                  <strong>Download only during set hours</strong>
                  <span>Paused downloads resume at the start time and pause again at the end time.</span>
                </div>
                <div className="setting-control">
                  <Switch label="Use schedule" checked={schedule.enabled} onChange={(v) => setSchedule({ enabled: v })} />
                </div>
              </div>
              {schedule.enabled && (
                <div className="setting">
                  <div className="setting-text">
                    <strong>From</strong>
                  </div>
                  <div className="setting-control">
                    <input
                      className="input time-input num"
                      type="time"
                      value={toTime(schedule.startHour, schedule.startMinute)}
                      onChange={(e) => {
                        const [h, m] = fromTime(e.target.value);
                        setSchedule({ startHour: h, startMinute: m });
                      }}
                      aria-label="Start time"
                    />
                    <span className="field-hint">to</span>
                    <input
                      className="input time-input num"
                      type="time"
                      value={toTime(schedule.stopHour, schedule.stopMinute)}
                      onChange={(e) => {
                        const [h, m] = fromTime(e.target.value);
                        setSchedule({ stopHour: h, stopMinute: m });
                      }}
                      aria-label="End time"
                    />
                  </div>
                </div>
              )}
              <div className="setting">
                <div className="setting-text">
                  <strong>Shut down the computer when everything is done</strong>
                  <span>Windows gives you 60 seconds to cancel, and so does this app.</span>
                </div>
                <div className="setting-control">
                  <Switch
                    label="Shut down when done"
                    checked={Boolean(draft.autoShutdownOnQueueComplete)}
                    onChange={(v) => set('autoShutdownOnQueueComplete', v)}
                  />
                </div>
              </div>
            </>
          )}

          {section === 'browser' && (
            <>
              <div className="setting">
                <div className="setting-text">
                  <strong>Browser extension</strong>
                  <span>Sends downloads and videos from Chrome, Edge, Brave, Opera or Firefox to this app.</span>
                </div>
                <div className="setting-control">
                  <button className="btn" onClick={onOpenExtension}>
                    <Puzzle />
                    Set up
                  </button>
                </div>
              </div>
              <div className="setting">
                <div className="setting-text">
                  <strong>Bridge port</strong>
                  <span>Only the extension and programs on this computer can use it. Websites are blocked.</span>
                </div>
                <div className="setting-control">
                  <span className="code num">{draft.serverPort || 52345}</span>
                </div>
              </div>
            </>
          )}

          {section === 'about' && (
            <>
              <div className="setting">
                <div className="setting-text">
                  <strong>Quantum Downloader</strong>
                  <span className="num">Version {version || '…'}</span>
                </div>
              </div>
              <div className="setting">
                <div className="setting-text">
                  <strong>Introduction</strong>
                  <span>See the five-step tour again.</span>
                </div>
                <div className="setting-control">
                  <button className="btn" onClick={onShowIntro}>
                    Show introduction
                  </button>
                </div>
              </div>
              <div className="setting">
                <div className="setting-text">
                  <strong>Source code</strong>
                  <span>Made by Subham Dey. MIT licence.</span>
                </div>
                <div className="setting-control">
                  <button className="btn" onClick={() => api?.openExternal('https://github.com/OXeroSevyn/quantum-downloader')}>
                    Open on GitHub
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};
