import React from 'react';
import { DownloadTask } from '../types';

interface Props {
  task: DownloadTask;
}

export const SegmentVisualizer: React.FC<Props> = ({ task }) => {
  if (!task.segments || task.segments.length === 0) {
    return null;
  }

  const activeThreads = task.segments.filter(s => s.status === 'downloading').length;

  return (
    <div className="segment-visualizer">
      <div className="segment-visualizer-header">
        <span>Dynamic Multi-Thread Segmentation ({task.segments.length} Threads)</span>
        <span>
          {task.status === 'downloading' ? (
            <span style={{ color: 'var(--primary)' }}>
              ⚡ {activeThreads} Active Connections
            </span>
          ) : (
            <span>Status: {task.status.toUpperCase()}</span>
          )}
        </span>
      </div>

      <div className="segment-grid">
        {task.segments.map((seg, idx) => {
          const pct = seg.total > 0 ? Math.min(100, Math.round((seg.downloaded / seg.total) * 100)) : 0;
          return (
            <div
              key={idx}
              className={`segment-block ${seg.status}`}
              title={`Thread #${idx + 1}: ${pct}% (${(seg.downloaded / 1024 / 1024).toFixed(2)} MB)`}
            >
              <div
                className="segment-block-fill"
                style={{ width: `${pct}%` }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
