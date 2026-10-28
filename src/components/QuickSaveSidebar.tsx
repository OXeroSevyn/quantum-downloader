import React from 'react';
import {
  Inbox,
  ArrowDown,
  CheckSquare,
  Pause,
  AlertCircle,
  Play,
  Music,
  Archive,
  FileText,
  Image,
  AppWindow,
  MoreHorizontal,
  Settings,
  Clock,
  ChevronDown,
} from 'lucide-react';
import { DownloadTask } from '../types';

interface Props {
  tasks: DownloadTask[];
  selectedCategory: string;
  selectedStatus: string;
  onSelectCategory: (cat: string) => void;
  onSelectStatus: (status: string) => void;
}

export const QuickSaveSidebar: React.FC<Props> = ({
  tasks,
  selectedCategory,
  selectedStatus,
  onSelectCategory,
  onSelectStatus,
}) => {
  const downloadingCount = tasks.filter(t => t.status === 'downloading').length;
  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const pausedCount = tasks.filter(t => t.status === 'paused').length;
  const failedCount = tasks.filter(t => t.status === 'error').length;

  const getCatCount = (cat: string) => {
    return tasks.filter(t => {
      if (cat === 'video') return t.category === 'video' || /\.(mp4|mkv|avi|mov|webm)$/i.test(t.filename);
      if (cat === 'audio') return t.category === 'audio' || /\.(mp3|wav|flac|aac|ogg|m4a)$/i.test(t.filename);
      if (cat === 'compressed') return t.category === 'compressed' || /\.(zip|rar|7z|tar|gz)$/i.test(t.filename);
      if (cat === 'document') return t.category === 'document' || /\.(pdf|doc|docx|txt|xls|xlsx|ppt)$/i.test(t.filename);
      if (cat === 'image') return t.category === 'image' || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(t.filename);
      if (cat === 'program') return t.category === 'program' || /\.(exe|msi|dmg|pkg|deb|rpm|apk)$/i.test(t.filename);
      return t.category === 'other';
    }).length;
  };

  const isAllSelected = selectedCategory === 'all' && selectedStatus === 'all';

  return (
    <aside className="quantum-sidebar">
      {/* Status section */}
      <div className="sidebar-nav-list">
        {/* All Downloads */}
        <button
          className={`sidebar-row-btn ${isAllSelected ? 'active-primary' : ''}`}
          onClick={() => {
            onSelectCategory('all');
            onSelectStatus('all');
          }}
        >
          <div className="row-left">
            <div className={`row-icon-box ${isAllSelected ? 'icon-white' : 'blue'}`}>
              <Inbox size={16} />
            </div>
            <span className="row-title">All Downloads</span>
          </div>
          <span className="row-pill-badge">{tasks.length}</span>
        </button>

        {/* Downloading */}
        <button
          className={`sidebar-row-btn ${selectedStatus === 'downloading' ? 'active-primary' : ''}`}
          onClick={() => {
            onSelectCategory('all');
            onSelectStatus('downloading');
          }}
        >
          <div className="row-left">
            <div className="row-icon-box green">
              <ArrowDown size={16} />
            </div>
            <span className="row-title">Downloading</span>
          </div>
          <span className="row-pill-badge">{downloadingCount}</span>
        </button>

        {/* Completed */}
        <button
          className={`sidebar-row-btn ${selectedStatus === 'completed' && selectedCategory === 'all' ? 'active-primary' : ''}`}
          onClick={() => {
            onSelectCategory('all');
            onSelectStatus('completed');
          }}
        >
          <div className="row-left">
            <div className="row-icon-box green">
              <CheckSquare size={16} />
            </div>
            <span className="row-title">Completed</span>
          </div>
          <span className="row-pill-badge">{completedCount}</span>
        </button>

        {/* Paused */}
        <button
          className={`sidebar-row-btn ${selectedStatus === 'paused' ? 'active-primary' : ''}`}
          onClick={() => {
            onSelectCategory('all');
            onSelectStatus('paused');
          }}
        >
          <div className="row-left">
            <div className="row-icon-box blue">
              <Pause size={16} fill="currentColor" />
            </div>
            <span className="row-title">Paused</span>
          </div>
          <span className="row-pill-badge">{pausedCount}</span>
        </button>

        {/* Failed */}
        <button
          className={`sidebar-row-btn ${selectedStatus === 'error' ? 'active-primary' : ''}`}
          onClick={() => {
            onSelectCategory('all');
            onSelectStatus('error');
          }}
        >
          <div className="row-left">
            <div className="row-icon-box red">
              <AlertCircle size={16} />
            </div>
            <span className="row-title">Failed</span>
          </div>
          <span className="row-pill-badge">{failedCount}</span>
        </button>
      </div>

      {/* Categories Section */}
      <div className="sidebar-group-box">
        <div className="group-header">
          <ChevronDown size={14} className="group-arrow" />
          <span className="group-title">Categories</span>
        </div>

        <div className="sidebar-nav-list">
          {/* Video */}
          <button
            className={`sidebar-row-btn ${selectedCategory === 'video' ? 'active-primary' : ''}`}
            onClick={() => {
              onSelectCategory('video');
              onSelectStatus('all');
            }}
          >
            <div className="row-left">
              <div className="cat-badge-square red">
                <Play size={11} fill="#fff" color="#fff" />
              </div>
              <span className="row-title">Video</span>
            </div>
            <span className="row-pill-badge">{getCatCount('video')}</span>
          </button>

          {/* Audio */}
          <button
            className={`sidebar-row-btn ${selectedCategory === 'audio' ? 'active-primary' : ''}`}
            onClick={() => {
              onSelectCategory('audio');
              onSelectStatus('all');
            }}
          >
            <div className="row-left">
              <div className="cat-badge-square blue">
                <Music size={12} color="#fff" />
              </div>
              <span className="row-title">Audio</span>
            </div>
            <span className="row-pill-badge">{getCatCount('audio')}</span>
          </button>

          {/* Compressed */}
          <button
            className={`sidebar-row-btn ${selectedCategory === 'compressed' ? 'active-primary' : ''}`}
            onClick={() => {
              onSelectCategory('compressed');
              onSelectStatus('all');
            }}
          >
            <div className="row-left">
              <div className="cat-badge-square orange">
                <Archive size={12} color="#fff" />
              </div>
              <span className="row-title">Compressed</span>
            </div>
            <span className="row-pill-badge">{getCatCount('compressed')}</span>
          </button>

          {/* Documents */}
          <button
            className={`sidebar-row-btn ${selectedCategory === 'document' ? 'active-primary' : ''}`}
            onClick={() => {
              onSelectCategory('document');
              onSelectStatus('all');
            }}
          >
            <div className="row-left">
              <div className="cat-badge-square slate">
                <FileText size={12} color="#fff" />
              </div>
              <span className="row-title">Documents</span>
            </div>
            <span className="row-pill-badge">{getCatCount('document')}</span>
          </button>

          {/* Images */}
          <button
            className={`sidebar-row-btn ${selectedCategory === 'image' ? 'active-primary' : ''}`}
            onClick={() => {
              onSelectCategory('image');
              onSelectStatus('all');
            }}
          >
            <div className="row-left">
              <div className="cat-badge-square green">
                <Image size={12} color="#fff" />
              </div>
              <span className="row-title">Images</span>
            </div>
            <span className="row-pill-badge">{getCatCount('image')}</span>
          </button>

          {/* Programs */}
          <button
            className={`sidebar-row-btn ${selectedCategory === 'program' ? 'active-primary' : ''}`}
            onClick={() => {
              onSelectCategory('program');
              onSelectStatus('all');
            }}
          >
            <div className="row-left">
              <div className="cat-badge-square blue-dark">
                <AppWindow size={12} color="#fff" />
              </div>
              <span className="row-title">Programs</span>
            </div>
            <span className="row-pill-badge">{getCatCount('program')}</span>
          </button>

          {/* Others */}
          <button
            className={`sidebar-row-btn ${selectedCategory === 'other' ? 'active-primary' : ''}`}
            onClick={() => {
              onSelectCategory('other');
              onSelectStatus('all');
            }}
          >
            <div className="row-left">
              <div className="cat-badge-square gray">
                <MoreHorizontal size={12} color="#fff" />
              </div>
              <span className="row-title">Others</span>
            </div>
            <span className="row-pill-badge">{getCatCount('other')}</span>
          </button>
        </div>
      </div>

      {/* Queues Section */}
      <div className="sidebar-group-box">
        <div className="group-header">
          <ChevronDown size={14} className="group-arrow" />
          <span className="group-title">Queues</span>
        </div>

        <div className="sidebar-nav-list">
          <button
            className="sidebar-row-btn"
            onClick={() => {
              onSelectCategory('all');
              onSelectStatus('all');
            }}
          >
            <div className="row-left">
              <div className="row-icon-box slate">
                <Settings size={15} />
              </div>
              <span className="row-title">Main Queue</span>
            </div>
            <span className="row-pill-badge">{tasks.length}</span>
          </button>

          <button
            className="sidebar-row-btn"
            onClick={() => {
              onSelectCategory('all');
              onSelectStatus('paused');
            }}
          >
            <div className="row-left">
              <div className="row-icon-box slate">
                <Clock size={15} />
              </div>
              <span className="row-title">Download Later</span>
            </div>
            <span className="row-pill-badge">0</span>
          </button>
        </div>
      </div>
    </aside>
  );
};
