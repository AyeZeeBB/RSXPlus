import React, { useState } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import './SettingsModal.css';

interface SettingsModalProps {
  onClose: () => void;
}

type SettingsTab = 'general' | 'export' | 'preview' | 'advanced';

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const { settings, updateSettings, saveSettings } = useSettingsStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [localSettings, setLocalSettings] = useState(settings);

  const handleSave = async () => {
    updateSettings(localSettings);
    await saveSettings();
    onClose();
  };

  const updateLocalSetting = <K extends keyof typeof settings>(
    key: K,
    value: typeof settings[K]
  ) => {
    setLocalSettings({ ...localSettings, [key]: value });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="settings-body">
          <div className="settings-sidebar">
            <button
              className={`settings-tab ${activeTab === 'general' ? 'active' : ''}`}
              onClick={() => setActiveTab('general')}
            >
              <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              General
            </button>
            <button
              className={`settings-tab ${activeTab === 'export' ? 'active' : ''}`}
              onClick={() => setActiveTab('export')}
            >
              <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7,10 12,15 17,10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export
            </button>
            <button
              className={`settings-tab ${activeTab === 'preview' ? 'active' : ''}`}
              onClick={() => setActiveTab('preview')}
            >
              <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Preview
            </button>
            <button
              className={`settings-tab ${activeTab === 'advanced' ? 'active' : ''}`}
              onClick={() => setActiveTab('advanced')}
            >
              <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="16,18 22,12 16,6" />
                <polyline points="8,6 2,12 8,18" />
              </svg>
              Advanced
            </button>
          </div>

          <div className="settings-content">
            {activeTab === 'general' && (
              <div className="settings-section">
                <h3>General Settings</h3>
                
                <div className="settings-group">
                  <label className="settings-label">Default Export Path</label>
                  <div className="settings-input-group">
                    <input
                      type="text"
                      value={localSettings.defaultExportPath}
                      onChange={(e) => updateLocalSetting('defaultExportPath', e.target.value)}
                      placeholder="Select a folder..."
                    />
                    <button
                      className="btn btn-secondary"
                      onClick={async () => {
                        const path = await window.electron.selectFolder();
                        if (path) updateLocalSetting('defaultExportPath', path);
                      }}
                    >
                      Browse
                    </button>
                  </div>
                </div>

                <div className="settings-group">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={localSettings.rememberLastPath}
                      onChange={(e) => updateLocalSetting('rememberLastPath', e.target.checked)}
                    />
                    <span>Remember last used paths</span>
                  </label>
                </div>

                <div className="settings-group">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={localSettings.showHiddenAssets}
                      onChange={(e) => updateLocalSetting('showHiddenAssets', e.target.checked)}
                    />
                    <span>Show hidden/internal assets</span>
                  </label>
                </div>
              </div>
            )}

            {activeTab === 'export' && (
              <div className="settings-section">
                <h3>Export Settings</h3>

                <div className="settings-group">
                  <label className="settings-label">Model Format</label>
                  <select
                    value={localSettings.modelExportFormat}
                    onChange={(e) => updateLocalSetting('modelExportFormat', e.target.value)}
                  >
                    <option value="smd">SMD (Source Model)</option>
                    <option value="cast">Cast</option>
                    <option value="gltf">glTF</option>
                    <option value="fbx">FBX</option>
                  </select>
                </div>

                <div className="settings-group">
                  <label className="settings-label">Texture Format</label>
                  <select
                    value={localSettings.textureExportFormat}
                    onChange={(e) => updateLocalSetting('textureExportFormat', e.target.value)}
                  >
                    <option value="png">PNG</option>
                    <option value="dds">DDS</option>
                    <option value="tga">TGA</option>
                  </select>
                </div>

                <div className="settings-group">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={localSettings.exportMaterialTextures}
                      onChange={(e) => updateLocalSetting('exportMaterialTextures', e.target.checked)}
                    />
                    <span>Export material textures with models</span>
                  </label>
                </div>

                <div className="settings-group">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={localSettings.exportAnimations}
                      onChange={(e) => updateLocalSetting('exportAnimations', e.target.checked)}
                    />
                    <span>Export animations with models</span>
                  </label>
                </div>

                <div className="settings-group">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={localSettings.preserveFolderStructure}
                      onChange={(e) => updateLocalSetting('preserveFolderStructure', e.target.checked)}
                    />
                    <span>Preserve folder structure on export</span>
                  </label>
                </div>
              </div>
            )}

            {activeTab === 'preview' && (
              <div className="settings-section">
                <h3>Preview Settings</h3>

                <div className="settings-group">
                  <label className="settings-label">Camera Speed</label>
                  <input
                    type="range"
                    min="0.1"
                    max="5"
                    step="0.1"
                    value={localSettings.cameraSpeed}
                    onChange={(e) => updateLocalSetting('cameraSpeed', parseFloat(e.target.value))}
                  />
                  <span className="settings-value">{localSettings.cameraSpeed.toFixed(1)}</span>
                </div>

                <div className="settings-group">
                  <label className="settings-label">Render Distance</label>
                  <input
                    type="range"
                    min="100"
                    max="10000"
                    step="100"
                    value={localSettings.renderDistance}
                    onChange={(e) => updateLocalSetting('renderDistance', parseInt(e.target.value))}
                  />
                  <span className="settings-value">{localSettings.renderDistance}</span>
                </div>

                <div className="settings-group">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={localSettings.showGrid}
                      onChange={(e) => updateLocalSetting('showGrid', e.target.checked)}
                    />
                    <span>Show grid in 3D preview</span>
                  </label>
                </div>

                <div className="settings-group">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={localSettings.showWireframe}
                      onChange={(e) => updateLocalSetting('showWireframe', e.target.checked)}
                    />
                    <span>Show wireframe overlay</span>
                  </label>
                </div>

                <div className="settings-group">
                  <label className="settings-label">Model Render Mode</label>
                  <select
                    value={localSettings.modelRenderMode}
                    onChange={(e) => updateLocalSetting('modelRenderMode', e.target.value as 'pbr' | 'albedo')}
                  >
                    <option value="pbr">PBR (Full Materials)</option>
                    <option value="albedo">Albedo Only (Simple)</option>
                  </select>
                  <p className="settings-hint">
                    PBR uses full material properties (normals, roughness, metalness). 
                    Albedo only shows the color/diffuse texture for faster preview.
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'advanced' && (
              <div className="settings-section">
                <h3>Advanced Settings</h3>

                <div className="settings-group">
                  <label className="settings-label">Max Concurrent Threads</label>
                  <input
                    type="number"
                    min="1"
                    max="32"
                    value={localSettings.maxThreads}
                    onChange={(e) => updateLocalSetting('maxThreads', parseInt(e.target.value))}
                  />
                </div>

                <div className="settings-group">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={localSettings.enableCaching}
                      onChange={(e) => updateLocalSetting('enableCaching', e.target.checked)}
                    />
                    <span>Enable asset caching</span>
                  </label>
                </div>

                <div className="settings-group">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={localSettings.verboseLogging}
                      onChange={(e) => updateLocalSetting('verboseLogging', e.target.checked)}
                    />
                    <span>Enable verbose logging</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};
