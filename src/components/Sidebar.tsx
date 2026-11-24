import React from 'react';
import {
  AlertTriangle,
  AppWindow,
  Archive,
  ArrowDownToLine,
  CheckCheck,
  Clock3,
  File,
  FileText,
  Film,
  Image,
  Inbox,
  Magnet,
  Music,
  Pause,
} from 'lucide-react';
import { DownloadCategory, DownloadTask } from '../types';
import { CATEGORY_LABEL } from '../lib/format';

export type ViewKey =
  | { type: 'status'; value: 'all' | 'active' | 'queued' | 'paused' | 'completed' | 'error' }
  | { type: 'category'; value: DownloadCategory };

export const VIEW_TITLE = (v: ViewKey): string => {
  if (v.type === 'category') return CATEGORY_LABEL[v.value];
  return {
    all: 'All downloads',
    active: 'Downloading',
    queued: 'Waiting',
    paused: 'Paused',
    completed: 'Finished',
    error: 'Failed',
  }[v.value];
};

export function matchesView(t: DownloadTask, v: ViewKey): boolean {
  if (v.type === 'category') return t.category === v.value;
  switch (v.value) {
    case 'all':
      return true;
    case 'active':
      return t.status === 'downloading';
    case 'queued':
      return t.status === 'queued';
    case 'paused':
      return t.status === 'paused';
    case 'completed':
      return t.status === 'completed';
    case 'error':
      return t.status === 'error';
  }
}

const STATUS_ITEMS: { value: Extract<ViewKey, { type: 'status' }>['value']; icon: React.FC<any> }[] = [
  { value: 'all', icon: Inbox },
  { value: 'active', icon: ArrowDownToLine },
  { value: 'queued', icon: Clock3 },
  { value: 'paused', icon: Pause },
  { value: 'completed', icon: CheckCheck },
  { value: 'error', icon: AlertTriangle },
];

const CAT_ITEMS: { value: DownloadCategory; icon: React.FC<any> }[] = [
  { value: 'video', icon: Film },
  { value: 'audio', icon: Music },
  { value: 'compressed', icon: Archive },
  { value: 'document', icon: FileText },
  { value: 'program', icon: AppWindow },
  { value: 'image', icon: Image },
  { value: 'torrent', icon: Magnet },
  { value: 'other', icon: File },
];

export const Sidebar: React.FC<{
  tasks: DownloadTask[];
  view: ViewKey;
  onChange: (v: ViewKey) => void;
  downloadDir: string;
  onOpenDir: () => void;
}> = ({ tasks, view, onChange, downloadDir, onOpenDir }) => {
  const count = (v: ViewKey) => tasks.filter((t) => matchesView(t, v)).length;
  const isCurrent = (v: ViewKey) => v.type === view.type && v.value === view.value;

  return (
    <nav className="sidebar" aria-label="Filters">
      <div className="nav-group">
        {STATUS_ITEMS.map(({ value, icon: Icon }) => {
          const v: ViewKey = { type: 'status', value };
          const n = count(v);
          if (value !== 'all' && value !== 'active' && value !== 'completed' && n === 0 && !isCurrent(v)) return null;
          return (
            <button key={value} className="nav-item" aria-current={isCurrent(v)} onClick={() => onChange(v)}>
              <Icon />
              {VIEW_TITLE(v)}
              <span className="nav-count">{n || ''}</span>
            </button>
          );
        })}
      </div>

      {tasks.length > 0 && (
        <div className="nav-group">
          <div className="nav-title">Types</div>
          {CAT_ITEMS.map(({ value, icon: Icon }) => {
            const v: ViewKey = { type: 'category', value };
            const n = count(v);
            if (!n && !isCurrent(v)) return null;
            return (
              <button key={value} className="nav-item" aria-current={isCurrent(v)} onClick={() => onChange(v)}>
                <Icon />
                {CATEGORY_LABEL[value]}
                <span className="nav-count">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="sidebar-foot">
        <button className="folder-link" onClick={onOpenDir} title={`Open ${downloadDir}`}>
          <span>Saving to</span>
          <strong>{shortPath(downloadDir)}</strong>
        </button>
      </div>
    </nav>
  );
};

function shortPath(p: string): string {
  if (!p) return '…';
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…${sep}${parts.slice(-2).join(sep)}` : p;
}
