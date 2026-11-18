import React, { useEffect, useState } from 'react';
import { X, Settings, Folder, Cpu, Activity, Sun, Moon, Check, Clipboard, Gauge, Clock, Power } from 'lucide-react';
import { AppSettings, QueueSchedule } from '../types';

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
  const [speedLimitKBps, setSpeedLimitKBps] = useState(settings.speedLimitKBps || 0);
  const [theme, setTheme] = useState<'light' | 'dark'>(settings.theme === 'dark' ? 'dark' : 'light');
  const [enableClipboardMonitor, setEnableClipboardMonitor] = useState(settings.enableClipboardMonitor ?? true);
  const [autoShutdownOnQueueComplete, setAutoShutdownOnQueueComplete] = useState(settings.autoShutdownOnQueueComplete ?? false);

  // Schedule state
  const [scheduleEnabled, setScheduleEnabled] = useState(settings.schedule?.enabled ?? false);
  const [startHour, setStartHour] = useState(settings.schedule?.startHour ?? 1);
  const [startMinute, setStartMinute] = useState(settings.schedule?.startMinute ?? 0);
  const [stopHour, setStopHour] = useState(settings.schedule?.stopHour ?? 6);
  const [stopMinute, setStopMinute] = useState(settings.schedule?.stopMinute ?? 0);
  const [scheduleShutdown, setScheduleShutdown] = useState(settings.schedule?.autoShutdownOnComplete ?? false);

  useEffect(() => {
    setDownloadDir(settings.downloadDir);
    setDefaultConnections(settings.defaultConnections || 16);
    setMaxActiveDownloads(settings.maxActiveDownloads || 4);
    setSpeedLimitKBps(settings.speedLimitKBps || 0);
    setTheme(settings.theme === 'dark' ? 'dark' : 'light');
    setEnableClipboardMonitor(settings.enableClipboardMonitor ?? true);
    setAutoShutdownOnQueueComplete(settings.autoShutdownOnQueueComplete ?? false);

    setScheduleEnabled(settings.schedule?.enabled ?? false);
    setStartHour(settings.schedule?.startHour ?? 1);
    setStartMinute(settings.schedule?.startMinute ?? 0);
    setStopHour(settings.schedule?.stopHour ?? 6);
    setStopMinute(settings.schedule?.stopMinute ?? 0);
    setScheduleShutdown(settings.schedule?.autoShutdownOnComplete ?? false);
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
    const updatedSchedule: QueueSchedule = {
      enabled: scheduleEnabled,
      startHour,
      startMinute,
      stopHour,
      stopMinute,
      autoShutdownOnComplete: scheduleShutdown,
    };

    onSave({
      downloadDir,
      defaultConnections,
      maxActiveDownloads,
      speedLimitKBps,
      theme,
      enableClipboardMonitor,
      autoShutdownOnQueueComplete,
      schedule: updatedSchedule,
    });
    onClose();
  };

  const formatSpeedLimitLabel = (kbps: number) => {
    if (kbps <= 0) return 'Unlimited (Max Speed)';
    if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`;
    return `${kbps} KB/s`;
  };

  return (
    <div className="glass-modal-overlay" onClick={onClose}>
      <div className="glass-modal-card" style={{ maxWidth: '620px', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header">
          <div className="glass-modal-title">
            <div className="modal-title-icon-box">
              <Settings size={20} color="#2563eb" />
            </div>
            <span>Preferences & Power Settings</span>
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

            {/* Bandwidth Limiter */}
            <div className="glass-form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="glass-form-label">
                  <Gauge size={15} color="#8b5cf6" /> Bandwidth Limiter (Speed Throttle)
                </label>
                <span className="slider-metric-val" style={{ color: speedLimitKBps > 0 ? '#8b5cf6' : '#64748b' }}>
                  {formatSpeedLimitLabel(speedLimitKBps)}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="20480"
                step="512"
                value={speedLimitKBps}
                onChange={(e) => setSpeedLimitKBps(parseInt(e.target.value, 10))}
                className="glass-range-slider"
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                <span>0 (Unlimited)</span>
                <span>5 MB/s</span>
                <span>10 MB/s</span>
                <span>20 MB/s</span>
              </div>
            </div>

            {/* Off-Peak Schedule & Auto-Shutdown Section */}
            <div style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: '10px', padding: '14px', marginBottom: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginBottom: scheduleEnabled ? '12px' : '0' }}>
                <input
                  type="checkbox"
                  checked={scheduleEnabled}
                  onChange={(e) => setScheduleEnabled(e.target.checked)}
                  className="quantum-checkbox"
                />
                <Clock size={16} color="#0284c7" />
                <span>Enable Off-Peak Download Scheduler</span>
              </label>

              {scheduleEnabled && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px', paddingLeft: '24px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px' }}>
                    <span>Active Window:</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input
                        type="number"
                        min="0"
                        max="23"
                        value={startHour}
                        onChange={(e) => setStartHour(Math.min(23, Math.max(0, parseInt(e.target.value, 10) || 0)))}
                        style={{ width: '45px', padding: '3px 6px', borderRadius: '5px', border: '1px solid #cbd5e1' }}
                      />
                      <span>:</span>
                      <input
                        type="number"
                        min="0"
                        max="59"
                        value={startMinute}
                        onChange={(e) => setStartMinute(Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)))}
                        style={{ width: '45px', padding: '3px 6px', borderRadius: '5px', border: '1px solid #cbd5e1' }}
                      />
                    </div>
                    <span>to</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input
                        type="number"
                        min="0"
                        max="23"
                        value={stopHour}
                        onChange={(e) => setStopHour(Math.min(23, Math.max(0, parseInt(e.target.value, 10) || 0)))}
                        style={{ width: '45px', padding: '3px 6px', borderRadius: '5px', border: '1px solid #cbd5e1' }}
                      />
                      <span>:</span>
                      <input
                        type="number"
                        min="0"
                        max="59"
                        value={stopMinute}
                        onChange={(e) => setStopMinute(Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)))}
                        style={{ width: '45px', padding: '3px 6px', borderRadius: '5px', border: '1px solid #cbd5e1' }}
                      />
                    </div>
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#475569', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={scheduleShutdown}
                      onChange={(e) => setScheduleShutdown(e.target.checked)}
                    />
                    <Power size={13} color="#ef4444" />
                    <span>Auto-shutdown computer when scheduled window tasks complete</span>
                  </label>
                </div>
              )}
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
                  Automatically prompt to download when URLs, magnet links, or video URLs are copied
                </span>
              </div>
            </label>

            {/* Auto Shutdown on all queue complete */}
            <label className="glass-checkbox-card" style={{ marginTop: '8px' }}>
              <input
                type="checkbox"
                checked={autoShutdownOnQueueComplete}
                onChange={(e) => setAutoShutdownOnQueueComplete(e.target.checked)}
                className="quantum-checkbox"
              />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="checkbox-title">
                  <Power size={14} color="#ef4444" style={{ display: 'inline', marginRight: '6px' }} />
                  Auto-Shutdown on Queue Completion
                </span>
                <span className="checkbox-subtitle">
                  Automatically turn off computer when all queued downloads finish
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
