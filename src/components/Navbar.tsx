import { Plus, Settings, Puzzle, Zap } from 'lucide-react';
import { SpeedChart } from './SpeedChart';
import logoImg from '../assets/logo.png';

interface Props {
  totalSpeed: number;
  activeCount: number;
  onOpenNewModal: () => void;
  onOpenSettings: () => void;
  onOpenExtensionModal: () => void;
}

export const Navbar: React.FC<Props> = ({
  totalSpeed,
  activeCount,
  onOpenNewModal,
  onOpenSettings,
  onOpenExtensionModal,
}) => {
  const formatSpeed = (bytesPerSec: number): string => {
    if (bytesPerSec <= 0) return '0 KB/s';
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
  };

  return (
    <header className="navbar">
      <div className="logo-area">
        <div className="logo-icon">
          <img src={logoImg} alt="Quantum Logo" className="navbar-logo-img" />
        </div>
        <span className="logo-title">QUANTUM DOWNLOADER</span>
      </div>

      <div className="nav-actions">
        {/* Speedometer & Live Chart */}
        <div className="speed-badge">
          <span className="pulse-dot" />
          <span>{formatSpeed(totalSpeed)}</span>
          <SpeedChart currentSpeed={totalSpeed} />
        </div>

        {/* Action Buttons */}
        <button className="btn btn-primary" onClick={onOpenNewModal}>
          <Plus size={16} />
          <span>Add URL</span>
        </button>

        <button
          className="btn btn-secondary"
          onClick={onOpenExtensionModal}
          title="Browser Extension Integration"
        >
          <Puzzle size={16} />
          <span>Extension</span>
        </button>

        <button
          className="btn-icon"
          onClick={onOpenSettings}
          title="App Settings"
        >
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
};
