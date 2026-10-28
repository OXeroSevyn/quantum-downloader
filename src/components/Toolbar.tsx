import React from 'react';
import {
  Plus,
  Play,
  Pause,
  Square,
  Trash2,
  FolderX,
  Clock,
  Globe,
  Settings,
  Search,
  Menu,
  ChevronDown,
} from 'lucide-react';

interface Props {
  onAddUrl: () => void;
  onResume: () => void;
  onPause: () => void;
  onStop: () => void;
  onDelete: () => void;
  onDeleteCompleted: () => void;
  onOpenScheduler: () => void;
  onOpenGrabber: () => void;
  onOpenOptions: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export const Toolbar: React.FC<Props> = ({
  onAddUrl,
  onResume,
  onPause,
  onStop,
  onDelete,
  onDeleteCompleted,
  onOpenScheduler,
  onOpenGrabber,
  onOpenOptions,
  searchQuery,
  onSearchChange,
}) => {
  return (
    <div className="quantum-toolbar-card">
      <div className="toolbar-left-group">
        {/* Add URL button with dropdown caret */}
        <button className="tb-btn tb-btn-add" onClick={onAddUrl} title="Add New Download URL">
          <div className="tb-add-circle">
            <Plus size={16} strokeWidth={3} />
          </div>
          <span className="tb-btn-label">Add URL</span>
          <ChevronDown size={14} className="tb-caret" />
        </button>

        <div className="tb-separator" />

        {/* Resume */}
        <button className="tb-btn" onClick={onResume} title="Resume Selected Download">
          <div className="tb-icon-box blue">
            <Play size={18} fill="#2563eb" color="#2563eb" />
          </div>
          <span className="tb-btn-label">Resume</span>
        </button>

        {/* Pause */}
        <button className="tb-btn" onClick={onPause} title="Pause Selected Download">
          <div className="tb-icon-box blue">
            <Pause size={18} fill="#2563eb" color="#2563eb" />
          </div>
          <span className="tb-btn-label">Pause</span>
        </button>

        {/* Stop */}
        <button className="tb-btn" onClick={onStop} title="Stop Selected Download">
          <div className="tb-icon-box red">
            <Square size={17} fill="#ef4444" color="#ef4444" />
          </div>
          <span className="tb-btn-label">Stop</span>
        </button>

        <div className="tb-separator" />

        {/* Delete */}
        <button className="tb-btn" onClick={onDelete} title="Delete Selected Download">
          <div className="tb-icon-box slate">
            <Trash2 size={18} color="#64748b" />
          </div>
          <span className="tb-btn-label">Delete</span>
        </button>

        {/* Delete Completed */}
        <button className="tb-btn" onClick={onDeleteCompleted} title="Remove All Completed Downloads">
          <div className="tb-icon-box folder-red">
            <div className="folder-icon-wrap">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  fill="#f59e0b"
                />
                <circle cx="16" cy="14" r="5" fill="#ef4444" />
                <path d="M14 12l4 4M18 12l-4 4" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </div>
          </div>
          <span className="tb-btn-label">Delete Completed</span>
        </button>

        {/* Scheduler */}
        <button className="tb-btn" onClick={onOpenScheduler} title="Schedule Downloads">
          <div className="tb-icon-box clock-blue">
            <div className="clock-icon-wrap">
              <Clock size={20} color="#2563eb" />
            </div>
          </div>
          <span className="tb-btn-label">Scheduler</span>
        </button>

        <div className="tb-separator" />

        {/* Grabber */}
        <button className="tb-btn" onClick={onOpenGrabber} title="Browser Sniffer & Video Grabber">
          <div className="tb-icon-box grabber">
            <div className="grabber-icon-wrap">
              <Globe size={19} color="#3b82f6" />
              <div className="grabber-plus">
                <Plus size={9} strokeWidth={3} color="#fff" />
              </div>
            </div>
          </div>
          <span className="tb-btn-label">Grabber</span>
        </button>

        {/* Options */}
        <button className="tb-btn" onClick={onOpenOptions} title="Download Preferences">
          <div className="tb-icon-box options">
            <Settings size={19} color="#64748b" />
          </div>
          <span className="tb-btn-label">Options</span>
        </button>
      </div>

      <div className="toolbar-right-group">
        {/* Search input */}
        <div className="tb-search-wrap">
          <Search size={16} className="tb-search-icon" />
          <input
            type="text"
            className="tb-search-input"
            placeholder="Search downloads..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        {/* Hamburger Menu */}
        <button className="tb-menu-btn" onClick={onOpenOptions} title="Menu">
          <Menu size={18} color="#475569" />
        </button>
      </div>
    </div>
  );
};
