import React, { useEffect, useState } from 'react';
import {
  X,
  Download,
  Folder,
  FileText,
  Link2,
  Clock,
  Layers,
  Zap,
  Check,
  ExternalLink,
  Music,
  Video,
  Archive,
  Terminal,
  FileQuestion
} from 'lucide-react';
import { DownloadCategory } from '../types';
import '../styles/dialog.css';

export const StandaloneDownloadDialog: React.FC = () => {
  const [url, setUrl] = useState('');
  const [filename, setFilename] = useState('');
  const [category, setCategory] = useState<DownloadCategory>('other');
  const [downloadDir, setDownloadDir] = useState<string>('Downloads');
  const [headers, setHeaders] = useState<Record<string, string> | undefined>(undefined);
  const [quality, setQuality] = useState<string | undefined>(undefined);
  const [formatId, setFormatId] = useState<string | undefined>(undefined);
  const [isStarting, setIsStarting] = useState(false);

  const detectCategoryFromFilename = (name: string): DownloadCategory => {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) return 'audio';
    if (['zip', 'rar', '7z', 'tar', 'gz', 'iso'].includes(ext)) return 'compressed';
    if (['exe', 'msi', 'apk', 'bat', 'dmg'].includes(ext)) return 'program';
    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt'].includes(ext)) return 'document';
    return 'other';
  };

  const populateData = (data: any) => {
    if (!data) return;
    const targetUrl = data.url || '';
    setUrl(targetUrl);
    setHeaders(data.headers);
    setQuality(data.quality);
    setFormatId(data.formatId);

    let detectedName = data.filename || '';
    if (!detectedName && targetUrl) {
      try {
        const u = new URL(targetUrl);
        const base = u.pathname.split('/').pop();
        if (base && base.includes('.')) {
          detectedName = decodeURIComponent(base);
        }
      } catch (e) {}
    }
    if (!detectedName) detectedName = `download_${Date.now()}`;
    setFilename(detectedName);

    if (data.category && data.category !== 'other') {
      setCategory(data.category);
    } else {
      setCategory(detectCategoryFromFilename(detectedName));
    }
  };

  useEffect(() => {
    if (window.quantumApi) {
      // 1. Fetch current settings for default folder
      window.quantumApi.getSettings().then(settings => {
        if (settings?.downloadDir) {
          setDownloadDir(settings.downloadDir);
        }
      }).catch(() => {});

      // 2. Fetch initial dialog data
      window.quantumApi.getDialogData().then(data => {
        if (data) populateData(data);
      }).catch(() => {});

      // 3. Listen for dynamic updates
      const unsub = window.quantumApi.on('init-dialog-data', (data: any) => {
        populateData(data);
      });

      return () => unsub();
    }
  }, []);

  const handleBrowseFolder = async () => {
    if (window.quantumApi) {
      const selected = await window.quantumApi.selectDownloadFolder();
      if (selected) {
        setDownloadDir(selected);
      }
    }
  };

  const handleStartDownload = async () => {
    if (!url.trim() || isStarting) return;
    setIsStarting(true);

    try {
      if (window.quantumApi) {
        await window.quantumApi.addDownload(
          url.trim(),
          filename.trim() || undefined,
          category !== 'other' ? category : undefined,
          headers,
          quality,
          formatId
        );
        window.quantumApi.closeDialog();
      }
    } catch (e) {
      console.error('Failed to start download:', e);
      setIsStarting(false);
    }
  };

  const handleDownloadLater = async () => {
    if (!url.trim() || isStarting) return;
    setIsStarting(true);

    try {
      if (window.quantumApi) {
        const task = await window.quantumApi.addDownload(
          url.trim(),
          filename.trim() || undefined,
          category !== 'other' ? category : undefined,
          headers,
          quality,
          formatId
        );
        if (task?.id) {
          await window.quantumApi.pauseDownload(task.id);
        }
        window.quantumApi.closeDialog();
      }
    } catch (e) {
      console.error('Failed to queue download:', e);
      setIsStarting(false);
    }
  };

  const handleClose = () => {
    if (window.quantumApi) {
      window.quantumApi.closeDialog();
    }
  };

  const handleOpenDashboard = () => {
    if (window.quantumApi) {
      window.quantumApi.showMainWindow();
    }
  };

  const categories: { id: DownloadCategory; label: string; icon: any }[] = [
    { id: 'compressed', label: 'Compressed', icon: Archive },
    { id: 'video', label: 'Video', icon: Video },
    { id: 'audio', label: 'Audio', icon: Music },
    { id: 'program', label: 'Programs', icon: Terminal },
    { id: 'document', label: 'Docs', icon: FileText },
    { id: 'other', label: 'General', icon: FileQuestion },
  ];

  return (
    <div className="standalone-dialog-root">
      {/* Draggable Titlebar */}
      <div className="dialog-header">
        <div className="dialog-header-left">
          <div className="dialog-header-icon">
            <Zap size={14} color="#2563eb" />
          </div>
          <div>
            <span className="dialog-header-title">Quantum Downloader</span>
            <span className="dialog-header-subtitle"> • Download File Info</span>
          </div>
        </div>

        <button
          onClick={handleClose}
          type="button"
          className="dialog-close-btn"
          title="Close dialog"
        >
          <X size={16} />
        </button>
      </div>

      {/* Main Body */}
      <div className="dialog-body">
        {/* URL Input */}
        <div className="dialog-field-group">
          <label className="dialog-label">
            <span className="dialog-label-left">
              <Link2 size={14} color="#2563eb" />
              Download Address (URL)
            </span>
            {quality && (
              <span className="dialog-badge-tag">
                {quality}
              </span>
            )}
          </label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            className="dialog-input dialog-input-mono"
          />
        </div>

        {/* Filename Input */}
        <div className="dialog-field-group">
          <label className="dialog-label">
            <span className="dialog-label-left">
              <FileText size={14} color="#2563eb" />
              Save File As
            </span>
          </label>
          <input
            type="text"
            value={filename}
            onChange={(e) => {
              setFilename(e.target.value);
              setCategory(detectCategoryFromFilename(e.target.value));
            }}
            placeholder="file_name.ext"
            className="dialog-input"
          />
        </div>

        {/* Category Pills */}
        <div className="dialog-field-group">
          <label className="dialog-label">
            <span className="dialog-label-left">
              <Layers size={14} color="#2563eb" />
              File Category
            </span>
          </label>
          <div className="dialog-category-grid">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const isSelected = category === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id)}
                  className={`dialog-category-btn ${isSelected ? 'active' : ''}`}
                >
                  <Icon className="dialog-category-icon" />
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Save Folder Row */}
        <div className="dialog-field-group">
          <label className="dialog-label">
            <span className="dialog-label-left">
              <Folder size={14} color="#2563eb" />
              Save Folder
            </span>
          </label>
          <div className="dialog-folder-row">
            <div className="dialog-folder-path" title={downloadDir}>
              {downloadDir}
            </div>
            <button
              type="button"
              onClick={handleBrowseFolder}
              className="dialog-browse-btn"
            >
              Browse...
            </button>
          </div>
        </div>

        {/* Acceleration Banner */}
        <div className="dialog-acceleration-banner">
          <div className="dialog-acceleration-left">
            <Zap size={15} color="#2563eb" />
            <span>Quantum 16-Thread High-Speed Acceleration</span>
          </div>
          <div className="dialog-acceleration-ready">
            <Check size={12} />
            <span>Ready</span>
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="dialog-footer">
        <button
          onClick={handleOpenDashboard}
          type="button"
          className="dialog-dashboard-link"
        >
          <ExternalLink size={13} />
          <span>Open Dashboard</span>
        </button>

        <div className="dialog-footer-actions">
          <button
            onClick={handleClose}
            type="button"
            className="dialog-btn-cancel"
          >
            Cancel
          </button>

          <button
            onClick={handleDownloadLater}
            disabled={isStarting}
            type="button"
            className="dialog-btn-later"
          >
            <Clock size={14} />
            <span>Download Later</span>
          </button>

          <button
            onClick={handleStartDownload}
            disabled={isStarting || !url.trim()}
            type="button"
            className="dialog-btn-start"
          >
            <Download size={14} />
            <span>{isStarting ? 'Starting...' : 'Start Download'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
