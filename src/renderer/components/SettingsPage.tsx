import React, { useState, useEffect } from 'react';
import { useSettingsStore, Settings, NormalRecalcMode, TextureNameMode, ModelExportFormat, TextureExportFormat } from '../stores/settingsStore';
import './SettingsPage.css';

interface SettingsPageProps {
  onBack: () => void;
}

type SettingsTab = 'general' | 'export' | 'preview' | 'advanced';

export const SettingsPage: React.FC<SettingsPageProps> = ({ onBack }) => {
  const { settings, updateSettings, saveSettings, resetSettings } = useSettingsStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [localSettings, setLocalSettings] = useState<Settings>(settings);
  const [hasChanges, setHasChanges] = useState(false);

  // Update local settings when global settings change
  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  // Track changes
  useEffect(() => {
    const changed = JSON.stringify(localSettings) !== JSON.stringify(settings);
    setHasChanges(changed);
  }, [localSettings, settings]);

  const handleSave = async () => {
    updateSettings(localSettings);
    await saveSettings();
    setHasChanges(false);
  };

  const handleReset = () => {
    if (confirm('Are you sure you want to reset all settings to defaults?')) {
      resetSettings();
      setLocalSettings(settings);
    }
  };

  const handleDiscard = () => {
    setLocalSettings(settings);
    setHasChanges(false);
  };

  const updateLocalSetting = <K extends keyof Settings>(
    key: K,
    value: Settings[K]
  ) => {
    setLocalSettings({ ...localSettings, [key]: value });
  };

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <button className="btn btn-ghost back-button" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15,18 9,12 15,6" />
          </svg>
          Back
        </button>
        <h1>Settings</h1>
        <div className="header-actions">
          {hasChanges && (
            <span className="unsaved-indicator">Unsaved changes</span>
          )}
        </div>
      </div>

      <div className="settings-page-body">
        <nav className="settings-nav">
          <button
            className={`settings-nav-item ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            General
          </button>
          <button
            className={`settings-nav-item ${activeTab === 'export' ? 'active' : ''}`}
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
            className={`settings-nav-item ${activeTab === 'preview' ? 'active' : ''}`}
            onClick={() => setActiveTab('preview')}
          >
            <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            Preview
          </button>
          <button
            className={`settings-nav-item ${activeTab === 'advanced' ? 'active' : ''}`}
            onClick={() => setActiveTab('advanced')}
          >
            <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16,18 22,12 16,6" />
              <polyline points="8,6 2,12 8,18" />
            </svg>
            Advanced
          </button>
        </nav>

        <div className="settings-content">
          {activeTab === 'general' && (
            <div className="settings-section">
              <h2>General Settings</h2>
              
              <div className="setting-group">
                <label className="setting-label">Default Export Path</label>
                <p className="setting-description">Choose where exported files are saved by default</p>
                <div className="setting-input-row">
                  <input
                    type="text"
                    value={localSettings.defaultExportPath}
                    onChange={(e) => updateLocalSetting('defaultExportPath', e.target.value)}
                    placeholder="Select a folder..."
                    className="setting-input"
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

              <div className="setting-group">
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={localSettings.rememberLastPath}
                    onChange={(e) => updateLocalSetting('rememberLastPath', e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                  <span className="toggle-label">Remember last used paths</span>
                </label>
                <p className="setting-description">Automatically use the last export location</p>
              </div>

              <div className="setting-group">
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={localSettings.showHiddenAssets}
                    onChange={(e) => updateLocalSetting('showHiddenAssets', e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                  <span className="toggle-label">Show hidden/internal assets</span>
                </label>
                <p className="setting-description">Display internal engine assets that are normally hidden</p>
              </div>

              <div className="setting-group">
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={localSettings.disableCachedNames}
                    onChange={(e) => updateLocalSetting('disableCachedNames', e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                  <span className="toggle-label">Disable cached asset names</span>
                </label>
                <p className="setting-description">Don't load asset names from the cache database</p>
              </div>
            </div>
          )}

          {activeTab === 'export' && (
            <div className="settings-section">
              <h2>Export Settings</h2>

              <h3 className="settings-subsection-title">Path Options</h3>

              <div className="setting-group">
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={localSettings.exportPathsFull}
                    onChange={(e) => updateLocalSetting('exportPathsFull', e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                  <span className="toggle-label">Use full asset paths</span>
                </label>
                <p className="setting-description">Preserve the original directory structure when exporting</p>
              </div>

              <div className="setting-group">
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={localSettings.exportAssetDeps}
                    onChange={(e) => updateLocalSetting('exportAssetDeps', e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                  <span className="toggle-label">Export asset dependencies</span>
                </label>
                <p className="setting-description">Automatically export all dependencies of selected assets</p>
              </div>

              <h3 className="settings-subsection-title">Texture Settings</h3>

              <div className="setting-group">
                <label className="setting-label">Texture Export Format</label>
                <p className="setting-description">Default format when exporting textures</p>
                <select
                  value={localSettings.textureExportFormat}
                  onChange={(e) => updateLocalSetting('textureExportFormat', e.target.value as TextureExportFormat)}
                  className="setting-select"
                >
                  <option value="png_highest">PNG (Highest Mip)</option>
                  <option value="png_all">PNG (All Mips)</option>
                  <option value="dds_highest">DDS (Highest Mip)</option>
                  <option value="dds_all">DDS (All Mips)</option>
                  <option value="dds_mipmapped">DDS (Mip Mapped)</option>
                  <option value="json_meta">JSON (Meta Data)</option>
                </select>
              </div>

              <div className="setting-group">
                <label className="setting-label">Normal Map Recalculation</label>
                <p className="setting-description">Convert normal maps between DirectX and OpenGL formats</p>
                <select
                  value={localSettings.exportNormalRecalc}
                  onChange={(e) => updateLocalSetting('exportNormalRecalc', e.target.value as NormalRecalcMode)}
                  className="setting-select"
                >
                  <option value="none">None</option>
                  <option value="directx">DirectX</option>
                  <option value="opengl">OpenGL</option>
                </select>
              </div>

              <div className="setting-group">
                <label className="setting-label">Texture Naming</label>
                <p className="setting-description">How exported textures should be named</p>
                <select
                  value={localSettings.exportTextureNameMode}
                  onChange={(e) => updateLocalSetting('exportTextureNameMode', e.target.value as TextureNameMode)}
                  className="setting-select"
                >
                  <option value="guid">GUID</option>
                  <option value="real">Real Name</option>
                  <option value="text">Text Name</option>
                  <option value="semantic">Semantic</option>
                </select>
              </div>

              <div className="setting-group">
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={localSettings.exportMaterialTextures}
                    onChange={(e) => updateLocalSetting('exportMaterialTextures', e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                  <span className="toggle-label">Export material textures</span>
                </label>
                <p className="setting-description">Include textures when exporting materials</p>
              </div>

              <h3 className="settings-subsection-title">Model Settings</h3>

              <div className="setting-group">
                <label className="setting-label">Model Export Format</label>
                <p className="setting-description">Default format when exporting 3D models</p>
                <select
                  value={localSettings.modelExportFormat}
                  onChange={(e) => updateLocalSetting('modelExportFormat', e.target.value as ModelExportFormat)}
                  className="setting-select"
                >
                  <option value="cast">Cast</option>
                  <option value="rmax">RMAX</option>
                  <option value="rmdl">RMDL (Raw)</option>
                  <option value="smd">SMD (Source Model)</option>
                </select>
              </div>

              <div className="setting-group">
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={localSettings.exportRigSequences}
                    onChange={(e) => updateLocalSetting('exportRigSequences', e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                  <span className="toggle-label">Export rig sequences</span>
                </label>
                <p className="setting-description">Export animation sequences with models and rigs</p>
              </div>

              <div className="setting-group">
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={localSettings.exportModelSkin}
                    onChange={(e) => updateLocalSetting('exportModelSkin', e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                  <span className="toggle-label">Export selected skin</span>
                </label>
                <p className="setting-description">Export the currently selected skin for models</p>
              </div>

              <div className="setting-group">
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={localSettings.exportModelMatsTruncated}
                    onChange={(e) => updateLocalSetting('exportModelMatsTruncated', e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                  <span className="toggle-label">Truncate material names</span>
                </label>
                <p className="setting-description">Use shortened material names in exported model files</p>
              </div>

              <div className="setting-group">
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={localSettings.exportQCIFiles}
                    onChange={(e) => updateLocalSetting('exportQCIFiles', e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                  <span className="toggle-label">Export QCI files</span>
                </label>
                <p className="setting-description">Split QC into multiple include files</p>
              </div>

              <h3 className="settings-subsection-title">QC Version</h3>

              <div className="setting-group">
                <label className="setting-label">QC Target Version</label>
                <p className="setting-description">Target QC version for model exports</p>
                <div className="setting-input-row">
                  <input
                    type="number"
                    min="1"
                    max="99"
                    value={localSettings.qcMajorVersion}
                    onChange={(e) => updateLocalSetting('qcMajorVersion', parseInt(e.target.value) || 54)}
                    className="setting-input setting-input-sm"
                    placeholder="Major"
                  />
                  <span className="version-separator">.</span>
                  <input
                    type="number"
                    min="0"
                    max="99"
                    value={localSettings.qcMinorVersion}
                    onChange={(e) => updateLocalSetting('qcMinorVersion', parseInt(e.target.value) || 0)}
                    className="setting-input setting-input-sm"
                    placeholder="Minor"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'preview' && (
            <div className="settings-section">
              <h2>Preview Settings</h2>

              <div className="setting-group">
                <label className="setting-label">Model Render Mode</label>
                <p className="setting-description">Choose how 3D models are rendered in the preview</p>
                <select
                  value={localSettings.modelRenderMode}
                  onChange={(e) => updateLocalSetting('modelRenderMode', e.target.value as 'pbr' | 'albedo')}
                  className="setting-select"
                >
                  <option value="pbr">PBR (Full Materials)</option>
                  <option value="albedo">Albedo Only (Simple)</option>
                </select>
                <p className="setting-hint">
                  PBR uses full material properties (normals, roughness, metalness). 
                  Albedo only shows the color texture for faster preview.
                </p>
              </div>

              <div className="setting-group">
                <label className="setting-label">Camera Movement Speed</label>
                <p className="setting-description">Base movement speed in 3D preview (1-200, hold shift for 5x boost)</p>
                <div className="setting-slider-row">
                  <input
                    type="range"
                    min="1"
                    max="200"
                    step="1"
                    value={localSettings.previewMovementSpeed}
                    onChange={(e) => updateLocalSetting('previewMovementSpeed', parseFloat(e.target.value))}
                    className="setting-slider"
                  />
                  <span className="setting-value">{localSettings.previewMovementSpeed.toFixed(0)}</span>
                </div>
              </div>

              <div className="setting-group">
                <label className="setting-label">Cull Distance</label>
                <p className="setting-description">Maximum viewing distance in 3D preview (256-16384)</p>
                <div className="setting-slider-row">
                  <input
                    type="range"
                    min="256"
                    max="16384"
                    step="64"
                    value={localSettings.previewCullDistance}
                    onChange={(e) => updateLocalSetting('previewCullDistance', parseFloat(e.target.value))}
                    className="setting-slider"
                  />
                  <span className="setting-value">{localSettings.previewCullDistance.toFixed(0)}</span>
                </div>
              </div>

              <div className="setting-group">
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={localSettings.showGrid}
                    onChange={(e) => updateLocalSetting('showGrid', e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                  <span className="toggle-label">Show grid in 3D preview</span>
                </label>
                <p className="setting-description">Display a reference grid plane</p>
              </div>

              <div className="setting-group">
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={localSettings.showWireframe}
                    onChange={(e) => updateLocalSetting('showWireframe', e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                  <span className="toggle-label">Show wireframe overlay</span>
                </label>
                <p className="setting-description">Display model wireframe on top of textures</p>
              </div>
            </div>
          )}

          {activeTab === 'advanced' && (
            <div className="settings-section">
              <h2>Advanced Settings</h2>

              <h3 className="settings-subsection-title">Threading</h3>

              <div className="setting-group">
                <label className="setting-label">Export Thread Count</label>
                <p className="setting-description">Number of threads for parallel export operations</p>
                <input
                  type="number"
                  min="1"
                  max="32"
                  value={localSettings.exportThreadCount}
                  onChange={(e) => updateLocalSetting('exportThreadCount', parseInt(e.target.value) || 4)}
                  className="setting-input setting-input-sm"
                />
              </div>

              <div className="setting-group">
                <label className="setting-label">Parse Thread Count</label>
                <p className="setting-description">Number of threads for parsing assets</p>
                <input
                  type="number"
                  min="1"
                  max="32"
                  value={localSettings.parseThreadCount}
                  onChange={(e) => updateLocalSetting('parseThreadCount', parseInt(e.target.value) || 4)}
                  className="setting-input setting-input-sm"
                />
              </div>

              <h3 className="settings-subsection-title">Compression</h3>

              <div className="setting-group">
                <label className="setting-label">Compression Level</label>
                <p className="setting-description">Compression level for exported files</p>
                <select
                  value={localSettings.compressionLevel}
                  onChange={(e) => updateLocalSetting('compressionLevel', parseInt(e.target.value))}
                  className="setting-select"
                >
                  <option value={0}>None</option>
                  <option value={1}>Super Fast</option>
                  <option value={2}>Very Fast</option>
                  <option value={3}>Fast</option>
                  <option value={4}>Normal</option>
                </select>
              </div>

              <h3 className="settings-subsection-title">Performance</h3>

              <div className="setting-group">
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={localSettings.enableCaching}
                    onChange={(e) => updateLocalSetting('enableCaching', e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                  <span className="toggle-label">Enable asset caching</span>
                </label>
                <p className="setting-description">Cache parsed assets for faster repeated access</p>
              </div>

              <div className="setting-group">
                <label className="setting-toggle">
                  <input
                    type="checkbox"
                    checked={localSettings.verboseLogging}
                    onChange={(e) => updateLocalSetting('verboseLogging', e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                  <span className="toggle-label">Enable verbose logging</span>
                </label>
                <p className="setting-description">Log additional debug information to console</p>
              </div>

              <div className="setting-group danger-zone">
                <h3>Danger Zone</h3>
                <button className="btn btn-danger" onClick={handleReset}>
                  Reset All Settings
                </button>
                <p className="setting-description">Reset all settings to their default values</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="settings-page-footer">
        <button 
          className="btn btn-secondary" 
          onClick={handleDiscard}
          disabled={!hasChanges}
        >
          Discard Changes
        </button>
        <button 
          className="btn btn-primary" 
          onClick={handleSave}
          disabled={!hasChanges}
        >
          Save Changes
        </button>
      </div>
    </div>
  );
};
