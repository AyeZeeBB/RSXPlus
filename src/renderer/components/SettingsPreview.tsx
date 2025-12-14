import React, { useState, useEffect, useMemo } from 'react';
import { Asset, AssetDependency } from '../types/asset';
import { 
  parseSettingsHeader, 
  ParsedSettingsAsset, 
  getSettingsDisplayInfo,
  parseSettingsLayoutFull,
  parseSettingsValuesFull,
  SettingsLayoutField,
  SettingsValue,
  SettingsModTypeNames
} from '../parsers/settingsParser';
import { useAssetStore } from '../stores/assetStore';
import './SettingsPreview.css';

interface SettingsPreviewProps {
  asset: Asset;
}

export const SettingsPreview: React.FC<SettingsPreviewProps> = ({ asset }) => {
  const [parsed, setParsed] = useState<ParsedSettingsAsset | null>(null);
  const [layoutAsset, setLayoutAsset] = useState<Asset | null>(null);
  const [parsedValues, setParsedValues] = useState<SettingsValue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { assets, getParser } = useAssetStore();

  useEffect(() => {
    // Get header data from metadata (where fileLoader stores it)
    const rawHeaderData = asset.metadata?.headerData;
    
    if (!rawHeaderData) {
      setError('No header data available');
      return;
    }

    // Convert Uint8Array to ArrayBuffer if needed
    let headerData: ArrayBuffer;
    if (rawHeaderData instanceof ArrayBuffer) {
      headerData = rawHeaderData;
    } else if (rawHeaderData instanceof Uint8Array) {
      headerData = rawHeaderData.buffer.slice(
        rawHeaderData.byteOffset,
        rawHeaderData.byteOffset + rawHeaderData.byteLength
      );
    } else {
      setError('Invalid header data type');
      return;
    }

    try {
      const result = parseSettingsHeader(headerData, asset.version || 1);
      setParsed(result);
      setError(null);

      // Try to find the layout asset
      if (result?.header.layoutGuid) {
        const layoutGuidClean = result.header.layoutGuid.replace('0x', '').toLowerCase();
        const found = assets.find(a => 
          a.type === 'stlt' && 
          a.guid.replace('0x', '').toLowerCase() === layoutGuidClean
        );
        setLayoutAsset(found || null);
      }
    } catch (err) {
      console.error('Failed to parse settings:', err);
      setError(err instanceof Error ? err.message : 'Parse error');
    }
  }, [asset, assets]);

  // Parse values when we have a layout asset
  useEffect(() => {
    if (!layoutAsset || !asset.metadata?.headerData) {
      setParsedValues([]);
      return;
    }

    const parser = getParser(asset.containerFile);
    const layoutParser = getParser(layoutAsset.containerFile);
    if (!parser || !layoutParser) {
      setParsedValues([]);
      return;
    }

    // Parse the layout to get field definitions
    const layoutHeaderData = layoutAsset.metadata?.headerData;
    const layoutDataPageData = layoutAsset.metadata?.dataPageData as Uint8Array | undefined;
    
    if (!layoutHeaderData) {
      setParsedValues([]);
      return;
    }

    let layoutHeaderU8: Uint8Array;
    if (layoutHeaderData instanceof Uint8Array) {
      layoutHeaderU8 = layoutHeaderData;
    } else {
      layoutHeaderU8 = new Uint8Array(layoutHeaderData as ArrayBuffer);
    }

    const layoutResult = parseSettingsLayoutFull(
      layoutHeaderU8,
      layoutDataPageData,
      (pageIndex: number) => layoutParser.getPageData(pageIndex)
    );

    if (!layoutResult || layoutResult.fields.length === 0) {
      setParsedValues([]);
      return;
    }

    // Parse values from the settings asset
    const stgsHeaderData = asset.metadata.headerData;
    const stgsDataPageData = asset.metadata.dataPageData as Uint8Array | undefined;
    
    let stgsHeaderU8: Uint8Array;
    if (stgsHeaderData instanceof Uint8Array) {
      stgsHeaderU8 = stgsHeaderData;
    } else {
      stgsHeaderU8 = new Uint8Array(stgsHeaderData as ArrayBuffer);
    }

    const values = parseSettingsValuesFull(
      stgsHeaderU8,
      stgsDataPageData,
      asset.version || 1,
      layoutResult.fields,
      (pageIndex: number) => parser.getPageData(pageIndex),
      layoutResult.subLayouts
    );

    setParsedValues(values);
  }, [layoutAsset, asset, getParser]);

  const displayInfo = useMemo(() => {
    if (!parsed) return null;
    return getSettingsDisplayInfo(parsed);
  }, [parsed]);

  // Helper to render a value based on its type
  const renderValue = (val: SettingsValue): React.ReactNode => {
    if (val.value === null || val.value === undefined) {
      return <span className="value-null">null</span>;
    }

    switch (val.type) {
      case 0: // Bool
        return <span className={`value-bool ${val.value ? 'true' : 'false'}`}>{String(val.value)}</span>;
      
      case 1: // Integer
        return <span className="value-number">{val.value}</span>;
      
      case 2: // Float
        return <span className="value-number">{typeof val.value === 'number' ? val.value.toFixed(4) : val.value}</span>;
      
      case 3: // Float2
        if (typeof val.value === 'object' && 'x' in val.value) {
          return <span className="value-vector">&lt;{val.value.x.toFixed(2)}, {val.value.y.toFixed(2)}&gt;</span>;
        }
        return <span className="value-raw">{String(val.value)}</span>;
      
      case 4: // Float3
        if (typeof val.value === 'object' && 'x' in val.value) {
          return <span className="value-vector">&lt;{val.value.x.toFixed(2)}, {val.value.y.toFixed(2)}, {val.value.z.toFixed(2)}&gt;</span>;
        }
        return <span className="value-raw">{String(val.value)}</span>;
      
      case 5: // String
      case 6: // Asset
      case 7: // AssetNoPrecache
        return <span className="value-string">"{val.value}"</span>;
      
      case 8: // Array
      case 9: // ArrayDynamic
        if (val.arrayElements && val.arrayElements.length > 0) {
          return (
            <div className="value-array-expanded">
              <span className="array-header">{val.value}</span>
              <div className="array-elements">
                {val.arrayElements.map((elem, elemIdx) => (
                  <div key={elemIdx} className="array-element">
                    <span className="element-index">[{elemIdx}]</span>
                    <div className="element-fields">
                      {elem.map((field, fieldIdx) => (
                        <div key={fieldIdx} className="element-field">
                          <span className="element-field-name">{field.name}</span>
                          <span className="element-field-type">{field.typeName}</span>
                          <span className="element-field-value">{renderValue(field)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        }
        return <span className="value-array">{val.value}</span>;
      
      default:
        return <span className="value-raw">{String(val.value)}</span>;
    }
  };

  if (error) {
    return (
      <div className="settings-preview">
        <div className="settings-error">
          <span className="error-icon">⚠️</span>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!parsed || !displayInfo) {
    return (
      <div className="settings-preview">
        <div className="settings-loading">Loading settings data...</div>
      </div>
    );
  }

  return (
    <div className="settings-preview">
      <div className="settings-header">
        <div className="settings-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </div>
        <div className="settings-title">
          <h3>Settings Asset</h3>
          <span className="settings-name">{asset.name}</span>
        </div>
      </div>

      <div className="settings-content">
        {/* Properties */}
        <div className="settings-section">
          <h4>Properties</h4>
          <div className="settings-properties">
            {displayInfo.properties.map((prop, idx) => (
              <div className="settings-property" key={idx}>
                <span className="property-label">{prop.label}</span>
                <span className={`property-value ${prop.mono ? 'mono' : ''}`}>
                  {prop.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Layout Reference */}
        <div className="settings-section">
          <h4>Layout Schema</h4>
          <div className="settings-layout-ref">
            {layoutAsset ? (
              <div className="layout-found">
                <span className="layout-badge stlt">stlt</span>
                <span className="layout-name">{layoutAsset.name}</span>
                <span className="layout-status found">✓ Found</span>
              </div>
            ) : (
              <div className="layout-missing">
                <span className="layout-badge stlt">stlt</span>
                <span className="layout-guid mono">{parsed.header.layoutGuid}</span>
                <span className="layout-status missing">Not loaded</span>
              </div>
            )}
          </div>
        </div>

        {/* Modifications Summary */}
        <div className="settings-section">
          <h4>Modifications</h4>
          <div className="settings-mods-summary">
            <span className="mods-text">{displayInfo.modSummary}</span>
            {parsed.header.singlePlayerModCount > 0 && (
              <span className="mods-sp-badge">
                {parsed.header.singlePlayerModCount} SP mods
              </span>
            )}
          </div>

          {/* Mod Names */}
          {parsed.modNames.length > 0 && (
            <div className="settings-mod-names">
              <h5>Mod Names</h5>
              <div className="mod-names-list">
                {parsed.modNames.map((name, idx) => (
                  <span className="mod-name" key={idx}>{name}</span>
                ))}
              </div>
            </div>
          )}

          {/* Mod Values */}
          {parsed.modValues.length > 0 && (
            <div className="settings-mod-values">
              <h5>Mod Values</h5>
              <div className="mod-values-list">
                {parsed.modValues.slice(0, 20).map((mod, idx) => (
                  <div className="mod-value-item" key={idx}>
                    <span className="mod-index">#{idx}</span>
                    <span className="mod-type-badge">{mod.typeName}</span>
                    {mod.name && <span className="mod-name">{mod.name}</span>}
                    <span className="mod-value">
                      {mod.value.bool !== undefined && String(mod.value.bool)}
                      {mod.value.int !== undefined && mod.value.int}
                      {mod.value.float !== undefined && mod.value.float.toFixed(4)}
                      {mod.value.string !== undefined && `"${mod.value.string}"`}
                    </span>
                  </div>
                ))}
                {parsed.modValues.length > 20 && (
                  <div className="mod-values-more">
                    +{parsed.modValues.length - 20} more modifications
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Data Info */}
        <div className="settings-section">
          <h4>Data</h4>
          <div className="settings-data-info">
            <div className="data-stat">
              <span className="data-label">Value Buffer</span>
              <span className="data-value">{parsed.header.valueBufSize} bytes</span>
            </div>
            <div className="data-stat">
              <span className="data-label">Mod Names</span>
              <span className="data-value">{parsed.header.modNameCount}</span>
            </div>
            <div className="data-stat">
              <span className="data-label">Mod Values</span>
              <span className="data-value">{parsed.header.modValuesCount}</span>
            </div>
          </div>
        </div>

        {/* Parsed Values */}
        {layoutAsset && (
          <div className="settings-section">
            <h4>Values {parsedValues.length > 0 && `(${parsedValues.length})`}</h4>
            {parsedValues.length > 0 ? (
              <div className="settings-values-list">
                {parsedValues.slice(0, 50).map((val, idx) => (
                  <div className="settings-value-item" key={idx}>
                    <span className="value-name">{val.name}</span>
                    <span className={`value-type type-${val.type}`}>{val.typeName}</span>
                    <span className="value-content">
                      {renderValue(val)}
                    </span>
                  </div>
                ))}
                {parsedValues.length > 50 && (
                  <div className="values-more">
                    +{parsedValues.length - 50} more values
                  </div>
                )}
              </div>
            ) : (
              <div className="settings-values-placeholder">
                <span className="placeholder-icon">📋</span>
                <span className="placeholder-text">
                  Could not parse values from layout.
                  <br />
                  Layout: {layoutAsset.name}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
