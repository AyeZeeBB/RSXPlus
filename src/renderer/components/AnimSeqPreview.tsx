import React, { useMemo } from 'react';
import { Asset } from '../types/asset';
import { useAssetStore } from '../stores/assetStore';
import './AnimSeqPreview.css';

interface AnimSeqPreviewProps {
  asset: Asset;
}

interface ParsedAnimSeq {
  name: string;
  numModels: number;
  numSettings: number;
  modelGuids: string[];
  settingGuids: string[];
  dataExtraSize: number;
  seqLabel: string;
  activityName: string;
  fps: number;
  numFrames: number;
  flags: number;
  version: string;
}

/**
 * AnimSeqAssetHeader_v7_t (48 bytes):
 * - 0x00: PagePtr data (8 bytes)
 * - 0x08: PagePtr name (8 bytes)
 * - 0x10: PagePtr models (8 bytes)
 * - 0x18: uint64 numModels (8 bytes)
 * - 0x20: PagePtr settings (8 bytes)
 * - 0x28: uint64 numSettings (8 bytes)
 * 
 * AnimSeqAssetHeader_v7_1_t (56 bytes):
 * - 0x00: PagePtr data (8 bytes)
 * - 0x08: PagePtr name (8 bytes)
 * - 0x10: PagePtr models (8 bytes)
 * - 0x18: uint32 numModels (4 bytes)
 * - 0x1C: uint32 dataExtraSize (4 bytes)
 * - 0x20: PagePtr settings (8 bytes)
 * - 0x28: uint64 numSettings (8 bytes)
 * - 0x30: PagePtr dataExtra (8 bytes)
 * 
 * AnimSeqAssetHeader_v8_t (64 bytes):
 * - 0x00: PagePtr data (8 bytes)
 * - 0x08: PagePtr name (8 bytes)
 * - 0x10: PagePtr unk_10 (8 bytes)
 * - 0x18: uint16 numModels (2 bytes)
 * - 0x1A: uint16 numSettings (2 bytes)
 * - 0x1C: uint32 dataExtraSize (4 bytes)
 * - 0x20: PagePtr models (8 bytes)
 * - 0x28: PagePtr effects (8 bytes)
 * - 0x30: PagePtr settings (8 bytes)
 * - 0x38: PagePtr dataExtra (8 bytes)
 */

// Version detection based on header size and asset version
const HEADER_SIZE_V7 = 48;
const HEADER_SIZE_V7_1 = 56;
const HEADER_SIZE_V8 = 64;

function readString(
  pageData: Uint8Array | null,
  offset: number,
  maxLen: number = 512
): string {
  if (!pageData || offset < 0 || offset >= pageData.length) {
    return '';
  }
  
  let end = offset;
  while (end < pageData.length && end < offset + maxLen && pageData[end] !== 0) {
    end++;
  }
  
  const bytes = pageData.slice(offset, end);
  try {
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

function readInt32(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24);
}

function readInt16(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

function readFloat32(buf: Uint8Array, offset: number): number {
  const bytes = new Uint8Array([buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]]);
  return new DataView(bytes.buffer).getFloat32(0, true);
}

function readGuids(
  getPageData: (pageIndex: number) => Uint8Array | null,
  pageIndex: number,
  pageOffset: number,
  count: number,
  maxCount: number = 50
): string[] {
  const guids: string[] = [];
  if (count <= 0 || pageIndex < 0) return guids;
  
  const buf = getPageData(pageIndex);
  if (!buf) return guids;
  
  const numToRead = Math.min(count, maxCount);
  for (let i = 0; i < numToRead; i++) {
    const offset = pageOffset + (i * 8);
    if (offset + 8 > buf.length) break;
    
    const low = readInt32(buf, offset);
    const high = readInt32(buf, offset + 4);
    const guid = (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0);
    guids.push('0x' + guid.toString(16).toUpperCase().padStart(16, '0'));
  }
  
  return guids;
}

function parseAnimSeqFull(
  headerData: Uint8Array,
  assetVersion: number,
  getPageData: (pageIndex: number) => Uint8Array | null
): ParsedAnimSeq | null {
  const headerSize = headerData.byteLength;
  
  console.log('[aseq] Header size:', headerSize, 'version:', assetVersion);

  const buffer = headerData.buffer.slice(
    headerData.byteOffset,
    headerData.byteOffset + headerData.byteLength
  );
  const view = new DataView(buffer);
  
  // Common fields at start
  const dataPageIndex = view.getInt32(0x00, true);
  const dataPageOffset = view.getInt32(0x04, true);
  const namePageIndex = view.getInt32(0x08, true);
  const namePageOffset = view.getInt32(0x0C, true);
  
  let numModels = 0;
  let numSettings = 0;
  let dataExtraSize = 0;
  let modelsPageIndex = 0;
  let modelsPageOffset = 0;
  let settingsPageIndex = 0;
  let settingsPageOffset = 0;
  let version = '';
  
  // Determine format based on version and header size
  if (assetVersion >= 8 && headerSize >= HEADER_SIZE_V8) {
    // v8+ format
    numModels = view.getUint16(0x18, true);
    numSettings = view.getUint16(0x1A, true);
    dataExtraSize = view.getUint32(0x1C, true);
    modelsPageIndex = view.getInt32(0x20, true);
    modelsPageOffset = view.getInt32(0x24, true);
    settingsPageIndex = view.getInt32(0x30, true);
    settingsPageOffset = view.getInt32(0x34, true);
    version = `v${assetVersion}`;
  } else if (headerSize >= HEADER_SIZE_V7_1) {
    // v7.1 format
    modelsPageIndex = view.getInt32(0x10, true);
    modelsPageOffset = view.getInt32(0x14, true);
    numModels = view.getUint32(0x18, true);
    dataExtraSize = view.getUint32(0x1C, true);
    settingsPageIndex = view.getInt32(0x20, true);
    settingsPageOffset = view.getInt32(0x24, true);
    numSettings = view.getUint32(0x28, true);
    version = 'v7.1';
  } else if (headerSize >= HEADER_SIZE_V7) {
    // v7 format
    modelsPageIndex = view.getInt32(0x10, true);
    modelsPageOffset = view.getInt32(0x14, true);
    numModels = view.getUint32(0x18, true);
    settingsPageIndex = view.getInt32(0x20, true);
    settingsPageOffset = view.getInt32(0x24, true);
    numSettings = view.getUint32(0x28, true);
    version = 'v7';
  } else {
    console.log('[aseq] Unknown header format');
    return null;
  }
  
  console.log('[aseq] Parsed header:', {
    numModels,
    numSettings,
    dataExtraSize,
    version
  });
  
  // Resolve name
  let name = '';
  if (namePageIndex >= 0) {
    const nameBuf = getPageData(namePageIndex);
    if (nameBuf) {
      name = readString(nameBuf, namePageOffset);
    }
  }
  
  // Try to parse seqdesc from data pointer
  let seqLabel = '';
  let activityName = '';
  let fps = 0;
  let numFrames = 0;
  let flags = 0;
  
  if (dataPageIndex >= 0) {
    const dataBuf = getPageData(dataPageIndex);
    if (dataBuf && dataBuf.length > dataPageOffset + 0x80) {
      // mstudioseqdesc structure (varies by version, trying common offsets)
      // Based on r5::mstudioseqdesc_v8_t layout:
      // - 0x00: int baseptr (relative)
      // - 0x04: int szlabelindex
      // - 0x08: int szactivitynameindex
      // - 0x0C: int flags
      // - ...
      // - 0x58: float fps (approx)
      // - 0x5C: int numframes (approx)
      
      const base = dataPageOffset;
      
      // Read label offset and resolve
      const labelOffset = readInt32(dataBuf, base + 0x04);
      if (labelOffset > 0 && labelOffset < 0x1000) {
        seqLabel = readString(dataBuf, base + labelOffset, 128);
      }
      
      // Read activity name offset and resolve
      const activityOffset = readInt32(dataBuf, base + 0x08);
      if (activityOffset > 0 && activityOffset < 0x1000) {
        activityName = readString(dataBuf, base + activityOffset, 128);
      }
      
      // Read flags
      flags = readInt32(dataBuf, base + 0x0C);
      
      // Try to find fps and numframes (location varies)
      // Common pattern: fps is a float, numframes is int right after
      const fpsOffsets = [0x58, 0x54, 0x5C, 0x60];
      for (const off of fpsOffsets) {
        if (base + off + 8 <= dataBuf.length) {
          const testFps = readFloat32(dataBuf, base + off);
          const testFrames = readInt32(dataBuf, base + off + 4);
          if (testFps > 0 && testFps < 1000 && testFrames > 0 && testFrames < 100000) {
            fps = testFps;
            numFrames = testFrames;
            break;
          }
        }
      }
    }
  }
  
  // Resolve GUIDs
  const modelGuids = readGuids(getPageData, modelsPageIndex, modelsPageOffset, numModels);
  const settingGuids = readGuids(getPageData, settingsPageIndex, settingsPageOffset, numSettings);
  
  return {
    name,
    numModels,
    numSettings,
    modelGuids,
    settingGuids,
    dataExtraSize,
    seqLabel,
    activityName,
    fps,
    numFrames,
    flags,
    version
  };
}

// Sequence flags (common ones)
const SEQ_FLAGS: Record<number, string> = {
  0x0001: 'LOOPING',
  0x0002: 'SNAP',
  0x0004: 'DELTA',
  0x0008: 'AUTOPLAY',
  0x0010: 'POST',
  0x0040: 'ALLZEROS',
  0x0080: 'CYCLEPOSE',
  0x0100: 'REALTIME',
  0x0200: 'LOCAL',
  0x0400: 'HIDDEN',
  0x0800: 'OVERRIDE',
  0x1000: 'ACTIVITY',
  0x2000: 'EVENT',
  0x4000: 'WORLD',
  0x8000: 'NOFORCELOOP',
};

function getActiveFlags(flags: number): string[] {
  const active: string[] = [];
  for (const [bit, name] of Object.entries(SEQ_FLAGS)) {
    if (flags & parseInt(bit)) {
      active.push(name);
    }
  }
  return active;
}

export const AnimSeqPreview: React.FC<AnimSeqPreviewProps> = ({ asset }) => {
  const { getParser, assets: allAssets } = useAssetStore();
  
  const parsed = useMemo(() => {
    const headerData = asset.metadata?.headerData;
    if (!headerData) {
      console.log('[aseq] No header data available');
      return null;
    }
    
    let headerU8: Uint8Array;
    if (headerData instanceof Uint8Array) {
      headerU8 = headerData;
    } else {
      headerU8 = new Uint8Array(headerData as ArrayBuffer);
    }
    
    if (asset.containerFile) {
      const parser = getParser(asset.containerFile);
      if (parser) {
        return parseAnimSeqFull(
          headerU8,
          asset.version || 7,
          (pageIndex: number) => parser.getPageData(pageIndex)
        );
      }
    }
    
    return null;
  }, [asset, getParser]);

  // Resolve model and settings names
  const resolvedModels = useMemo(() => {
    if (!parsed || !allAssets.length) return [];
    
    return parsed.modelGuids.map(guid => {
      const found = allAssets.find(a => 
        a.guid === guid || 
        `0x${a.guid?.toUpperCase()}` === guid
      );
      return {
        guid,
        name: found?.name || null,
        type: found?.type || null,
        found: !!found
      };
    });
  }, [parsed, allAssets]);

  const resolvedSettings = useMemo(() => {
    if (!parsed || !allAssets.length) return [];
    
    return parsed.settingGuids.map(guid => {
      const found = allAssets.find(a => 
        a.guid === guid || 
        `0x${a.guid?.toUpperCase()}` === guid
      );
      return {
        guid,
        name: found?.name || null,
        found: !!found
      };
    });
  }, [parsed, allAssets]);

  const activeFlags = useMemo(() => {
    return parsed ? getActiveFlags(parsed.flags) : [];
  }, [parsed]);

  if (!parsed) {
    return (
      <div className="aseq-preview">
        <div className="aseq-error">
          <span className="error-icon">⚠️</span>
          <span>Could not parse animation sequence data</span>
        </div>
      </div>
    );
  }

  // Calculate duration if we have fps and frames
  const duration = parsed.fps > 0 && parsed.numFrames > 0 
    ? (parsed.numFrames / parsed.fps).toFixed(2) 
    : null;

  return (
    <div className="aseq-preview">
      <div className="aseq-header">
        <div className="aseq-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M6 6V4M12 6V4M18 6V4" />
            <path d="M6 18v2M12 18v2M18 18v2" />
            <path d="M7 12h2M11 12h2M15 12h2" />
          </svg>
        </div>
        <div className="aseq-title">
          <h3>Animation Sequence</h3>
          <span className="aseq-name">{asset.name}</span>
        </div>
      </div>

      <div className="aseq-content">
        {/* Sequence Info */}
        <div className="aseq-section">
          <h4>Sequence Information</h4>
          <div className="aseq-properties">
            {parsed.seqLabel && (
              <div className="aseq-property wide">
                <span className="prop-label">Label</span>
                <span className="prop-value mono">{parsed.seqLabel}</span>
              </div>
            )}
            {parsed.activityName && (
              <div className="aseq-property wide">
                <span className="prop-label">Activity</span>
                <span className="prop-value mono">{parsed.activityName}</span>
              </div>
            )}
            <div className="aseq-property">
              <span className="prop-label">Version</span>
              <span className="prop-value">{parsed.version}</span>
            </div>
            {parsed.fps > 0 && (
              <div className="aseq-property">
                <span className="prop-label">FPS</span>
                <span className="prop-value">{parsed.fps.toFixed(1)}</span>
              </div>
            )}
            {parsed.numFrames > 0 && (
              <div className="aseq-property">
                <span className="prop-label">Frames</span>
                <span className="prop-value">{parsed.numFrames}</span>
              </div>
            )}
            {duration && (
              <div className="aseq-property">
                <span className="prop-label">Duration</span>
                <span className="prop-value">{duration}s</span>
              </div>
            )}
            {parsed.dataExtraSize > 0 && (
              <div className="aseq-property">
                <span className="prop-label">Extra Data</span>
                <span className="prop-value">{parsed.dataExtraSize} bytes</span>
              </div>
            )}
          </div>
        </div>

        {/* Flags */}
        {activeFlags.length > 0 && (
          <div className="aseq-section">
            <h4>Flags</h4>
            <div className="aseq-flags">
              {activeFlags.map((flag, idx) => (
                <span key={idx} className="aseq-flag">{flag}</span>
              ))}
            </div>
          </div>
        )}

        {/* Referenced Models */}
        {parsed.numModels > 0 && (
          <div className="aseq-section">
            <h4>Referenced Models ({parsed.numModels})</h4>
            <div className="aseq-refs">
              {resolvedModels.map((model, idx) => (
                <div key={idx} className={`aseq-ref ${model.found ? 'found' : 'missing'}`}>
                  <span className="ref-index">{idx}</span>
                  {model.found ? (
                    <>
                      <span className="ref-name">{model.name}</span>
                      {model.type && <span className="ref-type">{model.type}</span>}
                    </>
                  ) : (
                    <span className="ref-guid">{model.guid}</span>
                  )}
                </div>
              ))}
              {parsed.numModels > 50 && (
                <div className="aseq-truncated">
                  ... and {parsed.numModels - 50} more models
                </div>
              )}
            </div>
          </div>
        )}

        {/* Referenced Settings */}
        {parsed.numSettings > 0 && (
          <div className="aseq-section">
            <h4>Referenced Settings ({parsed.numSettings})</h4>
            <div className="aseq-refs">
              {resolvedSettings.map((setting, idx) => (
                <div key={idx} className={`aseq-ref ${setting.found ? 'found' : 'missing'}`}>
                  <span className="ref-index">{idx}</span>
                  {setting.found ? (
                    <span className="ref-name">{setting.name}</span>
                  ) : (
                    <span className="ref-guid">{setting.guid}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnimSeqPreview;
