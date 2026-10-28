import React from 'react';
import { CheckCircle2, Film, Music, Image, FileText, Archive, Terminal } from 'lucide-react';
import { DownloadTask } from '../types';

interface Props {
  tasks: DownloadTask[];
  selectedCategory: string;
  onSelectCategory: (cat: string) => void;
}

export const CategoryPillsBar: React.FC<Props> = ({
  tasks,
  selectedCategory,
  onSelectCategory,
}) => {
  const getCount = (cat: string) => {
    if (cat === 'all') return tasks.length;
    return tasks.filter(t => t.category === cat).length;
  };

  const pills = [
    { id: 'all', label: 'All', icon: CheckCircle2, color: '#76e026', isMain: true },
    { id: 'video', label: 'Video', icon: Film, color: '#ef4444' },
    { id: 'audio', label: 'Audio', icon: Music, color: '#3b82f6' },
    { id: 'image', label: 'Images', icon: Image, color: '#10b981' },
    { id: 'document', label: 'Documents', icon: FileText, color: '#8b5cf6' },
    { id: 'compressed', label: 'Archives', icon: Archive, color: '#f59e0b' },
    { id: 'program', label: 'Programs', icon: Terminal, color: '#06b6d4' },
  ];

  return (
    <div className="category-pills-bar">
      {pills.map((p) => {
        const Icon = p.icon;
        const count = getCount(p.id);
        const isActive = selectedCategory === p.id;

        return (
          <button
            key={p.id}
            className={`category-pill-btn ${isActive ? 'active' : ''} ${p.isMain && isActive ? 'active-main' : ''}`}
            onClick={() => onSelectCategory(p.id)}
          >
            <span
              className="pill-icon-bubble"
              style={{ backgroundColor: p.color, color: p.isMain && isActive ? '#0d1117' : '#ffffff' }}
            >
              <Icon size={12} strokeWidth={2.5} />
            </span>
            <span className="pill-label">{p.label}</span>
            <span className="pill-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
};
