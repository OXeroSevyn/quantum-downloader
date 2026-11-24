import React, { useState } from 'react';
import { Copy, ExternalLink, FolderOpen, Pause, Play, RotateCcw, Trash2 } from 'lucide-react';
import { DownloadTask } from '../types';
import { eta, formatBytes, formatDuration, formatSpeed, progress, STATUS_LABEL } from '../lib/format';
import { Lanes, StatusText } from './ui';
import { TaskActions } from './DownloadList';

function kindLabel(t: DownloadTask): string {
  if (t.isTorrent) return 'Torrent';
  if (t.isVideoStream) return 'Video page';
  if (t.isHls) return 'Stream playlist';
  return t.resumable ? 'File, resumable' : 'File, can’t resume';
}

export const DetailPanel: React.FC<{ task: DownloadTask | null; actions: TaskActions }> = ({ task, actions }) => {
  const [thumbOk, setThumbOk] = useState(true);
  if (!task) {
    return (
      <aside className="detail" aria-label="Details">
        <div className="empty-detail">Select a download to see its connections and details.</div>
      </aside>
    );
  }
  const pct = progress(task);
  const active = task.status === 'downloading';
  const remaining = eta(task);
  const lanesCount = task.segments.length;
  const activeLanes = task.segments.filter((s) => s.status === 'downloading').length;

  return (
    <aside className="detail" aria-label="Details">
      <div className="detail-head">
        {task.thumbnailUrl && thumbOk && (
          <img className="detail-thumb" src={task.thumbnailUrl} alt="" onError={() => setThumbOk(false)} />
        )}
        <h2 className="detail-name">{task.filename}</h2>
        <div className="detail-url" title={task.url}>
          {task.url}
        </div>
        <div className="detail-progress">
          <span className="detail-pct">{task.totalBytes || task.status === 'completed' ? `${Math.floor(pct * 100)}%` : '–'}</span>
          <StatusText status={task.status} />
        </div>
        {task.status === 'error' && task.errorMessage && <div className="error-box">{task.errorMessage}</div>}
        <div className="detail-actions">
          {task.status === 'completed' && (
            <button className="btn btn-primary btn-sm" onClick={() => actions.openFile(task.id)}>
              <ExternalLink />
              Open
            </button>
          )}
          {(active || task.status === 'queued') && (
            <button className="btn btn-sm" onClick={() => actions.pause(task.id)}>
              <Pause />
              Pause
            </button>
          )}
          {(task.status === 'paused' || task.status === 'error') && (
            <button className="btn btn-primary btn-sm" onClick={() => actions.resume(task.id)}>
              {task.status === 'error' ? <RotateCcw /> : <Play />}
              {task.status === 'error' ? 'Try again' : 'Resume'}
            </button>
          )}
          <button className="btn btn-sm" onClick={() => actions.openFolder(task.id)}>
            <FolderOpen />
            Show in folder
          </button>
          <button className="icon-btn" title="Copy link" aria-label="Copy link" onClick={() => actions.copyLink(task)}>
            <Copy />
          </button>
          <button className="icon-btn danger" title="Remove" aria-label="Remove" onClick={() => actions.remove(task)}>
            <Trash2 />
          </button>
        </div>
      </div>

      {lanesCount > 0 && (
        <div className="detail-section">
          <h3>
            Connections
            <span className="num">
              {active ? `${activeLanes} active of ${lanesCount}` : `${lanesCount} ${lanesCount === 1 ? 'part' : 'parts'}`}
            </span>
          </h3>
          <Lanes task={task} max={32} big />
        </div>
      )}

      <div className="detail-section">
        <dl className="facts">
          <dt>Status</dt>
          <dd>{STATUS_LABEL[task.status]}</dd>
          <dt>Size</dt>
          <dd>{task.totalBytes ? formatBytes(task.totalBytes, 2) : 'Unknown yet'}</dd>
          {task.status !== 'completed' && (
            <>
              <dt>Downloaded</dt>
              <dd>{formatBytes(task.downloadedBytes, 2)}</dd>
            </>
          )}
          {active && (
            <>
              <dt>Speed</dt>
              <dd>{formatSpeed(task.speed)}</dd>
              <dt>Time left</dt>
              <dd>{remaining ? formatDuration(remaining) : '–'}</dd>
            </>
          )}
          {task.isTorrent && (
            <>
              <dt>Peers</dt>
              <dd>{task.torrentPeers ?? 0}</dd>
            </>
          )}
          {task.isHls && task.hlsCount ? (
            <>
              <dt>Stream parts</dt>
              <dd>
                {task.hlsIndex || 0} of {task.hlsCount}
              </dd>
            </>
          ) : null}
          <dt>Type</dt>
          <dd>{kindLabel(task)}</dd>
          <dt>Added</dt>
          <dd>{new Date(task.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</dd>
          {task.completedAt && (
            <>
              <dt>Finished</dt>
              <dd>{new Date(task.completedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</dd>
            </>
          )}
          <dt>Saved to</dt>
          <dd className="selectable" title={task.filepath}>
            {task.filepath}
          </dd>
        </dl>
      </div>

      {task.logs && task.logs.length > 0 && (
        <div className="detail-section">
          <h3>Activity</h3>
          <pre className="log">{task.logs.slice(-30).join('\n')}</pre>
        </div>
      )}
    </aside>
  );
};

export const StatusBar: React.FC<{
  tasks: DownloadTask[];
  speedLimitKBps: number;
  onOpenSpeed: () => void;
  bridgePort: number;
  bridgeOnline: boolean | null;
}> = ({ tasks, speedLimitKBps, onOpenSpeed, bridgePort, bridgeOnline }) => {
  const active = tasks.filter((t) => t.status === 'downloading');
  const queued = tasks.filter((t) => t.status === 'queued').length;
  const speed = active.reduce((a, t) => a + (t.speed || 0), 0);
  const remainingBytes = active.reduce((a, t) => a + Math.max(0, (t.totalBytes || 0) - t.downloadedBytes), 0);
  return (
    <footer className="statusbar">
      <span>
        <strong>{speed ? formatSpeed(speed) : 'Idle'}</strong>
      </span>
      <span>
        {active.length} downloading{queued ? `, ${queued} waiting` : ''}
      </span>
      {speed > 0 && remainingBytes > 0 && <span>{formatDuration(remainingBytes / speed)} left in total</span>}
      <span className="spacer" />
      <button onClick={onOpenSpeed} title="Change speed limit">
        Speed limit: {speedLimitKBps ? `${speedLimitKBps >= 1024 ? `${(speedLimitKBps / 1024).toFixed(1)} MB/s` : `${speedLimitKBps} KB/s`}` : 'off'}
      </button>
      {bridgeOnline !== null && (
        <span
          title={
            bridgeOnline
              ? `Browser extension bridge on port ${bridgePort}`
              : `Port ${bridgePort} is used by another program (perhaps another copy of this app), so the browser extension can't connect.`
          }
        >
          <span className="dot-online" style={bridgeOnline ? undefined : { background: 'var(--warn)' }} />
          {bridgeOnline ? 'Browser bridge ready' : 'Browser bridge off'}
        </span>
      )}
    </footer>
  );
};
