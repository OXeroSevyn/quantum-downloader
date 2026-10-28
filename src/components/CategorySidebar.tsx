import React from 'react';
import {
  Download,
  Video,
  Music,
  Archive,
  FolderArchive,
  FileText,
  Play,
  Pause,
  CheckCircle2,
  AlertTriangle,
  Layers,
} from 'lucide-react';
import { DownloadCategory, DownloadStatus, DownloadTask } from '../types';

interface Props {
  tasks: DownloadTask[];
  selectedCategory: string;
  selectedStatus: string;
  onSelectCategory: (cat: string) => void;
  onSelectStatus: (status: string) => void;
}

export const CategorySidebar: React.FC<Props> = ({
  tasks,
  selectedCategory,
  selectedStatus,
  onSelectCategory,
  onSelectStatus,
}) => {
  const getCategoryCount = (cat: string): number => {
    if (cat === 'all') return tasks.length;
    return tasks.filter(t => t.category === cat).length;
  };

  const getStatusCount = (st: string): number => {
    if (st === 'all') return tasks.length;
    return tasks.filter(t => t.status === st).length;
  };

  const categories = [
    { id: 'all', label: 'All Downloads', icon: Layers },
    { id: 'video', label: 'Videos & Streams', icon: Video },
    { id: 'audio', label: 'Audio & Music', icon: Music },
    { id: 'compressed', label: 'Compressed', icon: Archive },
    { id: 'program', label: 'Programs', icon: FolderArchive },
    { id: 'document', label: 'Documents', icon: FileText },
  ];

  const statuses = [
    { id: 'all', label: 'All Statuses', icon: Download },
    { id: 'downloading', label: 'Downloading', icon: Play },
    { id: 'paused', label: 'Paused', icon: Pause },
    { id: 'completed', label: 'Completed', icon: CheckCircle2 },
    { id: 'error', label: 'Errors', icon: AlertTriangle },
  ];

  const totalBytes = tasks.reduce((sum, t) => sum + (t.downloadedBytes || 0), 0);
  const formatTotalSize = (bytes: number): string => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <aside className="sidebar">
      <div>
        <div className="sidebar-section-title">Categories</div>
        <nav className="sidebar-nav">
          {categories.map((c) => {
            const Icon = c.icon;
            const count = getCategoryCount(c.id);
            const isActive = selectedCategory === c.id;
            return (
              <div
                key={c.id}
                className={`sidebar-item ${isActive ? 'active' : ''}`}
                onClick={() => onSelectCategory(c.id)}
              >
                <div className="sidebar-item-left">
                  <Icon size={16} />
                  <span>{c.label}</span>
                </div>
                <span className="sidebar-badge">{count}</span>
              </div>
            );
          })}
        </nav>

        <div className="sidebar-section-title" style={{ marginTop: '24px' }}>
          Status
        </div>
        <nav className="sidebar-nav">
          {statuses.map((s) => {
            const Icon = s.icon;
            const count = getStatusCount(s.id);
            const isActive = selectedStatus === s.id;
            return (
              <div
                key={s.id}
                className={`sidebar-item ${isActive ? 'active' : ''}`}
                onClick={() => onSelectStatus(s.id)}
              >
                <div className="sidebar-item-left">
                  <Icon size={16} />
                  <span>{s.label}</span>
                </div>
                <span className="sidebar-badge">{count}</span>
              </div>
            );
          })}
        </nav>
      </div>

      <div style={{
        padding: '12px',
        background: 'rgba(0,0,0,0.3)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        fontSize: '0.8rem',
        color: 'var(--text-muted)'
      }}>
        <div>Total Transfer:</div>
        <div style={{
          color: 'var(--primary)',
          fontSize: '1rem',
          fontWeight: 700,
          fontFamily: 'var(--font-mono)',
          marginTop: '4px'
        }}>
          {formatTotalSize(totalBytes)}
        </div>
      </div>
    </aside>
  );
};
