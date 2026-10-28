import React, { useState, useEffect } from 'react';
import { X, Puzzle, Copy, CheckCircle2, ShieldCheck, Video, RefreshCw } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  serverPort: number;
}

export const BrowserExtensionModal: React.FC<Props> = ({ isOpen, onClose, serverPort }) => {
  const [copied, setCopied] = useState<boolean>(false);
  const [bridgeStatus, setBridgeStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const extPath = 'c:\\Users\\Subham\\Downloads\\Quantum Downloader\\extension';

  const checkBridge = async () => {
    setBridgeStatus('checking');
    try {
      const res = await fetch(`http://127.0.0.1:${serverPort}/api/status`);
      if (res.ok) {
        setBridgeStatus('connected');
      } else {
        setBridgeStatus('error');
      }
    } catch {
      setBridgeStatus('error');
    }
  };

  useEffect(() => {
    if (isOpen) {
      checkBridge();
    }
  }, [isOpen, serverPort]);

  const handleCopyPath = () => {
    navigator.clipboard.writeText(extPath);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="glass-modal-overlay" onClick={onClose}>
      <div className="glass-modal-card" style={{ maxWidth: '580px' }} onClick={(e) => e.stopPropagation()}>
        <div className="glass-modal-header">
          <div className="glass-modal-title">
            <div className="modal-title-icon-box">
              <Puzzle size={20} color="#2563eb" />
            </div>
            <span>Universal Browser Extension</span>
          </div>
          <button className="glass-modal-close-btn" onClick={onClose} type="button" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="glass-form-body">
          {/* Status indicator bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            background: bridgeStatus === 'connected' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${bridgeStatus === 'connected' ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
            borderRadius: '10px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: bridgeStatus === 'connected' ? '#16a34a' : '#ef4444',
                  boxShadow: bridgeStatus === 'connected' ? '0 0 10px #16a34a' : '0 0 10px #ef4444',
                }}
              />
              <span style={{ fontWeight: 700, fontSize: '0.86rem' }}>
                Local Bridge API: {bridgeStatus === 'connected' ? `Active & Ready (Port ${serverPort})` : 'Connecting / Offline'}
              </span>
            </div>
            <button
              className="glass-btn-secondary"
              style={{ padding: '4px 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '6px' }}
              onClick={checkBridge}
            >
              <RefreshCw size={12} />
              <span>Retry</span>
            </button>
          </div>

          {/* Feature Highlights */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div style={{ padding: '12px', background: 'var(--bg-hover)', borderRadius: '10px', border: '1px solid var(--border-light)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#2563eb', marginBottom: '4px', fontWeight: 700, fontSize: '0.84rem' }}>
                <Video size={15} /> Floating Video Badge
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4, margin: 0 }}>
                Hover over YouTube, Vimeo, Twitter, Reddit videos for instant 1080p, 720p, or MP3 one-click downloads.
              </p>
            </div>
            <div style={{ padding: '12px', background: 'var(--bg-hover)', borderRadius: '10px', border: '1px solid var(--border-light)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#16a34a', marginBottom: '4px', fontWeight: 700, fontSize: '0.84rem' }}>
                <ShieldCheck size={15} /> Context Menu Actions
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4, margin: 0 }}>
                Right-click any link or web page: "Download with Quantum" and "Download all links with Quantum".
              </p>
            </div>
          </div>

          {/* Installation Instructions */}
          <div style={{ fontSize: '0.84rem', marginTop: '2px' }}>
            <div style={{ fontWeight: 700, marginBottom: '6px', color: 'var(--text-dark)' }}>How to Load into Chrome, Edge, Brave, or Opera:</div>
            <ol style={{ paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              <li>
                Open extensions manager: <code>chrome://extensions</code> or <code>edge://extensions</code>
              </li>
              <li>Toggle on <strong>"Developer mode"</strong> in the top-right corner.</li>
              <li>Click <strong>"Load unpacked"</strong>.</li>
              <li>Select the extension directory path below:</li>
            </ol>
          </div>

          {/* Path copy box */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              className="glass-form-input readonly-dir"
              value={extPath}
              readOnly
              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}
            />
            <button
              type="button"
              className="glass-btn-secondary"
              onClick={handleCopyPath}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
            >
              {copied ? <CheckCircle2 size={15} color="#16a34a" /> : <Copy size={15} />}
              <span>{copied ? 'Copied!' : 'Copy Path'}</span>
            </button>
          </div>
        </div>

        <div className="glass-modal-footer">
          <button type="button" className="glass-btn-primary" onClick={onClose}>
            Got It
          </button>
        </div>
      </div>
    </div>
  );
};
