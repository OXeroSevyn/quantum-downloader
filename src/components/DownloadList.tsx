import React, { useState } from 'react';
import { Search, DownloadCloud } from 'lucide-react';
import { DownloadTask } from '../types';
import { DownloadItem } from './DownloadItem';

interface Props {
  tasks: DownloadTask[];
  selectedCategory: string;
  selectedStatus: string;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenFile: (id: string) => void;
  onOpenFolder: (id: string) => void;
  onOpenNewModal: () => void;
}

export const DownloadList: React.FC<Props> = ({
  tasks,
  selectedCategory,
  selectedStatus,
  onPause,
  onResume,
  onDelete,
  onOpenFile,
  onOpenFolder,
  onOpenNewModal,
}) => {
  const [search, setSearch] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const filteredTasks = tasks.filter((t) => {
    const matchesCat = selectedCategory === 'all' || t.category === selectedCategory;
    const matchesStatus = selectedStatus === 'all' || t.status === selectedStatus;
    const matchesSearch = !search || t.filename.toLowerCase().includes(search.toLowerCase()) || t.url.toLowerCase().includes(search.toLowerCase());
    return matchesCat && matchesStatus && matchesSearch;
  });

  return (
    <div className="content-area">
      {/* Top filter toolbar */}
      <div className="toolbar">
        <div className="search-input-wrapper">
          <Search size={16} />
          <input
            type="text"
            className="search-input"
            placeholder="Search downloads or URLs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Showing {filteredTasks.length} of {tasks.length} items
        </div>
      </div>

      {/* Main Task List */}
      <div className="task-list-container">
        {filteredTasks.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <DownloadCloud size={32} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.1rem', marginBottom: '4px' }}>No downloads found</h3>
              <p style={{ fontSize: '0.85rem' }}>
                {search ? 'No downloads match your search.' : 'Paste a URL or capture videos using the browser extension.'}
              </p>
            </div>
            <button className="btn btn-primary" onClick={onOpenNewModal}>
              Start a Download
            </button>
          </div>
        ) : (
          filteredTasks.map((task) => (
            <DownloadItem
              key={task.id}
              task={task}
              isSelected={selectedTaskId === task.id}
              onSelect={() => setSelectedTaskId(task.id)}
              onPause={onPause}
              onResume={onResume}
              onDelete={onDelete}
              onOpenFile={onOpenFile}
              onOpenFolder={onOpenFolder}
            />
          ))
        )}
      </div>
    </div>
  );
};
