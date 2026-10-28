import React, { useEffect, useState } from 'react';
import { X, Globe, Link2, FileText, Cpu, Download, Folder, Check } from 'lucide-react';
import { DownloadCategory } from '../types';

interface Props {
  isOpen: boolean;
  initialUrl?: string;
  initialFilename?: string;
  initialCategory?: DownloadCategory;
  initialHeaders?: Record<string, string>;
  initialQuality?: string;
  initialFormatId?: string;
  onClose: () => void;
  onSubmit: (
    url: string,
    filename?: string,
    category?: DownloadCategory,
    headers?: Record<string, string>,
    quality?: string,
    formatId?: string
  ) => void;
}

export const NewDownloadModal: React.FC<Props> = ({
  isOpen,
  initialUrl = '',
  initialFilename = '',
  initialCategory = 'other',
  initialHeaders,
  initialQuality,
  initialFormatId,
  onClose,
  onSubmit,
}) => {
  const [url, setUrl] = useState('');
  const [filename, setFilename] = useState('');
  const [category, setCategory] = useState<DownloadCategory>('other');
  const [threads, setThreads] = useState<number>(16);
  const [headers, setHeaders] = useState<Record<string, string> | undefined>(undefined);
  const [quality, setQuality] = useState<string | undefined>(undefined);
  const [formatId, setFormatId] = useState<string | undefined>(undefined);

  const detectCategoryFromFilename = (name: string): DownloadCategory => {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) return 'audio';
    if (['zip', 'rar', '7z', 'tar', 'gz', 'iso'].includes(ext)) return 'compressed';
    if (['exe', 'msi', 'apk', 'bat', 'dmg'].includes(ext)) return 'program';
    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt'].includes(ext)) return 'document';
    return 'other';
  };

  useEffect(() => {
    if (isOpen) {
      const targetUrl = initialUrl || '';
      setUrl(targetUrl);
      setHeaders(initialHeaders);
      setQuality(initialQuality);
      setFormatId(initialFormatId);

      let detectedName = initialFilename || '';
      if (!detectedName && targetUrl) {
        try {
          const u = new URL(targetUrl);
          const base = u.pathname.split('/').pop();
          if (base && base.includes('.')) {
            detectedName = decodeURIComponent(base);
          }
        } catch (e) {}
      }
      setFilename(detectedName);

      if (initialCategory && initialCategory !== 'other') {
        setCategory(initialCategory);
      } else if (detectedName) {
        setCategory(detectCategoryFromFilename(detectedName));
      } else {
        setCategory('other');
      }
    }
  }, [isOpen, initialUrl, initialFilename, initialCategory, initialHeaders, initialQuality, initialFormatId]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    onSubmit(
      url.trim(),
      filename.trim() || undefined,
      category !== 'other' ? category : undefined,
      headers,
      quality,
      formatId
    );
    setUrl('');
    setFilename('');
    onClose();
  };

  return (
    <div className="glass-modal-overlay" onClick={onClose}>
      <div className="glass-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header">
          <div className="glass-modal-title">
            <div className="modal-title-icon-box">
              <Globe size={20} color="#2563eb" />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '15px' }}>Download File Info</div>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>Quantum Accelerator • 16-Segment Multi-Threading</div>
            </div>
          </div>
          <button className="glass-modal-close-btn" onClick={onClose} type="button" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="glass-form-body">
            {/* URL Input */}
            <div className="glass-form-group">
              <label className="glass-form-label">
                <Link2 size={15} color="#2563eb" /> Download Link / Source URL *
              </label>
              <input
                type="text"
                className="glass-form-input"
                placeholder="https://example.com/file.zip or YouTube video URL..."
                required
                autoFocus
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  try {
                    const u = new URL(e.target.value);
                    const base = u.pathname.split('/').pop();
                    if (base && base.includes('.') && !filename) {
                      setFilename(decodeURIComponent(base));
                      setCategory(detectCategoryFromFilename(base));
                    }
                  } catch {}
                }}
              />
            </div>

            {/* Filename Input */}
            <div className="glass-form-group">
              <label className="glass-form-label">
                <FileText size={15} color="#64748b" /> Output Filename
              </label>
              <input
                type="text"
                className="glass-form-input"
                placeholder="e.g. Tekken-5-Dark-Resurrection-AnkerGames.zip"
                value={filename}
                onChange={(e) => {
                  setFilename(e.target.value);
                  if (e.target.value) {
                    setCategory(detectCategoryFromFilename(e.target.value));
                  }
                }}
              />
            </div>

            {/* Category & Threads */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="glass-form-group">
                <label className="glass-form-label">Category</label>
                <select
                  className="glass-form-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as DownloadCategory)}
                >
                  <option value="other">Auto Detect</option>
                  <option value="compressed">Compressed Archives (.zip, .rar)</option>
                  <option value="video">Video & Streams (.mp4, .mkv)</option>
                  <option value="audio">Music / Audio (.mp3, .wav)</option>
                  <option value="program">Programs & Installers (.exe, .msi)</option>
                  <option value="document">Documents (.pdf, .doc)</option>
                </select>
              </div>

              <div className="glass-form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="glass-form-label">
                    <Cpu size={15} color="#16a34a" /> Parallel Threads
                  </label>
                  <span className="slider-metric-val green">
                    {threads} Threads
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="32"
                  step="1"
                  value={threads}
                  onChange={(e) => setThreads(parseInt(e.target.value, 10))}
                  className="glass-range-slider"
                />
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="glass-modal-footer">
            <button type="button" className="glass-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="glass-btn-primary">
              <Download size={17} strokeWidth={2.4} />
              <span>Start Download</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
