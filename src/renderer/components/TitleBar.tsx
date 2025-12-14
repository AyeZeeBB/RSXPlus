import React from 'react';
import './TitleBar.css';

export const TitleBar: React.FC = () => {
  return (
    <div className="titlebar">
      <div className="titlebar-drag-region">
        <div className="titlebar-logo">
          <svg className="icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" 
                  stroke="currentColor" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                  fill="none"/>
          </svg>
          <span className="titlebar-title">RSX</span>
        </div>
      </div>
      
      <div className="titlebar-controls">
        <button 
          className="titlebar-button" 
          onClick={() => window.electron.minimize()}
          title="Minimize"
        >
          <svg viewBox="0 0 12 12" fill="currentColor">
            <rect x="1" y="5.5" width="10" height="1" />
          </svg>
        </button>
        <button 
          className="titlebar-button" 
          onClick={() => window.electron.maximize()}
          title="Maximize"
        >
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor">
            <rect x="1.5" y="1.5" width="9" height="9" strokeWidth="1" />
          </svg>
        </button>
        <button 
          className="titlebar-button titlebar-button-close" 
          onClick={() => window.electron.close()}
          title="Close"
        >
          <svg viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.2">
            <line x1="2" y1="2" x2="10" y2="10" />
            <line x1="10" y1="2" x2="2" y2="10" />
          </svg>
        </button>
      </div>
    </div>
  );
};
