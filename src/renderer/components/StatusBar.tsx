import React from 'react';
import { useAssetStore } from '../stores/assetStore';
import './StatusBar.css';

export const StatusBar: React.FC = () => {
  const { status, progress } = useAssetStore();

  return (
    <div className="statusbar">
      <div className="statusbar-left">
        {progress !== null && (
          <div className="statusbar-progress">
            <div 
              className="statusbar-progress-bar" 
              style={{ width: `${progress}%` }} 
            />
          </div>
        )}
        <span className="statusbar-message">{status}</span>
      </div>
      
      <div className="statusbar-right">
        <span className="statusbar-item">RSX v1.0.0</span>
      </div>
    </div>
  );
};
