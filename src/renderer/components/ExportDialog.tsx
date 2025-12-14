import React, { useState, useEffect } from 'react';
import { Asset } from '../types/asset';
import { useSettingsStore } from '../stores/settingsStore';
import { useAssetStore } from '../stores/assetStore';
import { 
  getExportFormats, 
  canExport, 
  exportAsset, 
  exportAssets,
  ExportFormat,
  ExportResult
} from '../services/exportService';
import './ExportDialog.css';

interface ExportDialogProps {
  assets: Asset[];
  allAssets?: Asset[];  // All loaded assets for dependency resolution
  onClose: () => void;
  onExportComplete?: (results: ExportResult[]) => void;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({ 
  assets, 
  allAssets,
  onClose, 
  onExportComplete 
}) => {
  const { settings } = useSettingsStore();
  const { getTextureData } = useAssetStore();
  const [outputPath, setOutputPath] = useState(settings.defaultExportPath || '');
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat | null>(null);
  const [availableFormats, setAvailableFormats] = useState<ExportFormat[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, message: '' });
  const [results, setResults] = useState<ExportResult[]>([]);
  const [showResults, setShowResults] = useState(false);

  // Export options from settings
  const [exportWithDeps, setExportWithDeps] = useState(settings.exportAssetDeps);
  const [useFullPaths, setUseFullPaths] = useState(settings.exportPathsFull);

  // Get unique asset types being exported
  const assetTypes = [...new Set(assets.map(a => a.type))];
  const isSingleType = assetTypes.length === 1;
  const exportableCount = assets.filter(a => canExport(a.type)).length;

  useEffect(() => {
    // Get available formats for the assets
    if (isSingleType) {
      const formats = getExportFormats(assets[0].type);
      setAvailableFormats(formats);
      if (formats.length > 0) {
        setSelectedFormat(formats[0]);
      }
    } else {
      // For mixed types, we'll use default format for each
      setAvailableFormats([]);
      setSelectedFormat(null);
    }
  }, [assets, isSingleType]);

  const handleSelectFolder = async () => {
    const path = await window.electron.selectFolder();
    if (path) {
      setOutputPath(path);
    }
  };

  const handleExport = async () => {
    if (!outputPath) {
      alert('Please select an output folder');
      return;
    }

    setIsExporting(true);
    setProgress({ current: 0, total: assets.length, message: 'Starting export...' });

    try {
      const exportSettings = {
        ...settings,
        exportAssetDeps: exportWithDeps,
        exportPathsFull: useFullPaths,
      };

      if (isSingleType && selectedFormat) {
        // Export all assets with the selected format
        const exportResults: ExportResult[] = [];
        
        for (let i = 0; i < assets.length; i++) {
          setProgress({ 
            current: i + 1, 
            total: assets.length, 
            message: `Exporting ${assets[i].name || `Asset ${i + 1}`}...` 
          });
          
          const result = await exportAsset(
            assets[i],
            selectedFormat,
            outputPath,
            exportSettings,
            undefined,  // onProgress (handled above)
            allAssets,  // Pass all assets for dependency resolution
            getTextureData  // Pass texture data loader for starpak textures
          );
          exportResults.push(result);
        }
        
        setResults(exportResults);
      } else {
        // Export mixed types with default formats
        const exportResults = await exportAssets(
          assets.filter(a => canExport(a.type)),
          outputPath,
          exportSettings,
          (current: number, total: number, message: string) => setProgress({ current, total, message }),
          allAssets,  // Pass all assets for dependency resolution
          getTextureData  // Pass texture data loader for starpak textures
        );
        setResults(exportResults);
      }

      setShowResults(true);
      onExportComplete?.(results);
    } catch (error) {
      setResults([{ success: false, error: `Export failed: ${error}` }]);
      setShowResults(true);
    } finally {
      setIsExporting(false);
    }
  };

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  return (
    <div className="export-dialog-overlay" onClick={onClose}>
      <div className="export-dialog" onClick={e => e.stopPropagation()}>
        <div className="export-dialog-header">
          <h2>Export Assets</h2>
          <button className="export-dialog-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {!showResults ? (
          <>
            <div className="export-dialog-body">
              {/* Asset Summary */}
              <div className="export-section">
                <h3>Selected Assets</h3>
                <div className="export-summary">
                  <div className="export-stat">
                    <span className="stat-value">{assets.length}</span>
                    <span className="stat-label">Total</span>
                  </div>
                  <div className="export-stat">
                    <span className="stat-value">{exportableCount}</span>
                    <span className="stat-label">Exportable</span>
                  </div>
                  <div className="export-stat">
                    <span className="stat-value">{assetTypes.length}</span>
                    <span className="stat-label">{assetTypes.length === 1 ? 'Type' : 'Types'}</span>
                  </div>
                </div>
                {assetTypes.length > 0 && (
                  <div className="export-types">
                    {assetTypes.map(type => (
                      <span key={type} className={`type-badge type-${type}`}>{type}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Output Path */}
              <div className="export-section">
                <h3>Output Location</h3>
                <div className="export-path-row">
                  <input
                    type="text"
                    value={outputPath}
                    onChange={e => setOutputPath(e.target.value)}
                    placeholder="Select output folder..."
                    className="export-path-input"
                  />
                  <button className="btn btn-secondary" onClick={handleSelectFolder}>
                    Browse
                  </button>
                </div>
              </div>

              {/* Format Selection (only for single type) */}
              {isSingleType && availableFormats.length > 0 && (
                <div className="export-section">
                  <h3>Export Format</h3>
                  <div className="export-format-list">
                    {availableFormats.map(format => (
                      <label key={format.id} className="export-format-option">
                        <input
                          type="radio"
                          name="exportFormat"
                          checked={selectedFormat?.id === format.id}
                          onChange={() => setSelectedFormat(format)}
                        />
                        <div className="format-info">
                          <span className="format-name">{format.name}</span>
                          <span className="format-desc">{format.description}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Export Options */}
              <div className="export-section">
                <h3>Export Options</h3>
                <label className="export-option">
                  <input
                    type="checkbox"
                    checked={useFullPaths}
                    onChange={e => setUseFullPaths(e.target.checked)}
                  />
                  <span>Preserve folder structure</span>
                </label>
                <label className="export-option">
                  <input
                    type="checkbox"
                    checked={exportWithDeps}
                    onChange={e => setExportWithDeps(e.target.checked)}
                  />
                  <span>Export dependencies</span>
                </label>
              </div>
            </div>

            <div className="export-dialog-footer">
              <button className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button 
                className="btn btn-primary" 
                onClick={handleExport}
                disabled={!outputPath || exportableCount === 0 || isExporting}
              >
                {isExporting ? 'Exporting...' : `Export ${exportableCount} Asset${exportableCount !== 1 ? 's' : ''}`}
              </button>
            </div>

            {/* Progress Bar */}
            {isExporting && (
              <div className="export-progress">
                <div className="progress-bar">
                  <div 
                    className="progress-fill" 
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
                <div className="progress-text">
                  {progress.message} ({progress.current}/{progress.total})
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="export-dialog-body">
              <div className="export-results">
                <div className="results-summary">
                  <div className={`result-stat ${successCount > 0 ? 'success' : ''}`}>
                    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20,6 9,17 4,12" />
                    </svg>
                    <span className="stat-value">{successCount}</span>
                    <span className="stat-label">Succeeded</span>
                  </div>
                  <div className={`result-stat ${failCount > 0 ? 'error' : ''}`}>
                    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                    <span className="stat-value">{failCount}</span>
                    <span className="stat-label">Failed</span>
                  </div>
                </div>

                {failCount > 0 && (
                  <div className="results-errors">
                    <h4>Errors</h4>
                    <ul className="error-list">
                      {results.filter(r => !r.success).map((result, i) => (
                        <li key={i} className="error-item">
                          {result.error || 'Unknown error'}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {successCount > 0 && outputPath && (
                  <button 
                    className="btn btn-secondary open-folder-btn"
                    onClick={() => window.electron.openPath(outputPath)}
                  >
                    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    Open Output Folder
                  </button>
                )}
              </div>
            </div>

            <div className="export-dialog-footer">
              <button className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
