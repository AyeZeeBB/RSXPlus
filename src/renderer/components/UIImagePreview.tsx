import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Asset } from '../types/asset';
import { useAssetStore } from '../stores/assetStore';
import { decodeTextureToRGBA, rgbaToDataUrl, calculateMipSize, getMipType, MipType } from '../parsers/textureParser';
import { loadTextureMipFromStarpak, starpakManager, decodeStarpakOffset } from '../parsers/starpakLoader';
import { decompress as zstdDecompress } from 'fzstd';
import { decompressRTech } from '../utils/rtechDecompress';
import { decompressOodle } from '../utils/oodleDecompress';
import './UIImagePreview.css';

interface UIImagePreviewProps {
  asset: Asset;
}

interface UIImageAtlasOffset {
  cropInsetLeft: number;
  cropInsetTop: number;
  endAnchorX: number;
  endAnchorY: number;
  startAnchorX: number;
  startAnchorY: number;
  scaleRatioX: number;
  scaleRatioY: number;
}

interface UIImageAtlasDimension {
  width: number;
  height: number;
}

interface UIImageAtlasBounds {
  minX: number;
  minY: number;
  sizeX: number;
  sizeY: number;
}

interface UIAtlasImage {
  index: number;
  path: string;
  pathHash: string;
  width: number;
  height: number;
  posX: number;
  posY: number;
  dimensionsWidth: number;
  dimensionsHeight: number;
  offset: UIImageAtlasOffset;
  bounds: UIImageAtlasBounds | null;
}

interface ParsedUIImageAtlas {
  widthRatio: number;
  heightRatio: number;
  width: number;
  height: number;
  textureCount: number;
  unkCount: number;
  atlasGuid: string;
  images: UIAtlasImage[];
}

/**
 * UIImageAtlasAssetHeader_v10_t (72 bytes / 0x48):
 * - 0x00: float widthRatio
 * - 0x04: float heightRatio
 * - 0x08: uint16 width
 * - 0x0A: uint16 height
 * - 0x0C: uint16 textureCount
 * - 0x0E: uint16 unkCount
 * - 0x10: PagePtr textureOffsets (8 bytes) - UIImageAtlasOffset_t array (32 bytes each)
 * - 0x18: PagePtr textureDimensions (8 bytes) - UIImageAtlasDimension_t array (4 bytes each)
 * - 0x20: PagePtr unk (8 bytes)
 * - 0x28: PagePtr textureHashes (8 bytes) - v10: 8 bytes each, v11: 12 bytes each
 * - 0x30: PagePtr textureNames (8 bytes)
 * - 0x38: uint64 atlasGUID
 * 
 * UIImageAtlasBounds_t (16 bytes) - stored in dataPagePtr:
 * - float minX, minY, sizeX, sizeY
 * 
 * UIImageAtlasOffset_t (32 bytes):
 * - 8 floats: cropInsetLeft, cropInsetTop, endAnchorX, endAnchorY, startAnchorX, startAnchorY, scaleRatioX, scaleRatioY
 * 
 * UIImageAtlasDimension_t (4 bytes):
 * - uint16 width, uint16 height
 * 
 * UIImageAtlasHash_v10_t (8 bytes):
 * - uint32 pathHash, uint16 unk_4, uint16 pathTableOffset
 * 
 * UIImageAtlasHash_v11_t (12 bytes):
 * - uint32 pathHash, int pathTableOffset, int unk_8
 */

const BOUNDS_SIZE = 16;

const OFFSET_SIZE = 32;
const DIMENSION_SIZE = 4;
const HASH_SIZE_V10 = 8;
const HASH_SIZE_V11 = 12;

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

function readUint16(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

function readFloat32(buf: Uint8Array, offset: number): number {
  const bytes = new Uint8Array([buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]]);
  return new DataView(bytes.buffer).getFloat32(0, true);
}

function isValidPath(str: string): boolean {
  // Check if string looks like a valid file path (printable ASCII, reasonable chars)
  if (!str || str.length === 0 || str.length > 512) return false;
  
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // Allow printable ASCII (space to ~) but reject control characters
    if (code < 32 || code > 126) {
      return false;
    }
  }
  
  // Should contain at least one path-like character
  return str.includes('/') || str.includes('\\') || str.includes('.') || /^[a-zA-Z0-9_-]+$/.test(str);
}

function parseUIImageAtlasFull(
  headerData: Uint8Array,
  assetVersion: number,
  getPageData: (pageIndex: number) => Uint8Array | null,
  dataPageIndex: number,
  dataPageOffset: number
): ParsedUIImageAtlas | null {
  if (headerData.byteLength < 0x40) {
    console.log('[uimg] Header too small:', headerData.byteLength);
    return null;
  }

  const buffer = headerData.buffer.slice(
    headerData.byteOffset,
    headerData.byteOffset + headerData.byteLength
  );
  const view = new DataView(buffer);
  
  // Read header fields
  const widthRatio = view.getFloat32(0x00, true);
  const heightRatio = view.getFloat32(0x04, true);
  const width = view.getUint16(0x08, true);
  const height = view.getUint16(0x0A, true);
  const textureCount = view.getUint16(0x0C, true);
  const unkCount = view.getUint16(0x0E, true);
  
  // PagePtrs
  const offsetsPageIndex = view.getInt32(0x10, true);
  const offsetsPageOffset = view.getInt32(0x14, true);
  const dimensionsPageIndex = view.getInt32(0x18, true);
  const dimensionsPageOffset = view.getInt32(0x1C, true);
  // Skip unk at 0x20
  const hashesPageIndex = view.getInt32(0x28, true);
  const hashesPageOffset = view.getInt32(0x2C, true);
  const namesPageIndex = view.getInt32(0x30, true);
  const namesPageOffset = view.getInt32(0x34, true);
  
  // Atlas GUID
  const atlasGuidLow = view.getUint32(0x38, true);
  const atlasGuidHigh = view.getUint32(0x3C, true);
  const atlasGuid = (BigInt(atlasGuidHigh >>> 0) << 32n) | BigInt(atlasGuidLow >>> 0);
  
  console.log('[uimg] Header:', {
    widthRatio,
    heightRatio,
    width,
    height,
    textureCount,
    unkCount,
    atlasGuid: atlasGuid.toString(16),
    assetVersion
  });
  
  if (textureCount <= 0 || textureCount > 10000) {
    console.log('[uimg] Invalid texture count');
    return null;
  }
  
  // Determine hash structure size based on version
  const hashSize = assetVersion >= 11 ? HASH_SIZE_V11 : HASH_SIZE_V10;
  
  // Get page data
  const offsetsBuf = getPageData(offsetsPageIndex);
  const dimensionsBuf = getPageData(dimensionsPageIndex);
  const hashesBuf = getPageData(hashesPageIndex);
  const namesBuf = getPageData(namesPageIndex);
  
  // Get bounds from data page (cpu data)
  const boundsBuf = dataPageIndex >= 0 ? getPageData(dataPageIndex) : null;
  
  const images: UIAtlasImage[] = [];
  const maxImages = Math.min(textureCount, 500); // Limit for preview
  
  for (let i = 0; i < maxImages; i++) {
    let path = '';
    let pathHash = '0x00000000';
    let dimensionsWidth = 0;
    let dimensionsHeight = 0;
    const offset: UIImageAtlasOffset = {
      cropInsetLeft: 0, cropInsetTop: 0,
      endAnchorX: 1, endAnchorY: 1,
      startAnchorX: 0, startAnchorY: 0,
      scaleRatioX: 1, scaleRatioY: 1
    };
    
    // Read offset data
    if (offsetsBuf) {
      const off = offsetsPageOffset + (i * OFFSET_SIZE);
      if (off + OFFSET_SIZE <= offsetsBuf.length) {
        offset.cropInsetLeft = readFloat32(offsetsBuf, off + 0);
        offset.cropInsetTop = readFloat32(offsetsBuf, off + 4);
        offset.endAnchorX = readFloat32(offsetsBuf, off + 8);
        offset.endAnchorY = readFloat32(offsetsBuf, off + 12);
        offset.startAnchorX = readFloat32(offsetsBuf, off + 16);
        offset.startAnchorY = readFloat32(offsetsBuf, off + 20);
        offset.scaleRatioX = readFloat32(offsetsBuf, off + 24);
        offset.scaleRatioY = readFloat32(offsetsBuf, off + 28);
      }
    }
    
    // Read dimensions
    if (dimensionsBuf) {
      const off = dimensionsPageOffset + (i * DIMENSION_SIZE);
      if (off + DIMENSION_SIZE <= dimensionsBuf.length) {
        dimensionsWidth = readUint16(dimensionsBuf, off);
        dimensionsHeight = readUint16(dimensionsBuf, off + 2);
      }
    }
    
    // Read hash and path
    if (hashesBuf) {
      const hashOff = hashesPageOffset + (i * hashSize);
      if (hashOff + hashSize <= hashesBuf.length) {
        const hash = readInt32(hashesBuf, hashOff);
        pathHash = '0x' + (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
        
        let pathTableOffset: number;
        if (assetVersion >= 11) {
          // v11: int pathTableOffset at offset 4
          pathTableOffset = readInt32(hashesBuf, hashOff + 4);
        } else {
          // v10: uint16 pathTableOffset at offset 6
          pathTableOffset = readUint16(hashesBuf, hashOff + 6);
        }
        
        // Try to read path from names buffer
        // pathTableOffset is relative to the start of the string table (namesPageOffset)
        if (namesBuf && namesPageOffset >= 0 && pathTableOffset >= 0) {
          const stringOffset = namesPageOffset + pathTableOffset;
          if (stringOffset < namesBuf.length) {
            const readPath = readString(namesBuf, stringOffset);
            // Validate the path - should be printable ASCII
            if (readPath && readPath.length > 0 && isValidPath(readPath)) {
              path = readPath;
            }
          }
        }
      }
    }
    
    // Read bounds from data page (UIImageAtlasBounds_t array)
    let bounds: UIImageAtlasBounds | null = null;
    let posX = 0;
    let posY = 0;
    let spriteWidth = 0;
    let spriteHeight = 0;
    
    if (boundsBuf) {
      const boundsOff = dataPageOffset + (i * BOUNDS_SIZE);
      if (boundsOff + BOUNDS_SIZE <= boundsBuf.length) {
        const minX = readFloat32(boundsBuf, boundsOff + 0);
        const minY = readFloat32(boundsBuf, boundsOff + 4);
        const sizeX = readFloat32(boundsBuf, boundsOff + 8);
        const sizeY = readFloat32(boundsBuf, boundsOff + 12);
        
        bounds = { minX, minY, sizeX, sizeY };
        
        // Calculate pixel position on atlas
        posX = Math.round(minX * width);
        posY = Math.round(minY * height);
        spriteWidth = Math.round(sizeX * width + 0.5);
        spriteHeight = Math.round(sizeY * height + 0.5);
      }
    }
    
    images.push({
      index: i,
      path,
      pathHash,
      width: spriteWidth || Math.round(dimensionsWidth * offset.scaleRatioX),
      height: spriteHeight || Math.round(dimensionsHeight * offset.scaleRatioY),
      posX,
      posY,
      dimensionsWidth,
      dimensionsHeight,
      offset,
      bounds
    });
  }
  
  return {
    widthRatio,
    heightRatio,
    width,
    height,
    textureCount,
    unkCount,
    atlasGuid: '0x' + atlasGuid.toString(16).toUpperCase().padStart(16, '0'),
    images
  };
}

export const UIImagePreview: React.FC<UIImagePreviewProps> = ({ asset }) => {
  const { getParser, assets: allAssets, getTextureData } = useAssetStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedImage, setExpandedImage] = useState<number | null>(null);
  const [hoveredSprite, setHoveredSprite] = useState<number | null>(null);
  const [showAtlasMap, setShowAtlasMap] = useState(true);
  const [atlasImageUrl, setAtlasImageUrl] = useState<string | null>(null);
  const [atlasLoadError, setAtlasLoadError] = useState<string | null>(null);
  const [isLoadingAtlas, setIsLoadingAtlas] = useState(false);
  
  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const mapContainerRef = useRef<HTMLDivElement>(null);
  
  const parsed = useMemo(() => {
    const headerData = asset.metadata?.headerData;
    if (!headerData) {
      console.log('[uimg] No header data available');
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
        // Get dataPagePtr for bounds data
        const metadata = asset.metadata as { dataPagePtr?: { index: number; offset: number } } | undefined;
        const dataPagePtr = metadata?.dataPagePtr;
        const dataPageIndex = dataPagePtr?.index ?? -1;
        const dataPageOffset = dataPagePtr?.offset ?? 0;
        
        return parseUIImageAtlasFull(
          headerU8,
          asset.version || 10,
          (pageIndex: number) => parser.getPageData(pageIndex),
          dataPageIndex,
          dataPageOffset
        );
      }
    }
    
    return null;
  }, [asset, getParser]);

  // Resolve atlas texture
  const atlasTexture = useMemo(() => {
    if (!parsed || !allAssets.length) return null;
    
    return allAssets.find(a => 
      a.guid === parsed.atlasGuid || 
      `0x${a.guid?.toUpperCase()}` === parsed.atlasGuid
    );
  }, [parsed, allAssets]);

  // Load atlas texture image
  useEffect(() => {
    if (!atlasTexture) {
      setAtlasImageUrl(null);
      return;
    }
    
    let cancelled = false;
    
    const loadAtlasTexture = async () => {
      setIsLoadingAtlas(true);
      setAtlasLoadError(null);
      
      try {
        const result = await getTextureData(atlasTexture);
        if (cancelled) return;
        
        if (!result || !result.header) {
          setAtlasLoadError('Failed to load atlas texture');
          setIsLoadingAtlas(false);
          return;
        }
        
        const { header, pixelData, starpakOffset, optStarpakOffset } = result;
        const totalStreamedMips = header.optStreamedMipCount + header.streamedMipCount;
        
        // Try to get the best available mip
        let mipToLoad = totalStreamedMips; // Default to first permanent mip
        let mipPixelData: Uint8Array | null = null;
        
        // Check starpak availability for higher res mips
        const hasStarpakMips = header.streamedMipCount > 0;
        const hasOptStarpakMips = header.optStreamedMipCount > 0;
        
        let starpakAvailable = false;
        let optStarpakAvailable = false;
        
        if (hasStarpakMips && starpakOffset !== 0n) {
          const { index } = decodeStarpakOffset(starpakOffset);
          starpakAvailable = await starpakManager.checkStarpakExists(index, false);
        }
        
        if (hasOptStarpakMips && optStarpakOffset !== 0n) {
          const { index } = decodeStarpakOffset(optStarpakOffset);
          optStarpakAvailable = await starpakManager.checkStarpakExists(index, true);
        }
        
        // Find best available mip
        if (optStarpakAvailable && header.optStreamedMipCount > 0) {
          mipToLoad = 0;
        } else if (starpakAvailable && header.streamedMipCount > 0) {
          mipToLoad = header.optStreamedMipCount;
        }
        
        const mipWidth = Math.max(1, header.width >> mipToLoad);
        const mipHeight = Math.max(1, header.height >> mipToLoad);
        const mipType = getMipType(mipToLoad, header.optStreamedMipCount, header.streamedMipCount);
        
        if (mipType === MipType.RPak && pixelData && pixelData.length > 0) {
          // Load from permanent mips
          let offset = 0;
          for (let mip = header.mipCount - 1; mip > mipToLoad; mip--) {
            offset += calculateMipSize(header.width, header.height, header.format, mip);
          }
          const mipSize = calculateMipSize(header.width, header.height, header.format, mipToLoad);
          if (offset + mipSize <= pixelData.length) {
            mipPixelData = pixelData.slice(offset, offset + mipSize);
          }
        } else if ((mipType === MipType.StarPak || mipType === MipType.OptStarPak) && 
                   (starpakAvailable || optStarpakAvailable)) {
          // Load from starpak
          const isOpt = mipType === MipType.OptStarPak;
          const offset = isOpt ? optStarpakOffset : starpakOffset;
          
          try {
            const starpakResult = await loadTextureMipFromStarpak(
              offset,
              mipToLoad,
              {
                width: header.width,
                height: header.height,
                format: header.format,
                mipCount: header.mipCount,
                optStreamedMipCount: header.optStreamedMipCount,
                streamedMipCount: header.streamedMipCount,
                compTypePacked: header.compTypePacked,
                compressedBytes: header.compressedBytes,
              },
              isOpt
            );
            
            if (starpakResult) {
              let data = starpakResult.data;
              
              // Handle compression
              if (starpakResult.compressionType === 1) { // PAKFILE (RTech)
                try {
                  data = decompressRTech(data);
                } catch (e) {
                  console.warn('[UIImagePreview] RTech decompression failed:', e);
                }
              } else if (starpakResult.compressionType === 3) { // OODLE
                try {
                  const expectedSize = calculateMipSize(header.width, header.height, header.format, mipToLoad);
                  const oodleResult = await decompressOodle(data, expectedSize);
                  if (oodleResult) {
                    data = oodleResult;
                  }
                } catch (e) {
                  console.warn('[UIImagePreview] Oodle decompression failed:', e);
                }
              } else if (starpakResult.compressionType === 4) { // ZSTD (extended)
                try {
                  data = zstdDecompress(data);
                } catch (e) {
                  console.warn('[UIImagePreview] ZSTD decompression failed:', e);
                }
              }
              
              mipPixelData = data;
            }
          } catch (e) {
            console.warn('[UIImagePreview] Starpak load failed:', e);
          }
        }
        
        if (cancelled) return;
        
        if (!mipPixelData || mipPixelData.length === 0) {
          setAtlasLoadError('No texture data available');
          setIsLoadingAtlas(false);
          return;
        }
        
        // Decode to RGBA
        const rgba = decodeTextureToRGBA(mipPixelData, mipWidth, mipHeight, header.format);
        if (!rgba) {
          setAtlasLoadError('Failed to decode texture');
          setIsLoadingAtlas(false);
          return;
        }
        
        // Convert to data URL
        const dataUrl = rgbaToDataUrl(rgba, mipWidth, mipHeight);
        if (cancelled) return;
        
        setAtlasImageUrl(dataUrl);
        setIsLoadingAtlas(false);
      } catch (err) {
        if (!cancelled) {
          setAtlasLoadError((err as Error).message);
          setIsLoadingAtlas(false);
        }
      }
    };
    
    loadAtlasTexture();
    
    return () => {
      cancelled = true;
    };
  }, [atlasTexture, getTextureData]);

  // Filter images
  const filteredImages = useMemo(() => {
    if (!parsed) return [];
    
    if (!searchTerm) return parsed.images;
    
    const term = searchTerm.toLowerCase();
    return parsed.images.filter(img => 
      img.path.toLowerCase().includes(term) ||
      img.pathHash.toLowerCase().includes(term)
    );
  }, [parsed, searchTerm]);

  // Reset zoom/pan when asset changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [asset.guid]);

  // Attach wheel event listener with passive: false to allow preventDefault
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    const handleWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(prev => Math.max(0.5, Math.min(10, prev * delta)));
    };

    container.addEventListener('wheel', handleWheelNative, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheelNative);
    };
  }, [showAtlasMap]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0 && zoom > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  }, [zoom, pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomIn = useCallback(() => {
    setZoom(prev => Math.min(10, prev * 1.25));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom(prev => Math.max(0.5, prev * 0.8));
  }, []);

  if (!parsed) {
    return (
      <div className="uimg-preview">
        <div className="uimg-error">
          <span className="error-icon">⚠️</span>
          <span>Could not parse UI image atlas data</span>
        </div>
      </div>
    );
  }

  return (
    <div className="uimg-preview">
      <div className="uimg-header">
        <div className="uimg-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <rect x="7" y="7" width="4" height="4" />
            <rect x="13" y="7" width="4" height="4" />
            <rect x="7" y="13" width="4" height="4" />
            <rect x="13" y="13" width="4" height="4" />
          </svg>
        </div>
        <div className="uimg-title">
          <h3>UI Image Atlas</h3>
          <span className="uimg-name">{asset.name}</span>
        </div>
      </div>

      <div className="uimg-content">
        {/* Properties */}
        <div className="uimg-section">
          <h4>Atlas Properties</h4>
          <div className="uimg-properties">
            <div className="uimg-property">
              <span className="prop-label">Dimensions</span>
              <span className="prop-value">{parsed.width} × {parsed.height}</span>
            </div>
            <div className="uimg-property">
              <span className="prop-label">Width Ratio</span>
              <span className="prop-value">{parsed.widthRatio.toFixed(4)}</span>
            </div>
            <div className="uimg-property">
              <span className="prop-label">Height Ratio</span>
              <span className="prop-value">{parsed.heightRatio.toFixed(4)}</span>
            </div>
            <div className="uimg-property">
              <span className="prop-label">Image Count</span>
              <span className="prop-value">{parsed.textureCount}</span>
            </div>
            <div className="uimg-property">
              <span className="prop-label">Version</span>
              <span className="prop-value">v{asset.version || 10}</span>
            </div>
          </div>
        </div>

        {/* Atlas Texture Reference */}
        <div className="uimg-section">
          <h4>Atlas Texture</h4>
          <div className={`uimg-atlas-ref ${atlasTexture ? 'found' : 'missing'}`}>
            {atlasTexture ? (
              <>
                <span className="atlas-type">{atlasTexture.type}</span>
                <span className="atlas-name">{atlasTexture.name}</span>
              </>
            ) : (
              <>
                <span className="atlas-guid">{parsed.atlasGuid}</span>
                <span className="atlas-status">Not loaded</span>
              </>
            )}
          </div>
        </div>

        {/* Atlas Visual Map */}
        {(parsed.images.some(img => img.bounds) || atlasTexture) && (
          <div className="uimg-section">
            <div className="section-header-toggle">
              <h4>Atlas Map</h4>
              <div className="atlas-controls">
                <button className="zoom-btn" onClick={zoomOut} title="Zoom Out">−</button>
                <span className="zoom-level">{Math.round(zoom * 100)}%</span>
                <button className="zoom-btn" onClick={zoomIn} title="Zoom In">+</button>
                <button className="zoom-btn reset-btn" onClick={resetZoom} title="Reset Zoom">⟲</button>
                <button 
                  className="toggle-btn"
                  onClick={() => setShowAtlasMap(!showAtlasMap)}
                >
                  {showAtlasMap ? '▼' : '▶'}
                </button>
              </div>
            </div>
            {showAtlasMap && (
              <div 
                ref={mapContainerRef}
                className={`atlas-map-container ${isDragging ? 'dragging' : ''} ${zoom > 1 ? 'zoomable' : ''}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
              >
                {isLoadingAtlas && (
                  <div className="atlas-loading">Loading atlas texture...</div>
                )}
                {atlasLoadError && !isLoadingAtlas && (
                  <div className="atlas-load-error">⚠️ {atlasLoadError}</div>
                )}
                <svg 
                  className="atlas-map"
                  viewBox={`0 0 ${parsed.width} ${parsed.height}`}
                  preserveAspectRatio="xMidYMid meet"
                  style={{
                    transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                    transformOrigin: 'center center'
                  }}
                >
                  {/* Background - either texture or grid */}
                  <defs>
                    <pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse">
                      <path d="M 64 0 L 0 0 0 64" fill="none" stroke="#333" strokeWidth="1" opacity="0.3"/>
                    </pattern>
                    <pattern id="checkerboard" width="32" height="32" patternUnits="userSpaceOnUse">
                      <rect width="32" height="32" fill="#2a2a2a"/>
                      <rect width="16" height="16" fill="#1a1a1a"/>
                      <rect x="16" y="16" width="16" height="16" fill="#1a1a1a"/>
                    </pattern>
                  </defs>
                  
                  {/* Checkerboard background for transparency */}
                  <rect width={parsed.width} height={parsed.height} fill="url(#checkerboard)" />
                  
                  {/* Atlas texture image */}
                  {atlasImageUrl && (
                    <image
                      href={atlasImageUrl}
                      x="0"
                      y="0"
                      width={parsed.width}
                      height={parsed.height}
                      preserveAspectRatio="none"
                    />
                  )}
                  
                  {/* Sprite rectangles overlay */}
                  {parsed.images.map((img) => {
                    if (!img.bounds) return null;
                    const isHovered = hoveredSprite === img.index;
                    const isSelected = expandedImage === img.index;
                    const isFiltered = filteredImages.includes(img);
                    
                    return (
                      <g key={img.index}>
                        <rect
                          x={img.posX}
                          y={img.posY}
                          width={img.width}
                          height={img.height}
                          fill={isSelected ? 'rgba(0, 150, 255, 0.3)' : isHovered ? 'rgba(255, 200, 0, 0.2)' : 'transparent'}
                          stroke={isSelected ? '#0af' : isHovered ? '#fc0' : isFiltered ? 'rgba(255,255,255,0.3)' : 'transparent'}
                          strokeWidth={isSelected || isHovered ? 2 : 1}
                          className="sprite-rect"
                          onMouseEnter={() => setHoveredSprite(img.index)}
                          onMouseLeave={() => setHoveredSprite(null)}
                          onClick={() => setExpandedImage(expandedImage === img.index ? null : img.index)}
                          style={{ cursor: 'pointer' }}
                        />
                      </g>
                    );
                  })}
                </svg>
                
                {/* Hover info tooltip */}
                {hoveredSprite !== null && (
                  <div className="atlas-tooltip">
                    {(() => {
                      const img = parsed.images.find(i => i.index === hoveredSprite);
                      if (!img) return null;
                      return (
                        <>
                          <div className="tooltip-name">{img.path || img.pathHash}</div>
                          <div className="tooltip-coords">
                            Position: ({img.posX}, {img.posY}) | Size: {img.width}×{img.height}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Image Search */}
        <div className="uimg-section">
          <h4>Sprite Images ({parsed.textureCount})</h4>
          <div className="uimg-search">
            <input
              type="text"
              placeholder="Search images..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <span className="search-results">
                {filteredImages.length} of {parsed.images.length} images
              </span>
            )}
          </div>
          
          <div className="uimg-images">
            {filteredImages.map((img) => (
              <div 
                key={img.index} 
                className={`uimg-image ${expandedImage === img.index ? 'expanded' : ''} ${hoveredSprite === img.index ? 'hovered' : ''}`}
                onClick={() => setExpandedImage(expandedImage === img.index ? null : img.index)}
                onMouseEnter={() => setHoveredSprite(img.index)}
                onMouseLeave={() => setHoveredSprite(null)}
              >
                <div className="image-header">
                  <span className="image-index">{img.index}</span>
                  <span className="image-path">{img.path || img.pathHash}</span>
                  <span className="image-coords">
                    {img.bounds ? `${img.posX},${img.posY}` : ''}
                  </span>
                  <span className="image-size">{img.width}×{img.height}</span>
                </div>
                
                {expandedImage === img.index && (
                  <div className="image-details">
                    <div className="detail-row">
                      <span className="detail-label">Path Hash</span>
                      <span className="detail-value">{img.pathHash}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Dimensions</span>
                      <span className="detail-value">{img.dimensionsWidth} × {img.dimensionsHeight}</span>
                    </div>
                    {img.bounds && (
                      <>
                        <div className="detail-row">
                          <span className="detail-label">Atlas Position</span>
                          <span className="detail-value">
                            X: {img.posX}, Y: {img.posY}
                          </span>
                        </div>
                        <div className="detail-row">
                          <span className="detail-label">Sprite Size</span>
                          <span className="detail-value">
                            {img.width} × {img.height} px
                          </span>
                        </div>
                        <div className="detail-row">
                          <span className="detail-label">UV Bounds</span>
                          <span className="detail-value">
                            ({img.bounds.minX.toFixed(4)}, {img.bounds.minY.toFixed(4)}) → 
                            ({(img.bounds.minX + img.bounds.sizeX).toFixed(4)}, {(img.bounds.minY + img.bounds.sizeY).toFixed(4)})
                          </span>
                        </div>
                      </>
                    )}
                    <div className="detail-row">
                      <span className="detail-label">Crop Inset</span>
                      <span className="detail-value">
                        L: {img.offset.cropInsetLeft.toFixed(3)}, T: {img.offset.cropInsetTop.toFixed(3)}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Anchors</span>
                      <span className="detail-value">
                        Start: ({img.offset.startAnchorX.toFixed(3)}, {img.offset.startAnchorY.toFixed(3)}) 
                        End: ({img.offset.endAnchorX.toFixed(3)}, {img.offset.endAnchorY.toFixed(3)})
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Scale Ratio</span>
                      <span className="detail-value">
                        X: {img.offset.scaleRatioX.toFixed(4)}, Y: {img.offset.scaleRatioY.toFixed(4)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          
          {parsed.textureCount > 500 && (
            <div className="uimg-truncated">
              Showing {parsed.images.length} of {parsed.textureCount} images
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UIImagePreview;
