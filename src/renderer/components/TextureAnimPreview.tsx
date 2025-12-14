import React, { useMemo } from 'react';
import { Asset } from '../types/asset';
import { useAssetStore } from '../stores/assetStore';
import './TextureAnimPreview.css';

interface TextureAnimPreviewProps {
  asset: Asset;
}

interface TextureAnimLayer {
  startSlot: number;
  endSlot: number;
  scale: number;
  flags: number;
}

interface ParsedTextureAnim {
  layerCount: number;
  slotCount: number;
  layers: TextureAnimLayer[];
}

/**
 * TextureAnimLayer_t (12 bytes):
 * - 0x00: u16 startSlot
 * - 0x02: u16 endSlot
 * - 0x04: float unk2 (scale)
 * - 0x08: u16 flags
 * - 0x0A: u16 unk5 (padding)
 * 
 * TextureAnimAssetHeader_v1_t (24 bytes):
 * - 0x00: PagePtr_t layers (8 bytes)
 * - 0x08: PagePtr_t slots (8 bytes)
 * - 0x10: int layerCount (4 bytes)
 * - 0x14: int padding (4 bytes)
 */

const LAYER_SIZE = 12;

/**
 * Parse texture animation using page data resolution
 */
function parseTextureAnimFull(
  headerData: Uint8Array,
  getPageData: (pageIndex: number) => Uint8Array | null
): ParsedTextureAnim | null {
  if (headerData.byteLength < 24) {
    console.log('[txan] Header too small:', headerData.byteLength);
    return null;
  }

  const buffer = headerData.buffer.slice(
    headerData.byteOffset,
    headerData.byteOffset + headerData.byteLength
  );
  const view = new DataView(buffer);
  
  // Read layers PagePtr at 0x00
  const layersPageIndex = view.getInt32(0x00, true);
  const layersPageOffset = view.getInt32(0x04, true);
  
  // Read layer count at offset 0x10
  const layerCount = view.getInt32(0x10, true);
  
  console.log('[txan] Header:', { layersPageIndex, layersPageOffset, layerCount });
  
  if (layerCount <= 0 || layerCount > 1000) {
    console.log('[txan] Invalid layer count:', layerCount);
    return null;
  }

  const layersBuf = getPageData(layersPageIndex);
  
  const layers: TextureAnimLayer[] = [];
  let slotCount = 0;
  
  if (layersBuf && layersBuf.length > 0) {
    console.log('[txan] Layers page:', layersBuf.length, 'bytes, offset:', layersPageOffset);
    
    for (let i = 0; i < layerCount; i++) {
      const offset = layersPageOffset + (i * LAYER_SIZE);
      
      if (offset + LAYER_SIZE > layersBuf.byteLength) {
        console.log('[txan] Layer', i, 'offset out of bounds:', offset);
        break;
      }
      
      const startSlot = layersBuf[offset] | (layersBuf[offset + 1] << 8);
      const endSlot = layersBuf[offset + 2] | (layersBuf[offset + 3] << 8);
      
      // Float at offset + 4
      const floatBytes = new Uint8Array([
        layersBuf[offset + 4],
        layersBuf[offset + 5],
        layersBuf[offset + 6],
        layersBuf[offset + 7]
      ]);
      const floatView = new DataView(floatBytes.buffer);
      const scale = floatView.getFloat32(0, true);
      
      const flags = layersBuf[offset + 8] | (layersBuf[offset + 9] << 8);
      
      console.log('[txan] Layer', i, ':', { startSlot, endSlot, scale, flags });
      
      layers.push({
        startSlot,
        endSlot,
        scale,
        flags
      });
      
      slotCount = Math.max(slotCount, startSlot + 1, endSlot + 1);
    }
  } else {
    console.log('[txan] Failed to get layers page', layersPageIndex);
  }
  
  return {
    layerCount,
    slotCount,
    layers
  };
}

export const TextureAnimPreview: React.FC<TextureAnimPreviewProps> = ({ asset }) => {
  const { getParser } = useAssetStore();
  
  const parsed = useMemo(() => {
    const headerData = asset.metadata?.headerData;
    if (!headerData) {
      console.log('[txan] No header data available');
      return null;
    }
    
    let headerU8: Uint8Array;
    if (headerData instanceof Uint8Array) {
      headerU8 = headerData;
    } else {
      headerU8 = new Uint8Array(headerData as ArrayBuffer);
    }
    
    console.log('[txan] Header data size:', headerU8.length, 'containerFile:', asset.containerFile);
    
    // Get parser from asset store using containerFile
    if (asset.containerFile) {
      const parser = getParser(asset.containerFile);
      console.log('[txan] Got parser:', !!parser);
      if (parser) {
        console.log('[txan] Using parser for', asset.containerFile);
        return parseTextureAnimFull(
          headerU8,
          (pageIndex: number) => parser.getPageData(pageIndex)
        );
      }
    }
    
    console.log('[txan] No parser available, cannot parse layers');
    // Return basic info without layers
    if (headerU8.length >= 24) {
      const view = new DataView(headerU8.buffer, headerU8.byteOffset, headerU8.byteLength);
      const layerCount = view.getInt32(0x10, true);
      return {
        layerCount,
        slotCount: 0,
        layers: []
      };
    }
    return null;
  }, [asset, getParser]);

  if (!parsed) {
    return (
      <div className="txan-preview">
        <div className="txan-error">
          <span className="error-icon">⚠️</span>
          <span>Could not parse texture animation data</span>
        </div>
      </div>
    );
  }

  return (
    <div className="txan-preview">
      <div className="txan-header">
        <div className="txan-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M9 3v18" />
            <circle cx="15" cy="15" r="2" />
            <path d="M15 13v-2M17 15h2" />
          </svg>
        </div>
        <div className="txan-title">
          <h3>Texture Animation</h3>
          <span className="txan-name">{asset.name}</span>
        </div>
      </div>

      <div className="txan-content">
        {/* Properties */}
        <div className="txan-section">
          <h4>Properties</h4>
          <div className="txan-properties">
            <div className="txan-property">
              <span className="prop-label">Layer Count</span>
              <span className="prop-value">{parsed.layerCount}</span>
            </div>
            <div className="txan-property">
              <span className="prop-label">Slot Count</span>
              <span className="prop-value">{parsed.slotCount}</span>
            </div>
            <div className="txan-property">
              <span className="prop-label">Version</span>
              <span className="prop-value">v{asset.version || 1}</span>
            </div>
          </div>
        </div>

        {/* Layers */}
        <div className="txan-section">
          <h4>Animation Layers</h4>
          {parsed.layers.length > 0 ? (
            <div className="txan-layers">
              {parsed.layers.map((layer, idx) => (
                <div key={idx} className="txan-layer">
                  <div className="layer-header">
                    <span className="layer-index">Layer {idx}</span>
                    <span className="layer-range">
                      Slot {layer.startSlot} → {layer.endSlot}
                    </span>
                  </div>
                  <div className="layer-details">
                    <div className="layer-detail">
                      <span className="detail-label">Start Slot</span>
                      <span className="detail-value">{layer.startSlot}</span>
                    </div>
                    <div className="layer-detail">
                      <span className="detail-label">End Slot</span>
                      <span className="detail-value">{layer.endSlot}</span>
                    </div>
                    <div className="layer-detail">
                      <span className="detail-label">Scale</span>
                      <span className="detail-value">{layer.scale.toFixed(4)}</span>
                    </div>
                    <div className="layer-detail">
                      <span className="detail-label">Frame Count</span>
                      <span className="detail-value">
                        {Math.abs(layer.endSlot - layer.startSlot) + 1}
                      </span>
                    </div>
                  </div>
                  {/* Visual representation of animation range */}
                  <div className="layer-visual">
                    <div 
                      className="layer-bar"
                      style={{
                        '--start': `${(Math.min(layer.startSlot, layer.endSlot) / parsed.slotCount) * 100}%`,
                        '--end': `${((Math.max(layer.startSlot, layer.endSlot) + 1) / parsed.slotCount) * 100}%`
                      } as React.CSSProperties}
                    >
                      <span className="bar-label">{layer.startSlot}</span>
                      <span className="bar-label">{layer.endSlot}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="txan-no-layers">No layer data available</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TextureAnimPreview;
