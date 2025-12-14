import React from 'react';
import './AboutModal.css';

interface AboutModalProps {
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ onClose }) => {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal about-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>About RSX</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-content about-content">
          <div className="about-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>

          <h1 className="about-title">reSource Xtractor</h1>
          <p className="about-version">Version 1.0.0 (Electron)</p>

          <p className="about-description">
            RSX is an asset extraction tool for games made with the Respawn Source Engine
            (Titanfall, Titanfall 2, Apex Legends).
          </p>

          <div className="about-features">
            <h3>Supported Formats</h3>
            <ul>
              <li>RPak files and contained assets</li>
              <li>StarPak streaming files</li>
              <li>Models (MDL, animations, rigs)</li>
              <li>Textures and materials</li>
              <li>Audio banks (MBNK)</li>
              <li>BSP maps</li>
              <li>Bluepoint Pak files</li>
            </ul>
          </div>

          <div className="about-links">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                require('electron').shell.openExternal('https://github.com/r-ex/rsx');
              }}
            >
              <svg className="icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              GitHub
            </a>
          </div>

          <p className="about-license">
            Licensed under AGPLv3. By using this software, you acknowledge that the software
            is provided "as is", without any representations, warranties, conditions, or
            liabilities, to the extent permitted by law.
          </p>
        </div>
      </div>
    </div>
  );
};
