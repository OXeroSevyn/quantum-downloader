import React from 'react';
import { Settings, HelpCircle, Minus, Square, X } from 'lucide-react';
import logoImg from '../assets/logo.png';

interface Props {
  onOpenSettings: () => void;
  onOpenHelp: () => void;
}

export const QuickSaveHeader: React.FC<Props> = ({
  onOpenSettings,
  onOpenHelp,
}) => {
  const handleMinimize = () => window.quantumApi?.minimizeWindow();
  const handleMaximize = () => window.quantumApi?.maximizeWindow();
  const handleClose = () => window.quantumApi?.closeWindow();

  return (
    <header className="quantum-titlebar">
      {/* Brand area */}
      <div className="titlebar-brand">
        <div className="titlebar-logo-box">
          <img src={logoImg} alt="Quantum Logo" className="titlebar-logo-img" />
        </div>
        <div className="titlebar-text">
          <h1 className="titlebar-title">Quantum Downloader</h1>
          <span className="titlebar-subtitle">High-Speed Accelerator</span>
        </div>
      </div>

      {/* Right-side window & helper buttons */}
      <div className="titlebar-actions">
        <button className="tb-pill-action" onClick={onOpenSettings} title="Settings">
          <Settings size={15} color="#475569" />
          <span>Settings</span>
        </button>

        <button className="tb-pill-action" onClick={onOpenHelp} title="Help & Documentation">
          <HelpCircle size={15} color="#475569" />
          <span>Help</span>
        </button>

        <div className="titlebar-window-controls">
          <button className="win-btn win-minimize" onClick={handleMinimize} title="Minimize">
            <Minus size={13} color="#475569" />
          </button>
          <button className="win-btn win-maximize" onClick={handleMaximize} title="Maximize">
            <Square size={11} color="#475569" />
          </button>
          <button className="win-btn win-close" onClick={handleClose} title="Close">
            <X size={14} color="#475569" />
          </button>
        </div>
      </div>
    </header>
  );
};
