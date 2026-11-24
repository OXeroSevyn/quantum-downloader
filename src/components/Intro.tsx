import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, ClipboardPaste, FolderOpen, Keyboard, MousePointerClick, Pause, Trash2 } from 'lucide-react';
import { AppSettings } from '../types';
import { BrandMark, FileIcon, Segmented, Switch } from './ui';

/** Eight lanes filling at different speeds: what "split into connections" means. */
const LaneDemo: React.FC = () => {
  const lanes = [
    { d: 2.1, from: 0.05 },
    { d: 2.8, from: 0.1 },
    { d: 1.8, from: 0.0 },
    { d: 3.2, from: 0.15 },
    { d: 2.4, from: 0.08 },
    { d: 2.0, from: 0.02 },
    { d: 2.9, from: 0.12 },
    { d: 2.3, from: 0.04 },
  ];
  return (
    <div className="demo-window" aria-hidden="true">
      <div className="demo-file">
        <FileIcon category="compressed" />
        <div>
          <strong>ubuntu-24.04-desktop.iso</strong>
          <span>5.7 GB · 8 connections</span>
        </div>
        <div className="demo-speed">48.2 MB/s</div>
      </div>
      <div className="demo-lanes">
        {lanes.map((l, i) => (
          <div className="demo-lane" key={i}>
            <i style={{ ['--d' as any]: `${l.d}s`, ['--from' as any]: l.from, ['--delay' as any]: `${0.15 + i * 0.05}s` }} />
          </div>
        ))}
      </div>
      <div className="demo-caption">Each bar is one connection downloading its own part of the file.</div>
    </div>
  );
};

const KindsDemo: React.FC = () => (
  <div className="kind-grid">
    <div className="kind">
      <FileIcon category="program" />
      <div>
        <strong>Files</strong>
        <span>Installers, archives, documents, any direct link</span>
      </div>
    </div>
    <div className="kind">
      <FileIcon category="video" />
      <div>
        <strong>Video pages</strong>
        <span>YouTube, Vimeo, TikTok and more, in the quality you pick</span>
      </div>
    </div>
    <div className="kind">
      <FileIcon category="audio" />
      <div>
        <strong>Music and audio</strong>
        <span>Save just the sound of a video as MP3</span>
      </div>
    </div>
    <div className="kind">
      <FileIcon category="torrent" />
      <div>
        <strong>Torrents and magnet links</strong>
        <span>Downloaded straight from other peers</span>
      </div>
    </div>
  </div>
);

const BrowserDemo: React.FC = () => (
  <div className="browser-demo" aria-hidden="true">
    <div className="browser-bar">
      <i />
      <i />
      <i />
      <span>releases.example.org/app-setup.exe</span>
    </div>
    <div className="browser-body">
      <div className="fake-line" style={{ width: '62%' }} />
      <div className="fake-line" style={{ width: '88%' }} />
      <div className="fake-line" style={{ width: '74%' }} />
      <div className="catch-card">
        <FileIcon category="program" />
        <div>
          <strong>app-setup.exe</strong>
          <span>Sent to Quantum Downloader</span>
        </div>
        <span className="btn btn-primary btn-sm">Download</span>
      </div>
    </div>
  </div>
);

export const Intro: React.FC<{
  settings: AppSettings;
  onPreview: (patch: Partial<AppSettings>) => void;
  onFinish: (patch: Partial<AppSettings>) => void;
}> = ({ settings, onPreview, onFinish }) => {
  const api = window.quantumApi;
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(settings.downloadDir);
  const [connections, setConnections] = useState(settings.defaultConnections || 16);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(
    settings.theme === 'dark' || settings.theme === 'light' ? settings.theme : 'system'
  );
  const [clipboard, setClipboard] = useState(settings.enableClipboardMonitor);
  const [extPath, setExtPath] = useState('');
  const isMac = api?.platform === 'darwin';
  const mod = isMac ? '⌘' : 'Ctrl';

  const finish = () =>
    onFinish({ hasCompletedWelcome: true, downloadDir: dir, defaultConnections: connections, theme, enableClipboardMonitor: clipboard });

  const total = 5;
  const next = () => (step < total - 1 ? setStep(step + 1) : finish());
  const back = () => setStep(Math.max(0, step - 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT') return;
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pages: { title: string; body: React.ReactNode; visual: React.ReactNode }[] = [
    {
      title: 'Downloads that split into lanes',
      body: 'Quantum Downloader opens several connections to the same file and fills it in parallel. Big files finish sooner, and if one connection drops, only that part is fetched again.',
      visual: <LaneDemo />,
    },
    {
      title: 'Paste a link. That’s it.',
      body: 'Copy a link and paste it into the bar at the top. The app works out what it is and handles it, from a zip file to a YouTube video to a magnet link.',
      visual: <KindsDemo />,
    },
    {
      title: 'Catch downloads in your browser',
      body: 'Add the browser extension and downloads you start in Chrome, Edge, Brave, Opera or Firefox come here instead, with a quick dialog to confirm.',
      visual: (
        <div style={{ display: 'grid', gap: 16, justifyItems: 'center', width: '100%' }}>
          <BrowserDemo />
          <button className="btn" onClick={async () => setExtPath((await api?.openExtensionFolder()) || '')}>
            <FolderOpen />
            Show extension folder
          </button>
          {extPath && <span className="field-hint">Load this folder from your browser’s extensions page. Steps are in Settings, Browser.</span>}
        </div>
      ),
    },
    {
      title: 'Set it up your way',
      body: 'Choose where files go and how hard to push each download. You can change all of this later in Settings.',
      visual: (
        <div className="setup-form">
          <div className="setting-stack">
            <div className="setting-text">
              <strong>Save downloads to</strong>
            </div>
            <div className="input-row">
              <input className="input" readOnly value={dir} title={dir} aria-label="Download folder" />
              <button
                className="btn"
                onClick={async () => {
                  const p = await api?.selectDownloadFolder();
                  if (p) setDir(p);
                }}
              >
                Change
              </button>
            </div>
          </div>
          <div className="setting-stack">
            <div className="setting" style={{ border: 'none', padding: 0 }}>
              <div className="setting-text">
                <strong>Connections per download</strong>
              </div>
              <span className="value-pill">{connections}</span>
            </div>
            <input
              className="range"
              type="range"
              min={1}
              max={32}
              value={connections}
              onChange={(e) => setConnections(Number(e.target.value))}
              aria-label="Connections per download"
            />
          </div>
          <div className="setting">
            <div className="setting-text">
              <strong>Appearance</strong>
            </div>
            <Segmented
              label="Appearance"
              value={theme}
              onChange={(v) => {
                setTheme(v);
                onPreview({ theme: v });
              }}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'system', label: 'System' },
              ]}
            />
          </div>
          <div className="setting">
            <div className="setting-text">
              <strong>Offer to download copied links</strong>
            </div>
            <Switch label="Offer to download copied links" checked={clipboard} onChange={setClipboard} />
          </div>
        </div>
      ),
    },
    {
      title: 'You’re ready',
      body: 'A few shortcuts make it quicker still. Right-click any download for more options.',
      visual: (
        <ul className="ready-list">
          <li>
            <ClipboardPaste />
            Paste a link
            <span className="kbd">{mod} L</span>
          </li>
          <li>
            <Keyboard />
            Add downloads with options
            <span className="kbd">{mod} N</span>
          </li>
          <li>
            <Pause />
            Pause or resume the selected download
            <span className="kbd">Space</span>
          </li>
          <li>
            <Trash2 />
            Remove the selected download
            <span className="kbd">Delete</span>
          </li>
          <li>
            <MousePointerClick />
            Open a finished file
            <span className="kbd">Double-click</span>
          </li>
        </ul>
      ),
    },
  ];

  const page = pages[step];
  return (
    <div className="intro" role="dialog" aria-modal="true" aria-label="Introduction">
      <div className="intro-drag">
        <BrandMark />
        Quantum Downloader
      </div>
      <div className="intro-stage" key={step}>
        <div className="intro-copy">
          <span className="intro-step num">
            Step {step + 1} of {total}
          </span>
          <h1>{page.title}</h1>
          <p>{page.body}</p>
        </div>
        <div className="intro-visual">{page.visual}</div>
      </div>
      <div className="intro-foot">
        <div className="intro-dots" role="tablist" aria-label="Steps">
          {pages.map((p, i) => (
            <button key={i} aria-label={`Step ${i + 1}: ${p.title}`} aria-current={i === step ? 'step' : undefined} onClick={() => setStep(i)} />
          ))}
        </div>
        {step < total - 1 && (
          <button className="btn btn-ghost" onClick={finish}>
            Skip
          </button>
        )}
        {step > 0 && (
          <button className="btn" onClick={back}>
            <ArrowLeft />
            Back
          </button>
        )}
        <button className="btn btn-primary btn-lg" onClick={next} autoFocus>
          {step < total - 1 ? 'Next' : 'Start downloading'}
          {step < total - 1 && <ArrowRight />}
        </button>
      </div>
    </div>
  );
};
