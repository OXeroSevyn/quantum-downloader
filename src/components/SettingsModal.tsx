import React, { useEffect, useState } from 'react';
import { X, Settings, Folder, Cpu, Activity, Sun, Moon, Check, Clipboard } from 'lucide-react';
import { AppSettings } from '../types';

interface Props {
  isOpen: boolean;
  settings: AppSettings;
  onClose: () => void;
  onSave: (settings: Partial<AppSettings>) => void;
  onSelectFolder: () => Promise<string | null>;
}

export const SettingsModal: React.FC<Props> = ({
  isOpen,
  settings,
  onClose,
  onSave,
  onSelectFolder,
}) => {
  const [downloadDir, setDownloadDir] = useState(settings.downloadDir);
  const [defaultConnections, setDefaultConnections] = useState(settings.defaultConnections || 16);
  const [maxActiveDownloads, setMaxActiveDownloads] = useState(settings.maxActiveDownloads || 4);
  const [theme, setTheme] = useState<'light' | 'dark'>(settings.theme === 'dark' ? 'dark' : 'light');
  const [enableClipboardMonitor, setEnableClipboardMonitor] = useState(settings.enableClipboardMonitor ?? true);

  useEffect(() => {
    setDownloadDir(settings.downloadDir);
    setDefaultConnections(settings.defaultConnections || 16);
    setMaxActiveDownloads(settings.maxActiveDownloads || 4);
    setTheme(settings.theme === 'dark' ? 'dark' : 'light');
    setEnableClipboardMonitor(settings.enableClipboardMonitor ?? true);
  }, [settings]);

  if (!isOpen) return null;

  const handleBrowse = async () => {
    const folder = await onSelectFolder();
    if (folder) {
      setDownloadDir(folder);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      downloadDir,
      defaultConnections,
      maxActiveDownloads,
      theme,
      enableClipboardMonitor,
    });
    onClose();
  };

  return (
    <div className="glass-modal-overlay" onClick={onClose}>
      <div className="glass-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header">
          <div className="glass-modal-title">
            <div className="modal-title-icon-box">
              <Settings size={20} color="#2563eb" />
            </div>
            <span>Preferences & Settings</span>
          </div>
          <button className="glass-modal-close-btn" onClick={onClose} type="button" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="glass-form-body">
            {/* Display Appearance: Bright / Dark Mode */}
            <div className="glass-form-group">
              <label className="glass-form-label">
                <Sun size={15} color="#f59e0b" /> Display Appearance
              </label>
              <div className="theme-toggle-switch-card">
                <button
                  type="button"
                  className={`theme-toggle-btn ${theme === 'light' ? 'active' : ''}`}
                  onClick={() => setTheme('light')}
                >
                  <div className="theme-btn-icon-wrap light">
                    <Sun size={18} color="#d97706" />
                  </div>
                  <div className="theme-btn-text">
                    <span className="theme-btn-title">Bright Mode</span>
                    <span className="theme-btn-desc">High contrast light suite</span>
                  </div>
                  {theme === 'light' && <Check size={18} className="theme-check-icon" />}
                </button>

                <button
                  type="button"
                  className={`theme-toggle-btn ${theme === 'dark' ? 'active' : ''}`}
                  onClick={() => setTheme('dark')}
                >
                  <div className="theme-btn-icon-wrap dark">
                    <Moon size={18} color="#3b82f6" />
                  </div>
                  <div className="theme-btn-text">
                    <span className="theme-btn-title">Dark Mode</span>
                    <span className="theme-btn-desc">Deep OLED midnight slate</span>
                  </div>
                  {theme === 'dark' && <Check size={18} className="theme-check-icon" />}
                </button>
              </div>
            </div>

            {/* Download Directory */}
            <div className="glass-form-group">
              <label className="glass-form-label">
                <Folder size={15} color="#2563eb" /> Default Download Directory
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  className="glass-form-input readonly-dir"
                  value={downloadDir}
                  readOnly
                  title={downloadDir}
                />
                <button
                  type="button"
                  className="glass-btn-secondary"
                  onClick={handleBrowse}
                >
                  Browse...
                </button>
              </div>
            </div>

            {/* Sliders for Connections & Active Downloads */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="glass-form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="glass-form-label">
                    <Cpu size={15} color="#16a34a" /> Acceleration
                  </label>
                  <span className="slider-metric-val green">
                    {defaultConnections} Threads
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="32"
                  value={defaultConnections}
                  onChange={(e) => setDefaultConnections(parseInt(e.target.value, 10))}
                  className="glass-range-slider"
                />
              </div>

              <div className="glass-form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="glass-form-label">
                    <Activity size={15} color="#2563eb" /> Concurrency
                  </label>
                  <span className="slider-metric-val blue">
                    {maxActiveDownloads} Tasks
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={maxActiveDownloads}
                  onChange={(e) => setMaxActiveDownloads(parseInt(e.target.value, 10))}
                  className="glass-range-slider"
                />
              </div>
            </div>

            {/* Clipboard Monitor Checkbox */}
            <label className="glass-checkbox-card">
              <input
                type="checkbox"
                checked={enableClipboardMonitor}
                onChange={(e) => setEnableClipboardMonitor(e.target.checked)}
                className="quantum-checkbox"
              />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="checkbox-title">
                  <Clipboard size={14} color="#64748b" style={{ display: 'inline', marginRight: '6px' }} />
                  Clipboard Download Monitor
                </span>
                <span className="checkbox-subtitle">
                  Automatically prompt to download when URLs or video links are copied
                </span>
              </div>
            </label>
          </div>

          {/* Modal Actions */}
          <div className="glass-modal-footer">
            <button type="button" className="glass-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="glass-btn-primary">
              Save Preferences
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
