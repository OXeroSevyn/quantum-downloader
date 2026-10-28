import React from 'react';
import { Zap, BarChart2, Clock, Globe } from 'lucide-react';
import { DownloadTask } from '../types';

interface Props {
  tasks: DownloadTask[];
}

export const BottomStatusBar: React.FC<Props> = ({ tasks }) => {
  const downloading = tasks.filter(t => t.status === 'downloading');
  const completed = tasks.filter(t => t.status === 'completed');

  const totalDownSpeed = downloading.reduce((sum, t) => sum + (t.speed || 0), 0);

  const formatSpeed = (bytesPerSec: number): string => {
    if (bytesPerSec <= 0) return '0 KB/s';
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
  };

  const getTimeLeft = (): string => {
    if (downloading.length === 0 || totalDownSpeed <= 0) return '—';
    const remainingBytes = downloading.reduce(
      (sum, t) => sum + Math.max(0, (t.totalBytes || 0) - (t.downloadedBytes || 0)),
      0
    );
    if (remainingBytes <= 0) return '—';
    const secs = Math.ceil(remainingBytes / totalDownSpeed);
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  };

  const activeConnections = downloading.length > 0 ? downloading.length * 16 : 16;

  return (
    <footer className="quantum-bottom-statusbar">
      <div className="statusbar-left">
        {/* Speed */}
        <div className="statusbar-stat">
          <Zap size={15} color="#22c55e" fill="#22c55e" />
          <span className="stat-bold">{formatSpeed(totalDownSpeed)}</span>
          <span className="stat-label">Current Speed</span>
        </div>

        <div className="statusbar-divider" />

        {/* Completed */}
        <div className="statusbar-stat">
          <BarChart2 size={15} color="#22c55e" />
          <span className="stat-bold">{completed.length}/{tasks.length}</span>
          <span className="stat-label">Completed</span>
        </div>

        <div className="statusbar-divider" />

        {/* Time Left */}
        <div className="statusbar-stat">
          <Clock size={15} color="#2563eb" />
          <span className="stat-bold">{getTimeLeft()}</span>
          <span className="stat-label">Time Left</span>
        </div>
      </div>

      <div className="statusbar-right">
        {/* Connections */}
        <div className="statusbar-stat">
          <Globe size={15} color="#2563eb" />
          <span className="stat-bold">{activeConnections}</span>
          <span className="stat-label">Active Connections</span>
        </div>
      </div>
    </footer>
  );
};
