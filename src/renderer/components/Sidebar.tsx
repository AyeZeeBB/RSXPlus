import React from 'react';
import { useAssetStore } from '../stores/assetStore';
import './Sidebar.css';

interface SidebarProps {
  width: number;
  onWidthChange: (width: number) => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onOpenSettings: () => void;
  onExportAll: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  width,
  onWidthChange,
  onOpenFile,
  onOpenFolder,
  onOpenSettings,
  onExportAll,
}) => {
  const { loadedFiles, assetStats, clearAll } = useAssetStore();

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newWidth = Math.max(200, Math.min(400, startWidth + delta));
      onWidthChange(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <>
      <div className="sidebar" style={{ width }}>
        <div className="sidebar-section">
          <h3 className="sidebar-section-title">Quick Actions</h3>
          <div className="sidebar-actions">
            <button className="btn btn-primary btn-lg sidebar-action" onClick={onOpenFile}>
              <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14,2 14,8 20,8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
              Open File
            </button>
            <button className="btn btn-secondary btn-lg sidebar-action" onClick={onOpenFolder}>
              <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              Open Folder
            </button>
          </div>
        </div>

        {loadedFiles.length > 0 && (
          <>
            <div className="sidebar-section">
              <div className="sidebar-section-header">
                <h3 className="sidebar-section-title">Loaded Files</h3>
                <span className="sidebar-count">{loadedFiles.length}</span>
              </div>
              <div className="sidebar-file-list">
                {loadedFiles.map((file, index) => (
                  <div key={index} className="sidebar-file-item">
                    <svg className="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14,2 14,8 20,8" />
                    </svg>
                    <span className="truncate" title={file}>{file.split(/[/\\]/).pop()}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="sidebar-section">
              <div className="sidebar-section-header">
                <h3 className="sidebar-section-title">Asset Types</h3>
              </div>
              <div className="sidebar-stats">
                {Object.entries(assetStats || {}).map(([type, count]) => (
                  <div key={type} className="sidebar-stat-item">
                    <span className={`badge badge-${type.toLowerCase()}`}>{type}</span>
                    <span className="sidebar-stat-count">{count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="sidebar-footer">
              <button className="btn btn-primary btn-sm" onClick={onExportAll}>
                <svg className="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7,10 12,15 17,10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Export All
              </button>
              <button className="btn btn-ghost btn-sm" onClick={clearAll}>
                <svg className="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3,6 5,6 21,6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                Clear All
              </button>
            </div>
          </>
        )}

        {loadedFiles.length === 0 && (
          <div className="sidebar-empty">
            <p>No files loaded</p>
            <p className="text-muted">
              Open an RPak, model, or audio file to get started
            </p>
          </div>
        )}

        {/* Settings button at bottom */}
        <div className="sidebar-bottom">
          <button className="btn btn-ghost sidebar-settings-btn" onClick={onOpenSettings}>
            <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Settings
          </button>
        </div>
      </div>
      <div className="resizer" onMouseDown={handleResizeStart} />
    </>
  );
};
