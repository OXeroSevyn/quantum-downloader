import React from 'react';
import { DownloadTask } from '../types';

interface Props {
  tasks: DownloadTask[];
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenFile: (id: string) => void;
  onOpenFolder: (id: string) => void;
}

export const QuickSaveTable: React.FC<Props> = ({
  tasks,
  selectedTaskId,
  onSelectTask,
  onPause,
  onResume,
  onDelete,
  onOpenFile,
  onOpenFolder,
}) => {
  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '0 KB';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const formatSpeed = (bytesPerSec: number): string => {
    if (!bytesPerSec || bytesPerSec <= 0) return '—';
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  const getETA = (task: DownloadTask): string => {
    if (task.status !== 'downloading' || !task.speed || task.speed <= 0 || !task.totalBytes) return '—';
    const remaining = task.totalBytes - task.downloadedBytes;
    if (remaining <= 0) return '0s';
    const secs = Math.ceil(remaining / task.speed);
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  };

  const getPercent = (task: DownloadTask): number => {
    if (task.status === 'completed') return 100;
    if (!task.totalBytes || task.totalBytes <= 0) return 0;
    return Math.min(100, Math.round((task.downloadedBytes / task.totalBytes) * 100));
  };

  const renderFileIcon = (task: DownloadTask) => {
    const ext = task.filename.split('.').pop()?.toLowerCase();
    if (task.category === 'video' || ext === 'mp4' || ext === 'mkv') {
      return (
        <div className="tbl-icon-badge video-4k">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="3" width="20" height="18" rx="4" fill="#111827" />
            <path d="M7 3v18M17 3v18" stroke="#374151" strokeWidth="1.5" strokeDasharray="2 2" />
            <text x="12" y="14" fill="#fbbf24" fontSize="7" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">
              4K
            </text>
          </svg>
        </div>
      );
    }

    if (task.category === 'compressed' || ext === 'zip' || ext === 'rar' || ext === '7z') {
      return (
        <div className="tbl-icon-badge zip-box">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="4" width="18" height="16" rx="3" fill="#8b5cf6" />
            <path d="M3 10h18M10 4v16" stroke="#fbbf24" strokeWidth="2.5" />
            <rect x="8.5" y="8.5" width="3" height="3" fill="#f59e0b" />
          </svg>
        </div>
      );
    }

    // Default file icon
    return (
      <div className="tbl-icon-badge generic">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M4 4v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6H6a2 2 0 00-2 2z" fill="#3b82f6" />
          <path d="M14 2v6h6" fill="#60a5fa" />
        </svg>
      </div>
    );
  };

  const formatStatus = (status: string) => {
    switch (status) {
      case 'completed': return 'Completed';
      case 'downloading': return 'Downloading';
      case 'paused': return 'Paused';
      case 'error': return 'Failed';
      case 'queued': return 'Queued';
      default: return status;
    }
  };

  // Provide empty placeholder rows if few tasks to maintain full grid look as in screenshot
  const emptyRowsCount = Math.max(0, 7 - tasks.length);

  return (
    <div className="quantum-table-card">
      <div className="quantum-table-scroll">
        <table className="quantum-table">
          <thead>
            <tr>
              <th className="col-idx">#</th>
              <th className="col-name">File Name</th>
              <th className="col-size">Size</th>
              <th className="col-status">Status</th>
              <th className="col-progress">Progress</th>
              <th className="col-speed">Speed</th>
              <th className="col-eta">ETA</th>
              <th className="col-lasttry">Last Try...</th>
              <th className="col-desc">Description</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task, index) => {
              const isSelected = task.id === selectedTaskId;
              const percent = getPercent(task);

              return (
                <tr
                  key={task.id}
                  className={`tbl-row ${isSelected ? 'row-selected' : ''}`}
                  onClick={() => onSelectTask(task.id)}
                  onDoubleClick={() => onOpenFile(task.id)}
                >
                  <td className="col-idx cell-muted">{index + 1}</td>
                  <td className="col-name">
                    <div className="cell-filename-wrap">
                      {renderFileIcon(task)}
                      <span className="cell-filename-text" title={task.filename}>
                        {task.filename}
                      </span>
                    </div>
                  </td>
                  <td className="col-size">{formatBytes(task.totalBytes)}</td>
                  <td className="col-status">
                    <span className={`status-text ${task.status}`}>{formatStatus(task.status)}</span>
                  </td>
                  <td className="col-progress">
                    <div className="tbl-progress-wrap">
                      <div className="tbl-progress-track">
                        <div
                          className="tbl-progress-bar"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <span className="tbl-progress-percent">{percent}%</span>
                    </div>
                  </td>
                  <td className="col-speed">{formatSpeed(task.speed)}</td>
                  <td className="col-eta">{getETA(task)}</td>
                  <td className="col-lasttry">{task.lastTry || 'Oct 27 17:20'}</td>
                  <td className="col-desc cell-muted">
                    {task.description || (task.category === 'video' ? 'YouTube Video' : 'File Download')}
                  </td>
                </tr>
              );
            })}

            {/* Empty grid lines */}
            {Array.from({ length: emptyRowsCount }).map((_, i) => (
              <tr key={`empty-${i}`} className="tbl-row-empty">
                <td className="col-idx">&nbsp;</td>
                <td className="col-name">&nbsp;</td>
                <td className="col-size">&nbsp;</td>
                <td className="col-status">&nbsp;</td>
                <td className="col-progress">&nbsp;</td>
                <td className="col-speed">&nbsp;</td>
                <td className="col-eta">&nbsp;</td>
                <td className="col-lasttry">&nbsp;</td>
                <td className="col-desc">&nbsp;</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
