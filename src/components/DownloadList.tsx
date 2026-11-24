import React, { useState } from 'react';
import {
  Copy,
  ExternalLink,
  FolderOpen,
  MoreHorizontal,
  Pause,
  Play,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { DownloadTask } from '../types';
import { eta, formatBytes, formatDuration, formatSpeed, progress } from '../lib/format';
import { ContextMenu, FileIcon, Lanes, MenuItem, StatusText } from './ui';

export interface TaskActions {
  pause: (id: string) => void;
  resume: (id: string) => void;
  restart: (id: string) => void;
  remove: (task: DownloadTask) => void;
  openFile: (id: string) => void;
  openFolder: (id: string) => void;
  copyLink: (task: DownloadTask) => void;
}

export function menuFor(task: DownloadTask, a: TaskActions): MenuItem[] {
  const items: MenuItem[] = [];
  if (task.status === 'completed') {
    items.push({ label: 'Open', icon: ExternalLink, onSelect: () => a.openFile(task.id) });
  }
  if (task.status === 'downloading' || task.status === 'queued') {
    items.push({ label: 'Pause', icon: Pause, onSelect: () => a.pause(task.id) });
  }
  if (task.status === 'paused' || task.status === 'error') {
    items.push({ label: task.status === 'error' ? 'Try again' : 'Resume', icon: Play, onSelect: () => a.resume(task.id) });
  }
  items.push({ label: 'Show in folder', icon: FolderOpen, onSelect: () => a.openFolder(task.id) });
  items.push({ label: 'Copy link', icon: Copy, onSelect: () => a.copyLink(task) });
  items.push({ label: 'Download again from start', icon: RotateCcw, onSelect: () => a.restart(task.id), separatorBefore: true });
  items.push({ label: 'Remove…', icon: Trash2, onSelect: () => a.remove(task), danger: true });
  return items;
}

const Row: React.FC<{
  task: DownloadTask;
  selected: boolean;
  onSelect: () => void;
  actions: TaskActions;
  onMenu: (x: number, y: number) => void;
}> = ({ task, selected, onSelect, actions, onMenu }) => {
  const pct = Math.round(progress(task) * 100);
  const active = task.status === 'downloading';
  const canResume = task.status === 'paused' || task.status === 'error';
  const remaining = eta(task);

  let sub: React.ReactNode;
  if (task.status === 'error') {
    sub = <span className="err">{task.errorMessage || 'Download failed'}</span>;
  } else if (task.status === 'completed') {
    sub = <span>{formatBytes(task.totalBytes)}</span>;
  } else if (task.totalBytes) {
    sub = (
      <span className="num">
        {pct}% · {formatBytes(task.downloadedBytes)} of {formatBytes(task.totalBytes)}
      </span>
    );
  } else if (active) {
    sub = <span>{task.isTorrent ? 'Finding peers…' : 'Connecting…'}</span>;
  } else {
    sub = <span>{task.downloadedBytes ? formatBytes(task.downloadedBytes) : 'Not started'}</span>;
  }

  return (
    <div
      className="row"
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-id={task.id}
      onClick={onSelect}
      onDoubleClick={() => (task.status === 'completed' ? actions.openFile(task.id) : canResume ? actions.resume(task.id) : undefined)}
      onContextMenu={(e) => {
        e.preventDefault();
        onSelect();
        onMenu(e.clientX, e.clientY);
      }}
    >
      <FileIcon category={task.category} />
      <div className="row-main">
        <div className="row-title">
          <span className="row-name" title={task.filename}>
            {task.filename}
          </span>
        </div>
        {task.status !== 'completed' && <Lanes task={task} max={24} />}
        <div className="row-sub">
          <StatusText status={task.status} />
          {sub}
        </div>
      </div>
      <div className="row-size">{task.totalBytes ? formatBytes(task.totalBytes) : '–'}</div>
      <div className="row-rate">
        {active ? (
          <>
            {formatSpeed(task.speed)}
            <small>{remaining ? `${formatDuration(remaining)} left` : task.isTorrent ? `${task.torrentPeers || 0} peers` : ' '}</small>
          </>
        ) : task.status === 'completed' ? (
          <small>{task.completedAt ? new Date(task.completedAt).toLocaleDateString([], { day: 'numeric', month: 'short' }) : ''}</small>
        ) : (
          '–'
        )}
      </div>
      <div className="row-actions" onClick={(e) => e.stopPropagation()}>
        {active || task.status === 'queued' ? (
          <button className="icon-btn" aria-label="Pause" title="Pause" onClick={() => actions.pause(task.id)}>
            <Pause />
          </button>
        ) : canResume ? (
          <button
            className="icon-btn"
            aria-label={task.status === 'error' ? 'Try again' : 'Resume'}
            title={task.status === 'error' ? 'Try again' : 'Resume'}
            onClick={() => actions.resume(task.id)}
          >
            {task.status === 'error' ? <RotateCcw /> : <Play />}
          </button>
        ) : (
          <button className="icon-btn" aria-label="Open" title="Open" onClick={() => actions.openFile(task.id)}>
            <ExternalLink />
          </button>
        )}
        <button
          className="icon-btn"
          aria-label="More actions"
          title="More"
          onClick={(e) => {
            onSelect();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onMenu(r.right - 190, r.bottom + 4);
          }}
        >
          <MoreHorizontal />
        </button>
      </div>
    </div>
  );
};

export const DownloadList: React.FC<{
  title: string;
  tasks: DownloadTask[];
  totalCount: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  actions: TaskActions;
  search: string;
  onSearch: (q: string) => void;
  headerActions: React.ReactNode;
  emptyState: React.ReactNode;
}> = ({ title, tasks, totalCount, selectedId, onSelect, actions, search, onSearch, headerActions, emptyState }) => {
  const [menu, setMenu] = useState<{ x: number; y: number; task: DownloadTask } | null>(null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!tasks.length) return;
    const i = tasks.findIndex((t) => t.id === selectedId);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = e.key === 'ArrowDown' ? Math.min(tasks.length - 1, i + 1) : Math.max(0, i - 1);
      onSelect(tasks[n].id);
      requestAnimationFrame(() => {
        (document.querySelector(`.row[data-id="${tasks[n].id}"]`) as HTMLElement | null)?.focus();
      });
    }
  };

  return (
    <section className="list-pane" aria-label={title}>
      <header className="list-head">
        <h1>
          {title}
          <span className="count num">{tasks.length !== totalCount ? `${tasks.length} of ${totalCount}` : tasks.length || ''}</span>
        </h1>
        <div className="list-actions">
          {headerActions}
          <div className="search">
            <Search />
            <input
              className="input"
              type="search"
              placeholder="Search"
              aria-label="Search downloads"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
        </div>
      </header>
      <div className="list" role="listbox" aria-label="Downloads" onKeyDown={onKeyDown}>
        {tasks.length === 0
          ? emptyState
          : tasks.map((t) => (
              <Row
                key={t.id}
                task={t}
                selected={t.id === selectedId}
                onSelect={() => onSelect(t.id)}
                actions={actions}
                onMenu={(x, y) => setMenu({ x, y, task: t })}
              />
            ))}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuFor(menu.task, actions)} onClose={() => setMenu(null)} />}
    </section>
  );
};
