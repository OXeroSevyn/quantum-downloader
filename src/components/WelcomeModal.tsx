import React, { useState } from 'react';
import { Zap, Globe, ArrowRight, ArrowLeft, CheckCircle2, ShieldCheck, Download, Film, Music, Cpu, SunMoon } from 'lucide-react';
import logoImg from '../assets/logo.png';

interface Props {
  isOpen: boolean;
  onFinish: () => void;
}

export const WelcomeModal: React.FC<Props> = ({ isOpen, onFinish }) => {
  const [step, setStep] = useState<number>(1);

  if (!isOpen) return null;

  return (
    <div className="welcome-overlay">
      <div className="welcome-card">
        {/* Top bar with step indicator & skip */}
        <div className="welcome-header">
          <div className="welcome-steps-indicator">
            <span className={`step-dot ${step === 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''}`} />
            <span className={`step-dot ${step === 2 ? 'active' : ''} ${step > 2 ? 'completed' : ''}`} />
            <span className={`step-dot ${step === 3 ? 'active' : ''}`} />
          </div>
          <button className="welcome-skip-btn" onClick={onFinish}>
            Skip Intro
          </button>
        </div>

        {/* Slide 1: Multi-Segment Speed */}
        {step === 1 && (
          <div className="welcome-slide">
            <div className="welcome-icon-box logo-box">
              <img src={logoImg} alt="Quantum Logo" className="welcome-logo-img" />
            </div>
            <span className="welcome-tag">STEP 1 OF 3 • MAXIMUM SPEED</span>
            <h1 className="welcome-title">Welcome to Quantum Downloader</h1>
            <p className="welcome-subtitle">
              The next-generation download manager built for pure speed and modern aesthetics.
            </p>
            <p className="welcome-desc">
              Quantum Downloader dynamically splits files into up to <strong>32 parallel connections</strong>, taking full advantage of your internet connection to deliver up to <strong>10x faster downloads</strong> than standard browsers.
            </p>

            <div className="welcome-features-grid">
              <div className="welcome-feature-item">
                <Cpu size={18} color="#2563eb" />
                <span>32-Thread Segmentation</span>
              </div>
              <div className="welcome-feature-item">
                <Zap size={18} color="#f59e0b" />
                <span>Dynamic Chunk Stealing</span>
              </div>
              <div className="welcome-feature-item">
                <CheckCircle2 size={18} color="#16a34a" />
                <span>Zero-Delay Sparse Assembly</span>
              </div>
            </div>

            <div className="welcome-actions">
              <div />
              <button className="welcome-btn-primary" onClick={() => setStep(2)}>
                <span>Next: Browser Extension</span>
                <ArrowRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Slide 2: Browser Video Sniffer */}
        {step === 2 && (
          <div className="welcome-slide">
            <div className="welcome-icon-box" style={{ background: 'rgba(37, 99, 235, 0.1)', borderColor: 'rgba(37, 99, 235, 0.25)' }}>
              <Film size={32} color="#2563eb" strokeWidth={2.4} />
            </div>
            <span className="welcome-tag" style={{ color: '#2563eb' }}>STEP 2 OF 3 • UNIVERSAL EXTENSION</span>
            <h1 className="welcome-title">1-Click Video Sniffer & Floating Badge</h1>
            <p className="welcome-subtitle">
              Capture 4K, 1080p, and MP3 streams on any web video player instantly.
            </p>
            <p className="welcome-desc">
              Install the companion extension for Chrome, Edge, and Brave. Hover above HTML5 videos to see the sleek <strong>⚡ Download Video (1080p | 720p | MP3)</strong> badge and context menu actions.
            </p>

            <div className="welcome-features-grid">
              <div className="welcome-feature-item">
                <Film size={18} color="#2563eb" />
                <span>4K Ultra HD & 1080p</span>
              </div>
              <div className="welcome-feature-item">
                <Music size={18} color="#9333ea" />
                <span>One-Click MP3 Extractor</span>
              </div>
              <div className="welcome-feature-item">
                <Globe size={18} color="#16a34a" />
                <span>Context Menu "Download All"</span>
              </div>
            </div>

            <div className="welcome-actions">
              <button className="welcome-btn-secondary" onClick={() => setStep(1)}>
                <ArrowLeft size={18} />
                <span>Back</span>
              </button>
              <button className="welcome-btn-primary" onClick={() => setStep(3)}>
                <span>Next: Final Setup</span>
                <ArrowRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Slide 3: All Set & Light/Dark Modes */}
        {step === 3 && (
          <div className="welcome-slide">
            <div className="welcome-icon-box" style={{ background: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.25)' }}>
              <SunMoon size={32} color="#10b981" strokeWidth={2.4} />
            </div>
            <span className="welcome-tag" style={{ color: '#10b981' }}>STEP 3 OF 3 • READY TO ACCELERATE</span>
            <h1 className="welcome-title">You're All Set!</h1>
            <p className="welcome-subtitle">
              Clean Light Suite & Deep Dark Mode, live throughput graphs, and automatic organization.
            </p>
            <p className="welcome-desc">
              Simply paste any download link, click any video in your browser, or let the clipboard auto-detector catch copied links. Quantum Downloader will handle the rest with wire-speed acceleration.
            </p>

            <div className="welcome-features-grid">
              <div className="welcome-feature-item">
                <Download size={18} color="#2563eb" />
                <span>Auto-Categorization</span>
              </div>
              <div className="welcome-feature-item">
                <SunMoon size={18} color="#f59e0b" />
                <span>Bright & Dark Themes</span>
              </div>
              <div className="welcome-feature-item">
                <ShieldCheck size={18} color="#16a34a" />
                <span>Real-Time Segment Logs</span>
              </div>
            </div>

            <div className="welcome-actions">
              <button className="welcome-btn-secondary" onClick={() => setStep(2)}>
                <ArrowLeft size={18} />
                <span>Back</span>
              </button>
              <button className="welcome-btn-primary launch-btn" onClick={onFinish}>
                <span>Launch Quantum Downloader 🚀</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
