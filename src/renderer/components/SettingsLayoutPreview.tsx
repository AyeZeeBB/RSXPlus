import React, { useState, useEffect, useMemo } from 'react';
import { Asset } from '../types/asset';
import { 
  parseSettingsLayoutHeader, 
  parseSettingsLayoutFull,
  SettingsLayoutHeader,
  SettingsLayoutField,
  SettingsFieldType,
  SettingsFieldTypeNames
} from '../parsers/settingsParser';
import { useAssetStore } from '../stores/assetStore';
import './SettingsLayoutPreview.css';

interface SettingsLayoutPreviewProps {
  asset: Asset;
}

export const SettingsLayoutPreview: React.FC<SettingsLayoutPreviewProps> = ({ asset }) => {
  const [parsed, setParsed] = useState<SettingsLayoutHeader | null>(null);
  const [parsedFields, setParsedFields] = useState<SettingsLayoutField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [usedByAssets, setUsedByAssets] = useState<Asset[]>([]);
  const { assets, getParser } = useAssetStore();

  useEffect(() => {
    // Get header data from metadata
    const rawHeaderData = asset.metadata?.headerData;
    const dataPageData = asset.metadata?.dataPageData as Uint8Array | undefined;
    
    if (!rawHeaderData) {
      setError('No header data available');
      return;
    }

    // Get the parser to access page data
    const parser = getParser(asset.containerFile);

    // Convert Uint8Array to ArrayBuffer if needed
    let headerData: ArrayBuffer;
    let headerDataU8: Uint8Array;
    if (rawHeaderData instanceof ArrayBuffer) {
      headerData = rawHeaderData;
      headerDataU8 = new Uint8Array(rawHeaderData);
    } else if (rawHeaderData instanceof Uint8Array) {
      headerDataU8 = rawHeaderData;
      headerData = rawHeaderData.buffer.slice(
        rawHeaderData.byteOffset,
        rawHeaderData.byteOffset + rawHeaderData.byteLength
      );
    } else {
      setError('Invalid header data type');
      return;
    }

    try {
      const result = parseSettingsLayoutHeader(headerData);
      setParsed(result);
      setError(null);
      
      // Try to parse fields with page data
      if (parser) {
        const fullResult = parseSettingsLayoutFull(
          headerDataU8,
          dataPageData,
          (pageIndex: number) => parser.getPageData(pageIndex)
        );
        if (fullResult && fullResult.fields.length > 0) {
          setParsedFields(fullResult.fields);
        }
      }
    } catch (err) {
      console.error('Failed to parse settings layout:', err);
      setError(err instanceof Error ? err.message : 'Parse error');
    }
  }, [asset, getParser]);

  // Find stgs assets that use this layout
  useEffect(() => {
    const layoutGuid = asset.guid.replace('0x', '').toLowerCase();
    const usedBy = assets.filter(a => {
      if (a.type !== 'stgs') return false;
      const rawHeaderData = a.metadata?.headerData;
      if (!rawHeaderData) return false;
      
      // Convert to ArrayBuffer if needed
      let headerData: ArrayBuffer;
      if (rawHeaderData instanceof ArrayBuffer) {
        headerData = rawHeaderData;
      } else if (rawHeaderData instanceof Uint8Array) {
        headerData = rawHeaderData.buffer.slice(
          rawHeaderData.byteOffset,
          rawHeaderData.byteOffset + rawHeaderData.byteLength
        );
      } else {
        return false;
      }
      
      if (headerData.byteLength < 8) return false;
      
      // Read the layout GUID from the stgs header (first 8 bytes - it's a uint64)
      const view = new DataView(headerData);
      const layoutGuidValue = view.getBigUint64(0, true);
      const stgsLayoutGuid = layoutGuidValue.toString(16).padStart(16, '0').toLowerCase();
      
      return stgsLayoutGuid === layoutGuid;
    });
    
    setUsedByAssets(usedBy.slice(0, 50)); // Limit to 50
  }, [asset.guid, assets]);

  if (error) {
    return (
      <div className="settings-layout-preview">
        <div className="layout-error">
          <span className="error-icon">⚠️</span>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!parsed) {
    return (
      <div className="settings-layout-preview">
        <div className="layout-loading">Loading layout data...</div>
      </div>
    );
  }

  return (
    <div className="settings-layout-preview">
      <div className="layout-header">
        <div className="layout-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="9" y1="21" x2="9" y2="9" />
          </svg>
        </div>
        <div className="layout-title">
          <h3>Settings Layout</h3>
          <span className="layout-name">{asset.name}</span>
        </div>
      </div>

      <div className="layout-content">
        {/* Schema Properties */}
        <div className="layout-section">
          <h4>Schema Properties</h4>
          <div className="layout-properties">
            <div className="layout-property">
              <span className="prop-label">Field Count</span>
              <span className="prop-value">{parsed.fieldCount}</span>
            </div>
            <div className="layout-property">
              <span className="prop-label">Hash Table Size</span>
              <span className="prop-value">{parsed.hashTableSize}</span>
            </div>
            <div className="layout-property">
              <span className="prop-label">Total Buffer Size</span>
              <span className="prop-value">{parsed.totalBufferSize} bytes</span>
            </div>
            <div className="layout-property">
              <span className="prop-label">Array Value Count</span>
              <span className="prop-value">{parsed.arrayValueCount}</span>
            </div>
            <div className="layout-property">
              <span className="prop-label">Hash Seed</span>
              <span className="prop-value mono">0x{parsed.hashSeed.toString(16).toUpperCase()}</span>
            </div>
            <div className="layout-property">
              <span className="prop-label">Hash Step Scale</span>
              <span className="prop-value">{parsed.hashStepScale}</span>
            </div>
          </div>
        </div>

        {/* Fields */}
        <div className="layout-section">
          <h4>Fields ({parsedFields.length > 0 ? parsedFields.length : parsed.fieldCount})</h4>
          {parsedFields.length > 0 ? (
            <div className="layout-fields">
              {parsedFields.map((field, idx) => (
                <div className="layout-field" key={idx}>
                  <span className="field-name">{field.name || `[Field ${idx}]`}</span>
                  <span className={`field-type type-${field.dataType}`}>
                    {field.typeName}
                  </span>
                  <span className="field-offset mono">+0x{field.valueOffset.toString(16)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="layout-fields-placeholder">
              Field definitions require page data parsing.
              <br />
              {parsed.fieldCount} fields defined in layout.
            </div>
          )}
        </div>

        {/* Used By */}
        <div className="layout-section">
          <h4>Used By ({usedByAssets.length} settings assets)</h4>
          {usedByAssets.length > 0 ? (
            <div className="layout-used-by">
              {usedByAssets.slice(0, 20).map((stgs, idx) => (
                <div className="used-by-item" key={idx}>
                  <span className="used-by-badge">stgs</span>
                  <span className="used-by-name">{stgs.name}</span>
                </div>
              ))}
              {usedByAssets.length > 20 && (
                <div className="used-by-more">
                  +{usedByAssets.length - 20} more assets
                </div>
              )}
            </div>
          ) : (
            <div className="layout-no-usage">
              No loaded stgs assets use this layout
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
