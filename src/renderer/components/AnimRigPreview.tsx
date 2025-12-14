import React, { useMemo } from 'react';
import { Asset } from '../types/asset';
import { useAssetStore } from '../stores/assetStore';
import './AnimRigPreview.css';

interface AnimRigPreviewProps {
  asset: Asset;
}

interface ParsedAnimRig {
  name: string;
  numAnimSeqs: number;
  animSeqGuids: string[];
  boneCount: number;
  studioVersion: string;
}

/**
 * AnimRigAssetHeader_v4_t (0x28 bytes):
 * - 0x00: PagePtr data (8 bytes) - ptr to studiohdr & rrig buffer
 * - 0x08: PagePtr name (8 bytes)
 * - 0x10: int unk_10 (4 bytes)
 * - 0x14: int numAnimSeqs (4 bytes)
 * - 0x18: PagePtr animSeqs (8 bytes)
 * - 0x20: int64 reserved (8 bytes)
 * 
 * AnimRigAssetHeader_v5_t (0x28 bytes):
 * - 0x00: PagePtr data (8 bytes)
 * - 0x08: PagePtr name (8 bytes)
 * - 0x10: short unk_10 (2 bytes)
 * - 0x12: short numAnimSeqs (2 bytes)
 * - 0x14: int unk_14 (4 bytes)
 * - 0x18: PagePtr animSeqs (8 bytes)
 * - 0x20: int64 reserved (8 bytes)
 */

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

function parseAnimRigFull(
  headerData: Uint8Array,
  assetVersion: number,
  getPageData: (pageIndex: number) => Uint8Array | null
): ParsedAnimRig | null {
  if (headerData.byteLength < 0x28) {
    console.log('[arig] Header too small:', headerData.byteLength);
    return null;
  }

  const buffer = headerData.buffer.slice(
    headerData.byteOffset,
    headerData.byteOffset + headerData.byteLength
  );
  const view = new DataView(buffer);
  
  // Read data PagePtr at 0x00
  const dataPageIndex = view.getInt32(0x00, true);
  const dataPageOffset = view.getInt32(0x04, true);
  
  // Read name PagePtr at 0x08
  const namePageIndex = view.getInt32(0x08, true);
  const namePageOffset = view.getInt32(0x0C, true);
  
  // Read numAnimSeqs - different location for v4 vs v5
  let numAnimSeqs: number;
  if (assetVersion >= 5) {
    // v5: short at 0x12
    numAnimSeqs = view.getInt16(0x12, true);
  } else {
    // v4: int at 0x14
    numAnimSeqs = view.getInt32(0x14, true);
  }
  
  // Read animSeqs PagePtr at 0x18
  const animSeqsPageIndex = view.getInt32(0x18, true);
  const animSeqsPageOffset = view.getInt32(0x1C, true);
  
  console.log('[arig] Header:', {
    dataPageIndex,
    dataPageOffset,
    namePageIndex,
    namePageOffset,
    numAnimSeqs,
    animSeqsPageIndex,
    animSeqsPageOffset,
    assetVersion
  });
  
  // Resolve name
  let name = '';
  if (namePageIndex >= 0) {
    const nameBuf = getPageData(namePageIndex);
    if (nameBuf) {
      name = readString(nameBuf, namePageOffset);
    }
  }
  
  // Try to get bone count from studiohdr data
  let boneCount = 0;
  if (dataPageIndex >= 0) {
    const dataBuf = getPageData(dataPageIndex);
    if (dataBuf && dataBuf.length > dataPageOffset + 0x100) {
      // The bone count is typically around offset 0x9C in studiohdr
      // This varies by version, so we'll try a few common offsets
      const tryOffsets = [0x9C, 0xA0, 0xA4, 0x98];
      for (const off of tryOffsets) {
        if (dataPageOffset + off + 4 <= dataBuf.length) {
          const val = dataBuf[dataPageOffset + off] | 
                     (dataBuf[dataPageOffset + off + 1] << 8) |
                     (dataBuf[dataPageOffset + off + 2] << 16) |
                     (dataBuf[dataPageOffset + off + 3] << 24);
          // Reasonable bone count check
          if (val > 0 && val < 1000) {
            boneCount = val;
            break;
          }
        }
      }
    }
  }
  
  // Resolve animSeq GUIDs (each is 8 bytes)
  const animSeqGuids: string[] = [];
  if (numAnimSeqs > 0 && animSeqsPageIndex >= 0) {
    const animSeqsBuf = getPageData(animSeqsPageIndex);
    if (animSeqsBuf) {
      const maxSeqs = Math.min(numAnimSeqs, 100); // Limit for preview
      for (let i = 0; i < maxSeqs; i++) {
        const offset = animSeqsPageOffset + (i * 8);
        if (offset + 8 > animSeqsBuf.length) break;
        
        // Read as BigInt64 for GUID
        const low = animSeqsBuf[offset] | 
                   (animSeqsBuf[offset + 1] << 8) | 
                   (animSeqsBuf[offset + 2] << 16) | 
                   (animSeqsBuf[offset + 3] << 24);
        const high = animSeqsBuf[offset + 4] | 
                    (animSeqsBuf[offset + 5] << 8) | 
                    (animSeqsBuf[offset + 6] << 16) | 
                    (animSeqsBuf[offset + 7] << 24);
        
        const guid = (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0);
        animSeqGuids.push('0x' + guid.toString(16).toUpperCase().padStart(16, '0'));
      }
    }
  }
  
  // Determine studio version based on asset version
  let studioVersion = 'Unknown';
  switch (assetVersion) {
    case 4:
      studioVersion = 'v8-v14';
      break;
    case 5:
      studioVersion = 'v16+';
      break;
    default:
      studioVersion = `v${assetVersion}`;
  }
  
  return {
    name,
    numAnimSeqs,
    animSeqGuids,
    boneCount,
    studioVersion
  };
}

export const AnimRigPreview: React.FC<AnimRigPreviewProps> = ({ asset }) => {
  const { getParser, assets: allAssets } = useAssetStore();
  
  const parsed = useMemo(() => {
    const headerData = asset.metadata?.headerData;
    if (!headerData) {
      console.log('[arig] No header data available');
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
        return parseAnimRigFull(
          headerU8,
          asset.version || 4,
          (pageIndex: number) => parser.getPageData(pageIndex)
        );
      }
    }
    
    return null;
  }, [asset, getParser]);

  // Resolve animation sequence names from assets
  const resolvedSeqs = useMemo(() => {
    if (!parsed || !allAssets.length) return [];
    
    return parsed.animSeqGuids.map(guid => {
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

  if (!parsed) {
    return (
      <div className="arig-preview">
        <div className="arig-error">
          <span className="error-icon">⚠️</span>
          <span>Could not parse animation rig data</span>
        </div>
      </div>
    );
  }

  return (
    <div className="arig-preview">
      <div className="arig-header">
        <div className="arig-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="5" r="2" />
            <path d="M12 7v4M8 15l4-4 4 4" />
            <circle cx="8" cy="17" r="2" />
            <circle cx="16" cy="17" r="2" />
            <path d="M8 15v-2M16 15v-2" />
          </svg>
        </div>
        <div className="arig-title">
          <h3>Animation Rig</h3>
          <span className="arig-name">{asset.name}</span>
        </div>
      </div>

      <div className="arig-content">
        {/* Properties */}
        <div className="arig-section">
          <h4>Properties</h4>
          <div className="arig-properties">
            <div className="arig-property">
              <span className="prop-label">Internal Name</span>
              <span className="prop-value mono">{parsed.name || '(none)'}</span>
            </div>
            <div className="arig-property">
              <span className="prop-label">Version</span>
              <span className="prop-value">v{asset.version || 4}</span>
            </div>
            <div className="arig-property">
              <span className="prop-label">Studio Version</span>
              <span className="prop-value">{parsed.studioVersion}</span>
            </div>
            <div className="arig-property">
              <span className="prop-label">Bone Count</span>
              <span className="prop-value">{parsed.boneCount || 'Unknown'}</span>
            </div>
            <div className="arig-property">
              <span className="prop-label">Animation Sequences</span>
              <span className="prop-value">{parsed.numAnimSeqs}</span>
            </div>
          </div>
        </div>

        {/* Animation Sequences */}
        {parsed.numAnimSeqs > 0 && (
          <div className="arig-section">
            <h4>Referenced Animation Sequences ({resolvedSeqs.length})</h4>
            <div className="arig-seqs">
              {resolvedSeqs.map((seq, idx) => (
                <div key={idx} className={`arig-seq ${seq.found ? 'found' : 'missing'}`}>
                  <span className="seq-index">{idx}</span>
                  {seq.found ? (
                    <span className="seq-name">{seq.name}</span>
                  ) : (
                    <span className="seq-guid">{seq.guid}</span>
                  )}
                  {!seq.found && <span className="seq-status">Not loaded</span>}
                </div>
              ))}
              {parsed.numAnimSeqs > 100 && (
                <div className="arig-truncated">
                  ... and {parsed.numAnimSeqs - 100} more sequences
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnimRigPreview;
