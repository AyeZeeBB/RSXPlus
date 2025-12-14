import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Asset } from '../types/asset';
import { 
  TextureFormatNames, 
  decodeTextureToRGBA, 
  rgbaToDataUrl, 
  TextureAssetHeader, 
  calculateMipSize,
  isBlockCompressed,
  BytesPerPixel,
  MipType,
  getMipType,
  CompressionType,
} from '../parsers/textureParser';
import { useAssetStore } from '../stores/assetStore';
import { loadTextureMipFromStarpak, starpakManager, decodeStarpakOffset } from '../parsers/starpakLoader';
import { decompress as zstdDecompress } from 'fzstd';
import { decompressRTech } from '../utils/rtechDecompress';
import { decompressOodle } from '../utils/oodleDecompress';
import './TexturePreview.css';

interface TexturePreviewProps {
  asset: Asset;
}

type BackgroundType = 'checkerboard' | 'black' | 'white' | 'transparent';
type ChannelMode = 'rgba' | 'rgb' | 'r' | 'g' | 'b' | 'a';

/**
 * Check if texture format is a normal map format (BC5)
 */
function isNormalMapFormat(format: number): boolean {
  // BC5_UNORM = 8, BC5_SNORM = 9
  return format === 8 || format === 9;
}

/**
 * Calculate normal Z from X and Y components
 * Based on RSX's GetNormalZFromXY function from dx.cpp
 */
function getNormalZFromXY(x: number, y: number): number {
  const xm = (2.0 * x) - 1.0;
  const ym = (2.0 * y) - 1.0;
  
  const a = 1.0 - (xm * xm) - (ym * ym);
  
  if (a < 0.0) {
    return 0.5;
  }
  
  const sq = Math.sqrt(a);
  return (sq / 2.0) + 0.5;
}

/**
 * Reconstruct normal map Z channel from X and Y
 * Based on RSX's ConvertNormalOpenDX function
 */
function reconstructNormalMap(rgba: Uint8Array): Uint8Array {
  const output = new Uint8Array(rgba.length);
  
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];     // X component
    const g = rgba[i + 1]; // Y component
    
    // Normalize to 0-1 range for Z calculation
    const x = r / 255.0;
    const y = g / 255.0;
    
    // Calculate Z using RSX formula
    const z = getNormalZFromXY(x, y);
    
    // Output: R=X, G=Y, B=Z (calculated), A=255
    output[i] = r;
    output[i + 1] = g;
    output[i + 2] = Math.round(z * 255);
    output[i + 3] = 255;
  }
  
  return output;
}

interface MipInfo {
  level: number;
  width: number;
  height: number;
  type: MipType;
  available: boolean; // Whether this mip can be loaded
}

interface MipData {
  level: number;
  width: number;
  height: number;
  dataUrl: string | null;
  error?: string;
  isLoading?: boolean;
}

export const TexturePreview: React.FC<TexturePreviewProps> = ({ asset }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  
  // State
  const [header, setHeader] = useState<TextureAssetHeader | null>(null);
  const [allPixelData, setAllPixelData] = useState<Uint8Array | null>(null);
  const [currentMip, setCurrentMip] = useState(0);
  const [mipData, setMipData] = useState<MipData | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [background, setBackground] = useState<BackgroundType>('checkerboard');
  const [channelMode, setChannelMode] = useState<ChannelMode>('rgba');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Starpak data
  const [starpakOffset, setStarpakOffset] = useState<bigint>(0n);
  const [optStarpakOffset, setOptStarpakOffset] = useState<bigint>(0n);
  const [rpakPath, setRpakPath] = useState<string>('');
  const [optStarpakAvailable, setOptStarpakAvailable] = useState<boolean>(false);
  const [starpakAvailable, setStarpakAvailable] = useState<boolean>(false);
  
  // Cache for loaded starpak mips
  const [starpakMipCache, setStarpakMipCache] = useState<Map<number, Uint8Array>>(new Map());
  
  // Normal map reconstruction toggle
  const [reconstructNormals, setReconstructNormals] = useState<boolean>(true);
  
  const { getTextureData } = useAssetStore();

  // Load texture data
  useEffect(() => {
    setIsLoading(true);
    setError(null);
    setHeader(null);
    setAllPixelData(null);
    setCurrentMip(0);
    setMipData(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setStarpakMipCache(new Map());
    setStarpakAvailable(false);
    setOptStarpakAvailable(false);
    
    (async () => {
      try {
        const result = await getTextureData(asset);
        
        if (!result || !result.header) {
          setError('Failed to load texture header');
          setIsLoading(false);
          return;
        }
        
        setHeader(result.header);
        setAllPixelData(result.pixelData);
        setStarpakOffset(result.starpakOffset);
        setOptStarpakOffset(result.optStarpakOffset);
        setRpakPath(result.rpakPath);
        
        // Check starpak availability
        const hasStarpakMips = result.header.streamedMipCount > 0;
        const hasOptStarpakMips = result.header.optStreamedMipCount > 0;
        
        let starpakAvail = false;
        if (hasStarpakMips && result.starpakOffset !== 0n) {
          const { index } = decodeStarpakOffset(result.starpakOffset);
          starpakAvail = await starpakManager.checkStarpakExists(index, false);
          setStarpakAvailable(starpakAvail);
          console.log('[TexturePreview] StarPak available:', starpakAvail);
        }
        
        let optAvailable = false;
        if (hasOptStarpakMips && result.optStarpakOffset !== 0n) {
          const { index } = decodeStarpakOffset(result.optStarpakOffset);
          optAvailable = await starpakManager.checkStarpakExists(index, true);
          setOptStarpakAvailable(optAvailable);
          console.log('[TexturePreview] OptStarPak available:', optAvailable);
        }
        
        // Find the highest available mip (lowest mip index that's available)
        // Mip 0 = highest resolution, higher indices = lower resolution
        const totalStreamedMips = result.header.streamedMipCount + result.header.optStreamedMipCount;
        let bestMip = totalStreamedMips; // Default to first permanent mip
        
        // Check if we can get a higher resolution mip from starpaks
        if (starpakAvail && result.header.streamedMipCount > 0) {
          // Starpak mips start at optStreamedMipCount
          bestMip = result.header.optStreamedMipCount;
        }
        if (optAvailable && result.header.optStreamedMipCount > 0) {
          // OptStarpak has the highest res mips (starting at 0)
          bestMip = 0;
        }
        
        console.log('[TexturePreview] Selecting best available mip:', bestMip);
        setCurrentMip(bestMip);
        setIsLoading(false);
      } catch (err) {
        setError((err as Error).message);
        setIsLoading(false);
      }
    })();
  }, [asset, getTextureData]);

  // Decode current mip level (handles both permanent and streamed mips)
  useEffect(() => {
    if (!header) return;
    
    const mipWidth = Math.max(1, header.width >> currentMip);
    const mipHeight = Math.max(1, header.height >> currentMip);
    const mipType = getMipType(currentMip, header.optStreamedMipCount, header.streamedMipCount);
    
    // Determine the total streamed mip count
    const totalStreamedMips = header.optStreamedMipCount + header.streamedMipCount;
    const totalMips = header.mipCount;
    
    console.log('[TexturePreview] Decoding mip:', {
      currentMip,
      mipType: MipType[mipType],
      optStreamedMipCount: header.optStreamedMipCount,
      streamedMipCount: header.streamedMipCount,
      permanentMipCount: header.permanentMipCount,
      totalMips,
    });
    
    // Handle different mip types
    const loadMip = async () => {
      if (mipType === MipType.RPak) {
        // Permanent mip - load from cached pixel data
        if (!allPixelData || allPixelData.length === 0) {
          setMipData({
            level: currentMip,
            width: mipWidth,
            height: mipHeight,
            dataUrl: null,
            error: 'Permanent mip data not loaded',
          });
          return;
        }
        
        // Permanent mips are stored from SMALLEST to LARGEST (bottom-to-top order)
        // Calculate offset to this mip within our pixel data
        let offset = 0;
        for (let mip = totalMips - 1; mip > currentMip; mip--) {
          offset += calculateMipSize(header.width, header.height, header.format, mip);
        }
        
        const mipSize = calculateMipSize(header.width, header.height, header.format, currentMip);
        
        if (offset + mipSize > allPixelData.length) {
          setMipData({
            level: currentMip,
            width: mipWidth,
            height: mipHeight,
            dataUrl: null,
            error: 'Insufficient pixel data',
          });
          return;
        }
        
        try {
          const mipPixelData = allPixelData.slice(offset, offset + mipSize);
          await decodeMipToImage(mipPixelData, mipWidth, mipHeight);
        } catch (err) {
          setMipData({
            level: currentMip,
            width: mipWidth,
            height: mipHeight,
            dataUrl: null,
            error: (err as Error).message,
          });
        }
      } else if (mipType === MipType.StarPak) {
        // Streamed mip - load from starpak
        if (!starpakAvailable || starpakOffset === 0n) {
          setMipData({
            level: currentMip,
            width: mipWidth,
            height: mipHeight,
            dataUrl: null,
            error: 'StarPak not available',
          });
          return;
        }
        
        // Check cache first
        if (starpakMipCache.has(currentMip)) {
          const cachedData = starpakMipCache.get(currentMip)!;
          await decodeMipToImage(cachedData, mipWidth, mipHeight);
          return;
        }
        
        setMipData({
          level: currentMip,
          width: mipWidth,
          height: mipHeight,
          dataUrl: null,
          isLoading: true,
        });
        
        await loadStarpakMip(currentMip, mipWidth, mipHeight, false);
      } else if (mipType === MipType.OptStarPak) {
        // Optional streamed mip - load from opt.starpak
        if (!optStarpakAvailable || optStarpakOffset === 0n) {
          setMipData({
            level: currentMip,
            width: mipWidth,
            height: mipHeight,
            dataUrl: null,
            error: 'OptStarPak not available',
          });
          return;
        }
        
        // Check cache first
        if (starpakMipCache.has(currentMip)) {
          const cachedData = starpakMipCache.get(currentMip)!;
          await decodeMipToImage(cachedData, mipWidth, mipHeight);
          return;
        }
        
        setMipData({
          level: currentMip,
          width: mipWidth,
          height: mipHeight,
          dataUrl: null,
          isLoading: true,
        });
        
        await loadStarpakMip(currentMip, mipWidth, mipHeight, true);
      }
    };
    
    loadMip();
  }, [header, allPixelData, currentMip, channelMode, reconstructNormals, starpakAvailable, optStarpakAvailable, starpakOffset, optStarpakOffset, starpakMipCache]);

  // Get the rpak base path from the asset's container file
  const rpakBasePath = React.useMemo(() => {
    const rpakPath = asset.containerFile;
    return rpakPath ? rpakPath.substring(0, Math.max(rpakPath.lastIndexOf('/'), rpakPath.lastIndexOf('\\'))) : undefined;
  }, [asset.containerFile]);

  // Load a mip from starpak
  const loadStarpakMip = async (mip: number, mipWidth: number, mipHeight: number, isOpt: boolean) => {
    if (!header) return;
    
    const offset = isOpt ? optStarpakOffset : starpakOffset;
    
    console.log(`[TexturePreview] Loading ${isOpt ? 'opt' : ''} starpak mip ${mip}`);
    
    try {
      const result = await loadTextureMipFromStarpak(
        offset,
        mip,
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
        isOpt,
        rpakBasePath
      );
      
      if (!result) {
        setMipData({
          level: mip,
          width: mipWidth,
          height: mipHeight,
          dataUrl: null,
          error: `Failed to load ${isOpt ? 'opt' : ''}starpak mip`,
        });
        return;
      }
      
      let pixelData = result.data;
      
      // Decompress if needed
      if (result.compressed) {
        const expectedSize = calculateMipSize(header.width, header.height, header.format, mip);
        console.log(`[TexturePreview] Decompressing mip (type: ${result.compressionType}), compressed: ${result.data.length} bytes, expected decompressed: ${expectedSize} bytes`);
        console.log(`[TexturePreview] First 16 bytes of compressed data:`, Array.from(result.data.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' '));
        
        if (result.compressionType === CompressionType.PAKFILE) {
          // RTech PAKFILE decompression
          try {
            pixelData = decompressRTech(result.data);
            console.log(`[TexturePreview] RTech decompressed: ${result.data.length} -> ${pixelData.length} (expected: ${expectedSize})`);
          } catch (e) {
            console.warn('[TexturePreview] RTech decompression failed:', e);
            // Try using as-is
            pixelData = result.data;
          }
        } else if (result.compressionType === CompressionType.OODLE) {
          // Oodle decompression via native DLL
          try {
            const decompressed = await decompressOodle(result.data, expectedSize);
            if (decompressed) {
              pixelData = decompressed;
              console.log(`[TexturePreview] Oodle decompressed: ${result.data.length} -> ${pixelData.length} (expected: ${expectedSize})`);
            } else {
              console.warn('[TexturePreview] Oodle decompression returned null');
              pixelData = result.data;
            }
          } catch (e) {
            console.warn('[TexturePreview] Oodle decompression failed:', e);
            pixelData = result.data;
          }
        } else if (result.compressionType === 4) {
          // ZSTD decompression (extended type, used in newer games)
          const expectedSize = calculateMipSize(header.width, header.height, header.format, mip);
          try {
            pixelData = zstdDecompress(result.data);
            console.log(`[TexturePreview] ZSTD decompressed: ${result.data.length} -> ${pixelData.length} (expected: ${expectedSize})`);
          } catch (e) {
            console.warn('[TexturePreview] ZSTD decompression failed:', e);
            // Try using as-is and hope for the best
            pixelData = result.data;
          }
        } else {
          console.warn(`[TexturePreview] Unknown compression type: ${result.compressionType}`);
          // Try using as-is
        }
      }
      
      // Cache the decompressed data
      setStarpakMipCache(prev => new Map(prev).set(mip, pixelData));
      
      // Decode and display
      await decodeMipToImage(pixelData, mipWidth, mipHeight);
    } catch (err) {
      setMipData({
        level: mip,
        width: mipWidth,
        height: mipHeight,
        dataUrl: null,
        error: (err as Error).message,
      });
    }
  };

  // Decode mip pixel data to displayable image
  const decodeMipToImage = async (pixelData: Uint8Array, mipWidth: number, mipHeight: number) => {
    if (!header) return;
    
    try {
      let rgba = decodeTextureToRGBA(pixelData, mipWidth, mipHeight, header.format);
      
      // Apply normal map reconstruction for BC5 formats
      if (reconstructNormals && isNormalMapFormat(header.format)) {
        rgba = reconstructNormalMap(rgba);
      }
      
      // Apply channel filter
      if (channelMode !== 'rgba') {
        rgba = applyChannelFilter(rgba, channelMode);
      }
      
      const dataUrl = rgbaToDataUrl(rgba, mipWidth, mipHeight);
      
      setMipData({
        level: currentMip,
        width: mipWidth,
        height: mipHeight,
        dataUrl,
      });
    } catch (err) {
      setMipData({
        level: currentMip,
        width: mipWidth,
        height: mipHeight,
        dataUrl: null,
        error: (err as Error).message,
      });
    }
  };

  // Apply channel filter to RGBA data
  const applyChannelFilter = (rgba: Uint8Array, mode: ChannelMode): Uint8Array => {
    const result = new Uint8Array(rgba.length);
    
    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const a = rgba[i + 3];
      
      switch (mode) {
        case 'rgb':
          result[i] = r;
          result[i + 1] = g;
          result[i + 2] = b;
          result[i + 3] = 255;
          break;
        case 'r':
          result[i] = r;
          result[i + 1] = r;
          result[i + 2] = r;
          result[i + 3] = 255;
          break;
        case 'g':
          result[i] = g;
          result[i + 1] = g;
          result[i + 2] = g;
          result[i + 3] = 255;
          break;
        case 'b':
          result[i] = b;
          result[i + 1] = b;
          result[i + 2] = b;
          result[i + 3] = 255;
          break;
        case 'a':
          result[i] = a;
          result[i + 1] = a;
          result[i + 2] = a;
          result[i + 3] = 255;
          break;
        default:
          result[i] = r;
          result[i + 1] = g;
          result[i + 2] = b;
          result[i + 3] = a;
      }
    }
    
    return result;
  };

  // Zoom handlers
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(prev => Math.min(Math.max(prev * delta, 0.1), 20));
  }, []);

  const handleZoomIn = () => setZoom(prev => Math.min(prev * 1.25, 20));
  const handleZoomOut = () => setZoom(prev => Math.max(prev / 1.25, 0.1));
  const handleZoomReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  const handleZoomFit = useCallback(() => {
    if (!containerRef.current || !mipData) return;
    const container = containerRef.current;
    const scaleX = (container.clientWidth - 40) / mipData.width;
    const scaleY = (container.clientHeight - 40) / mipData.height;
    setZoom(Math.min(scaleX, scaleY, 1));
    setPan({ x: 0, y: 0 });
  }, [mipData]);

  // Auto-fit when mip data changes
  useEffect(() => {
    if (mipData && mipData.dataUrl && containerRef.current) {
      // Delay slightly to ensure container is rendered
      const timer = setTimeout(() => {
        handleZoomFit();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [mipData, handleZoomFit]);

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) { // Left click
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Mip level helpers - with type and availability information
  const availableMips: MipInfo[] = header ? Array.from(
    { length: header.mipCount }, 
    (_, i) => {
      const mipType = getMipType(i, header.optStreamedMipCount, header.streamedMipCount);
      let available = false;
      
      switch (mipType) {
        case MipType.RPak:
          available = true; // Permanent mips are always available
          break;
        case MipType.StarPak:
          available = starpakAvailable && starpakOffset !== 0n;
          break;
        case MipType.OptStarPak:
          available = optStarpakAvailable && optStarpakOffset !== 0n;
          break;
      }
      
      return {
        level: i,
        width: Math.max(1, header.width >> i),
        height: Math.max(1, header.height >> i),
        type: mipType,
        available,
      };
    }
  ) : [];

  const backgroundClass = `texture-bg-${background}`;

  if (isLoading) {
    return (
      <div className="texture-preview-loading">
        <div className="loading-spinner" />
        <span>Loading texture...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="texture-preview-error">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <p>Failed to load texture</p>
        <span className="error-details">{error}</span>
      </div>
    );
  }

  return (
    <div className="texture-preview-enhanced">
      {/* Toolbar */}
      <div className="texture-toolbar">
        {/* Zoom controls */}
        <div className="toolbar-group">
          <button onClick={handleZoomOut} title="Zoom Out (-)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>
          <span className="zoom-level">{Math.round(zoom * 100)}%</span>
          <button onClick={handleZoomIn} title="Zoom In (+)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>
          <button onClick={handleZoomReset} title="Reset Zoom (1:1)">1:1</button>
          <button onClick={handleZoomFit} title="Fit to View">Fit</button>
        </div>

        <div className="toolbar-separator" />

        {/* Mip level selector */}
        <div className="toolbar-group">
          <label>Mip:</label>
          <select 
            value={currentMip} 
            onChange={(e) => setCurrentMip(parseInt(e.target.value))}
            className="mip-selector"
          >
            {availableMips.map(mip => {
              const typeLabel = mip.type === MipType.RPak ? '' : 
                              mip.type === MipType.StarPak ? ' [starpak]' : ' [opt]';
              const unavailableReason = !mip.available ? 
                (mip.type === MipType.OptStarPak ? ' (unavailable)' : ' (unavailable)') : '';
              
              return (
                <option key={mip.level} value={mip.level} disabled={!mip.available}>
                  {mip.level} ({mip.width}×{mip.height}){typeLabel}{unavailableReason}
                </option>
              );
            })}
          </select>
        </div>

        <div className="toolbar-separator" />

        {/* Channel selector */}
        <div className="toolbar-group channel-buttons">
          {(['rgba', 'rgb', 'r', 'g', 'b', 'a'] as ChannelMode[]).map(mode => (
            <button
              key={mode}
              className={`channel-btn channel-${mode} ${channelMode === mode ? 'active' : ''}`}
              onClick={() => setChannelMode(mode)}
              title={`View ${mode.toUpperCase()} channel`}
            >
              {mode.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="toolbar-separator" />

        {/* Background selector */}
        <div className="toolbar-group background-buttons">
          <button 
            className={`bg-btn ${background === 'checkerboard' ? 'active' : ''}`}
            onClick={() => setBackground('checkerboard')}
            title="Checkerboard Background"
          >
            <svg viewBox="0 0 16 16" fill="currentColor">
              <rect x="0" y="0" width="8" height="8" />
              <rect x="8" y="8" width="8" height="8" />
            </svg>
          </button>
          <button 
            className={`bg-btn ${background === 'black' ? 'active' : ''}`}
            onClick={() => setBackground('black')}
            title="Black Background"
          >
            <svg viewBox="0 0 16 16">
              <rect x="0" y="0" width="16" height="16" fill="#000" stroke="#666" strokeWidth="1" />
            </svg>
          </button>
          <button 
            className={`bg-btn ${background === 'white' ? 'active' : ''}`}
            onClick={() => setBackground('white')}
            title="White Background"
          >
            <svg viewBox="0 0 16 16">
              <rect x="0" y="0" width="16" height="16" fill="#fff" stroke="#666" strokeWidth="1" />
            </svg>
          </button>
        </div>

        {/* Normal map reconstruction toggle (only shown for BC5 formats) */}
        {header && isNormalMapFormat(header.format) && (
          <>
            <div className="toolbar-separator" />
            <div className="toolbar-group">
              <button
                className={`nml-btn ${reconstructNormals ? 'active' : ''}`}
                onClick={() => setReconstructNormals(!reconstructNormals)}
                title={reconstructNormals ? 'Show raw BC5 data' : 'Reconstruct normal map Z channel'}
              >
                NML
              </button>
            </div>
          </>
        )}
      </div>

      {/* Image viewport */}
      <div 
        ref={containerRef}
        className={`texture-viewport ${backgroundClass}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {mipData?.dataUrl ? (
          <img
            ref={imageRef}
            src={mipData.dataUrl}
            alt={asset.name}
            className="texture-image"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              cursor: isDragging ? 'grabbing' : 'grab',
            }}
            draggable={false}
          />
        ) : mipData?.isLoading ? (
          <div className="texture-loading-overlay">
            <div className="loading-spinner" />
            <span>Loading starpak mip...</span>
          </div>
        ) : mipData?.error ? (
          <div className="texture-unavailable">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="3" x2="21" y2="21" />
            </svg>
            <p>{mipData.error}</p>
          </div>
        ) : null}
      </div>

      {/* Info bar */}
      <div className="texture-info-bar">
        <span className="info-item">
          <strong>Size:</strong> {header?.width} × {header?.height}
        </span>
        <span className="info-item">
          <strong>Format:</strong> {header ? (TextureFormatNames[header.format] || `Unknown (${header.format})`) : '-'}
        </span>
        <span className="info-item">
          <strong>Mips:</strong> {header?.mipCount || 0} 
          ({header?.permanentMipCount || 0} perm, {header?.streamedMipCount || 0} stream, {header?.optStreamedMipCount || 0} opt)
        </span>
        {mipData && (
          <span className="info-item">
            <strong>Current:</strong> {mipData.width} × {mipData.height}
          </span>
        )}
        {header && (header.streamedMipCount > 0 || header.optStreamedMipCount > 0) && (
          <span className="info-item">
            <strong>StarPak:</strong> {starpakAvailable ? '✓' : '✗'} 
            {header.optStreamedMipCount > 0 && ` | OptStarPak: ${optStarpakAvailable ? '✓' : '✗'}`}
          </span>
        )}
        {header?.arraySize && header.arraySize > 1 && (
          <span className="info-item">
            <strong>Array:</strong> {header.arraySize} slices
          </span>
        )}
      </div>
    </div>
  );
};
