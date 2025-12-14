import React, { useRef, useEffect, useState, useMemo } from 'react';
import * as THREE from 'three';
import { Asset, AssetType, AssetDependency } from '../types/asset';
import { TextureFormatNames, TextureAssetHeader } from '../parsers/textureParser';
import { parseMaterialHeader, MaterialTypeNames, TextureSlotNames } from '../parsers/materialParser';
import { TexturePreview } from './TexturePreview';
import { ModelPreview } from './ModelPreview';
import { MaterialPreview } from './MaterialPreview';
import { ShaderPreview } from './ShaderPreview';
import { SettingsPreview } from './SettingsPreview';
import { SettingsLayoutPreview } from './SettingsLayoutPreview';
import { TextureAnimPreview } from './TextureAnimPreview';
import { DatatablePreview } from './DatatablePreview';
import { AnimRigPreview } from './AnimRigPreview';
import { AnimSeqPreview } from './AnimSeqPreview';
import { UIImagePreview } from './UIImagePreview';
import { EffectPreview } from './EffectPreview';
import { ExportDialog } from './ExportDialog';
import { useAssetStore } from '../stores/assetStore';
import './PreviewPanel.css';

interface PreviewPanelProps {
  asset: Asset | null;
}

export const PreviewPanel: React.FC<PreviewPanelProps> = ({ asset }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [activeTab, setActiveTab] = useState<'preview' | 'details' | 'dependencies'>('preview');
  const [showExportDialog, setShowExportDialog] = useState(false);
  const { assets: allAssets, getParser } = useAssetStore();
  const [resolvedDependencies, setResolvedDependencies] = useState<AssetDependency[]>([]);
  const [resolvedDependents, setResolvedDependents] = useState<AssetDependency[]>([]);

  // Resolve dependencies and dependents when asset changes
  useEffect(() => {
    if (!asset || asset.containerType !== 'pak') {
      setResolvedDependencies([]);
      setResolvedDependents([]);
      return;
    }

    const metadata = asset.metadata || {};
    const dependenciesCount = (metadata.dependenciesCount as number) || 0;

    // Get the parser for this asset's container
    const parser = getParser(asset.containerFile);
    if (!parser) {
      setResolvedDependencies([]);
      setResolvedDependents([]);
      return;
    }

    // Find the parsed asset to get dependencies
    const parsedAsset = parser.findAssetByGuid(asset.guid);
    if (!parsedAsset) {
      setResolvedDependencies([]);
      setResolvedDependents([]);
      return;
    }

    // ==========================================
    // RESOLVE DEPENDENCIES (what this asset uses)
    // ==========================================
    if (dependenciesCount > 0) {
      // Get dependency GUIDs from parser
      const depGuids = parser.getAssetDependencies(parsedAsset);
      
      // Resolve each dependency - check if it's loaded
      const deps: AssetDependency[] = depGuids.map(dep => {
        // Look for this asset in all loaded assets
        const normalizedGuid = dep.guid.toUpperCase();
        const loadedAsset = allAssets.find(a => a.guid.toUpperCase() === normalizedGuid);
        
        if (loadedAsset) {
          return {
            guid: dep.guid,
            type: loadedAsset.type,
            name: loadedAsset.name,
            status: 'loaded' as const,
          };
        }
        
        // Check if it's in the same rpak (resolved but not yet fully loaded)
        const parsedDep = parser.findAssetByGuid(dep.guid);
        if (parsedDep) {
          return {
            guid: dep.guid,
            type: parsedDep.typeFourCC as AssetType,
            name: parsedDep.name,
            status: 'loaded' as const,
          };
        }
        
        // External/missing dependency
        return {
          guid: dep.guid,
          type: 'unkn' as AssetType,
          name: undefined,
          status: 'external' as const,
        };
      });

      setResolvedDependencies(deps);
    } else {
      setResolvedDependencies([]);
    }

    // ==========================================
    // RESOLVE DEPENDENTS (what uses this asset)
    // ==========================================
    // Find all assets that have this asset in their dependencies
    const thisGuid = asset.guid.toUpperCase();
    const dependents: AssetDependency[] = [];
    
    // Get all parsed assets from the parser
    const allParsedAssets = parser.getAssets();
    
    for (const otherAsset of allParsedAssets) {
      if (otherAsset.guid === parsedAsset.guid) continue; // Skip self
      if (otherAsset.dependenciesCount === 0) continue;
      
      // Get this asset's dependencies and check if our asset is in there
      const otherDeps = parser.getAssetDependencies(otherAsset);
      const dependsOnUs = otherDeps.some(d => d.guid.toUpperCase() === thisGuid);
      
      if (dependsOnUs) {
        // Look for this asset in all loaded assets
        const loadedAsset = allAssets.find(a => a.guid.toUpperCase() === otherAsset.guid);
        
        dependents.push({
          guid: otherAsset.guid,
          type: otherAsset.typeFourCC as AssetType,
          name: loadedAsset?.name || otherAsset.name,
          status: 'loaded' as const,
        });
      }
    }
    
    setResolvedDependents(dependents);
  }, [asset, allAssets, getParser]);

  const renderPreviewContent = () => {
    if (!asset) {
      return (
        <div className="preview-empty">
          <svg className="preview-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          <p>Select an asset to preview</p>
        </div>
      );
    }

    switch (asset.type) {
      case 'mdl_':
      case 'mdl':
        return <ModelPreview asset={asset} />;
        
      case 'txtr':
        return <TexturePreview asset={asset} />;
        
      case 'matl':
        return <MaterialPreview asset={asset} />;
        
      case 'arig':
        return <AnimRigPreview asset={asset} />;
        
      case 'aseq':
        return <AnimSeqPreview asset={asset} />;
        
      case 'shdr':
      case 'shds':
        return <ShaderPreview asset={asset} />;
      
      case 'stgs':
        return <SettingsPreview asset={asset} />;
      
      case 'stlt':
        return <SettingsLayoutPreview asset={asset} />;
      
      case 'txan':
        return <TextureAnimPreview asset={asset} />;
        
      case 'dtbl':
        return <DatatablePreview asset={asset} />;
        
      case 'uimg':
      case 'uiia':
        return <UIImagePreview asset={asset} />;
      
      case 'efct':
        return <EffectPreview asset={asset} />;
        
      default:
        return (
          <div className="preview-unsupported">
            <svg className="preview-unsupported-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <p>Preview not available</p>
            <p className="text-muted">Asset type: {asset.type}</p>
          </div>
        );
    }
  };

  const renderDetails = () => {
    if (!asset) return null;

    // Extract additional info from metadata with proper types
    const metadata = asset.metadata || {} as Record<string, any>;

    return (
      <div className="preview-details">
        <div className="detail-group">
          <h4>Asset Information</h4>
          <div className="detail-row">
            <span className="detail-label">Name</span>
            <span className="detail-value truncate" title={asset.name}>{asset.name}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Type</span>
            <span className="detail-value">{asset.type}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">GUID</span>
            <span className="detail-value mono">{asset.guid}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Container</span>
            <span className="detail-value truncate" title={asset.containerFile}>{asset.containerFile}</span>
          </div>
          {asset.version && (
            <div className="detail-row">
              <span className="detail-label">Version</span>
              <span className="detail-value">{asset.version}</span>
            </div>
          )}
        </div>

        {/* Page Pointers */}
        {Boolean(metadata.headPagePtr) && (
          <div className="detail-group">
            <h4>Data Location</h4>
            <div className="detail-row">
              <span className="detail-label">Header Page</span>
              <span className="detail-value mono">
                Page {(metadata.headPagePtr as any).index}, Offset 0x{((metadata.headPagePtr as any).offset || 0).toString(16).toUpperCase()}
              </span>
            </div>
            {Boolean(metadata.dataPagePtr) && (
              <div className="detail-row">
                <span className="detail-label">Data Page</span>
                <span className="detail-value mono">
                  Page {(metadata.dataPagePtr as any).index}, Offset 0x{((metadata.dataPagePtr as any).offset || 0).toString(16).toUpperCase()}
                </span>
              </div>
            )}
            {metadata.headerSize !== undefined && (
              <div className="detail-row">
                <span className="detail-label">Header Size</span>
                <span className="detail-value">{String(metadata.headerSize)} bytes</span>
              </div>
            )}
          </div>
        )}

        {/* Starpak info */}
        {metadata.starpakOffset && BigInt(metadata.starpakOffset as any) !== 0n && (
          <div className="detail-group">
            <h4>Streaming</h4>
            <div className="detail-row">
              <span className="detail-label">Starpak Offset</span>
              <span className="detail-value mono">0x{BigInt(metadata.starpakOffset as any).toString(16).toUpperCase()}</span>
            </div>
          </div>
        )}

        {/* Dependency counts */}
        {(metadata.dependentsCount !== undefined || metadata.dependenciesCount !== undefined) && (
          <div className="detail-group">
            <h4>References</h4>
            {metadata.dependentsCount !== undefined && (
              <div className="detail-row">
                <span className="detail-label">Dependents</span>
                <span className="detail-value">{String(metadata.dependentsCount)}</span>
              </div>
            )}
            {metadata.dependenciesCount !== undefined && (
              <div className="detail-row">
                <span className="detail-label">Dependencies</span>
                <span className="detail-value">{String(metadata.dependenciesCount)}</span>
              </div>
            )}
          </div>
        )}

        {/* Type-specific metadata */}
        {Object.keys(metadata).filter(k => !['headPagePtr', 'dataPagePtr', 'headerSize', 'starpakOffset', 'optStarpakOffset', 'dependentsCount', 'dependenciesCount', 'pageEnd'].includes(k)).length > 0 && (
          <div className="detail-group">
            <h4>Additional Info</h4>
            {Object.entries(metadata)
              .filter(([key]) => !['headPagePtr', 'dataPagePtr', 'headerSize', 'starpakOffset', 'optStarpakOffset', 'dependentsCount', 'dependenciesCount', 'pageEnd'].includes(key))
              .map(([key, value]) => (
              <div className="detail-row" key={key}>
                <span className="detail-label">{key}</span>
                <span className="detail-value">{typeof value === 'bigint' ? `0x${value.toString(16).toUpperCase()}` : String(value)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderDependencies = () => {
    if (!asset) return null;

    const metadata = asset.metadata || {};
    const dependenciesCount = (metadata.dependenciesCount as number) || 0;
    const dependentsCount = (metadata.dependentsCount as number) || 0;

    return (
      <div className="preview-dependencies">
        <div className="dependencies-summary">
          <div className="dep-stat">
            <span className="dep-stat-value">{dependenciesCount}</span>
            <span className="dep-stat-label">Dependencies</span>
          </div>
          <div className="dep-stat">
            <span className="dep-stat-value">{dependentsCount}</span>
            <span className="dep-stat-label">Dependents</span>
          </div>
        </div>

        {resolvedDependencies.length > 0 ? (
          <>
            <h4>Dependencies</h4>
            <div className="dependency-list">
              {resolvedDependencies.map((dep, index) => (
                <div key={index} className={`dependency-item ${dep.status}`}>
                  <div className="dep-info">
                    <span className="dep-name">{dep.name || `0x${dep.guid}`}</span>
                    <span className="dep-guid mono">0x{dep.guid}</span>
                  </div>
                  <div className="dep-meta">
                    <span className={`badge badge-sm ${dep.status === 'loaded' ? 'badge-success' : dep.status === 'missing' ? 'badge-error' : 'badge-warning'}`}>
                      {dep.status}
                    </span>
                    <span className="badge badge-sm">{dep.type}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : dependenciesCount > 0 ? (
          <div className="preview-info">
            <p>This asset has {dependenciesCount} dependencies.</p>
            <p className="text-muted">Loading dependencies...</p>
          </div>
        ) : (
          <div className="preview-info">
            <p>No dependencies</p>
            <p className="text-muted">This asset doesn't reference other assets.</p>
          </div>
        )}

        {/* Dependents Section */}
        {resolvedDependents.length > 0 ? (
          <>
            <h4>Dependents</h4>
            <div className="dependency-list">
              {resolvedDependents.map((dep, index) => (
                <div key={index} className={`dependency-item ${dep.status}`}>
                  <div className="dep-info">
                    <span className="dep-name">{dep.name || `0x${dep.guid}`}</span>
                    <span className="dep-guid mono">0x{dep.guid}</span>
                  </div>
                  <div className="dep-meta">
                    <span className={`badge badge-sm ${dep.status === 'loaded' ? 'badge-success' : dep.status === 'missing' ? 'badge-error' : 'badge-warning'}`}>
                      {dep.status}
                    </span>
                    <span className="badge badge-sm">{dep.type}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : dependentsCount > 0 ? (
          <div className="preview-info">
            <p>This asset has {dependentsCount} dependents.</p>
            <p className="text-muted">Loading dependents...</p>
          </div>
        ) : (
          <div className="preview-info">
            <p>No dependents</p>
            <p className="text-muted">No other assets reference this asset.</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="preview-panel">
      <div className="preview-header">
        <div className="preview-tabs">
          <button
            className={`preview-tab ${activeTab === 'preview' ? 'active' : ''}`}
            onClick={() => setActiveTab('preview')}
          >
            Preview
          </button>
          <button
            className={`preview-tab ${activeTab === 'details' ? 'active' : ''}`}
            onClick={() => setActiveTab('details')}
          >
            Details
          </button>
          <button
            className={`preview-tab ${activeTab === 'dependencies' ? 'active' : ''}`}
            onClick={() => setActiveTab('dependencies')}
          >
            Dependencies
          </button>
        </div>

        {asset && (
          <div className="preview-actions">
            <button className="btn btn-primary btn-sm" onClick={() => setShowExportDialog(true)}>
              <svg className="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7,10 12,15 17,10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export
            </button>
          </div>
        )}
      </div>

      <div className="preview-content">
        {activeTab === 'preview' && renderPreviewContent()}
        {activeTab === 'details' && renderDetails()}
        {activeTab === 'dependencies' && renderDependencies()}
      </div>

      {/* Export Dialog */}
      {showExportDialog && asset && (
        <ExportDialog
          assets={[asset]}
          allAssets={allAssets}
          onClose={() => setShowExportDialog(false)}
        />
      )}
    </div>
  );
};
