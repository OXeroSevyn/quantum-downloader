import React, { useState } from 'react';
import {
  Video,
  Music,
  Archive,
  FolderArchive,
  FileText,
  Play,
  Pause,
  FolderOpen,
  ExternalLink,
  Trash2,
  ChevronDown,
  ChevronUp,
  FileQuestion,
  Radio,
} from 'lucide-react';
import { DownloadTask } from '../types';
import { SegmentVisualizer } from './SegmentVisualizer';

interface Props {
  task: DownloadTask;
  isSelected: boolean;
  onSelect: () => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenFile: (id: string) => void;
  onOpenFolder: (id: string) => void;
}

export const DownloadItem: React.FC<Props> = ({
  task,
  isSelected,
  onSelect,
  onPause,
  onResume,
  onDelete,
  onOpenFile,
  onOpenFolder,
}) => {
  const [showSegments, setShowSegments] = useState(false);

  const getCategoryIcon = () => {
    if (task.isHls) return <Radio size={18} />;
    switch (task.category) {
      case 'video': return <Video size={18} />;
      case 'audio': return <Music size={18} />;
      case 'compressed': return <Archive size={18} />;
      case 'program': return <FolderArchive size={18} />;
      case 'document': return <FileText size={18} />;
      default: return <FileQuestion size={18} />;
    }
  };

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatSpeed = (bytesPerSec: number): string => {
    if (!bytesPerSec || bytesPerSec <= 0) return '0 KB/s';
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
  };

  const getETA = (): string => {
    if (task.status !== 'downloading' || !task.speed || task.speed <= 0 || !task.totalBytes) return '--:--';
    const remainingBytes = task.totalBytes - task.downloadedBytes;
    if (remainingBytes <= 0) return '0s';
    const secs = Math.ceil(remainingBytes / task.speed);
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  };

  const percent = task.totalBytes > 0
    ? Math.min(100, Math.round((task.downloadedBytes / task.totalBytes) * 100))
    : task.status === 'completed' ? 100 : 0;

  return (
    <div className={`task-card ${isSelected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="task-header">
        <div className="task-title-area">
          <div className="category-icon-box">
            {getCategoryIcon()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="task-filename" title={task.filename}>
              {task.filename}
            </div>
            <div className="task-meta">
              <span>{formatBytes(task.downloadedBytes)} / {task.totalBytes ? formatBytes(task.totalBytes) : 'Unknown'}</span>
              <span>•</span>
              <span style={{ color: task.status === 'downloading' ? 'var(--primary)' : 'inherit' }}>
                {task.status === 'downloading' ? formatSpeed(task.speed) : task.status.toUpperCase()}
              </span>
              <span>•</span>
              <span>ETA: {getETA()}</span>
              {task.isHls && (
                <>
                  <span>•</span>
                  <span style={{ color: 'var(--accent)' }}>HLS STREAM</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="task-actions" onClick={e => e.stopPropagation()}>
          {task.status === 'downloading' ? (
            <button
              className="btn-icon"
              onClick={() => onPause(task.id)}
              title="Pause Download"
            >
              <Pause size={16} />
            </button>
          ) : task.status === 'paused' || task.status === 'error' ? (
            <button
              className="btn-icon"
              onClick={() => onResume(task.id)}
              title="Resume Download"
            >
              <Play size={16} />
            </button>
          ) : null}

          {task.status === 'completed' && (
            <button
              className="btn-icon"
              onClick={() => onOpenFile(task.id)}
              title="Open File"
            >
              <ExternalLink size={16} />
            </button>
          )}

          <button
            className="btn-icon"
            onClick={() => onOpenFolder(task.id)}
            title="Open Containing Folder"
          >
            <FolderOpen size={16} />
          </button>

          <button
            className="btn-icon"
            onClick={() => onDelete(task.id)}
            title="Delete Download"
          >
            <Trash2 size={16} />
          </button>

          <button
            className="btn-icon"
            onClick={() => setShowSegments(!showSegments)}
            title="Toggle Thread Visualizer"
          >
            {showSegments ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* Main Progress Bar */}
      <div className="progress-bar-container">
        <div
          className="progress-bar-fill"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Dynamic Segment Visualizer Drawer */}
      {(showSegments || task.status === 'downloading') && (
        <SegmentVisualizer task={task} />
      )}
    </div>
  );
};
