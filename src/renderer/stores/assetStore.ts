import { create } from 'zustand';
import { Asset, AssetType } from '../types/asset';
import { loadFile } from '../parsers/fileLoader';
import { ParsedRPak, RpakParser, ParsedAsset } from '../parsers/rpakParser';
import { parseTextureHeader, TextureAssetHeader, calculateMipSize, BytesPerPixel, isBlockCompressed, MipType, getMipType } from '../parsers/textureParser';
import { starpakManager, loadTextureMipFromStarpak } from '../parsers/starpakLoader';

// Store parsed RPaks for data access
const parsedRPakCache: Map<string, RpakParser> = new Map();

interface AssetState {
  // Loaded files
  loadedFiles: string[];
  
  // All assets from loaded files
  assets: Asset[];
  
  // Selection state
  selectedAsset: Asset | null;
  selectedAssets: Set<string>; // Set of GUIDs
  
  // Statistics
  assetStats: Record<string, number>;
  
  // Status
  status: string;
  progress: number | null;
  isLoading: boolean;
  
  // Actions
  loadFiles: (filePaths: string[]) => Promise<void>;
  loadFolder: (folderPath: string) => Promise<void>;
  selectAsset: (asset: Asset | null) => void;
  toggleAssetSelection: (guid: string) => void;
  clearSelection: () => void;
  clearAll: () => void;
  setStatus: (status: string, progress?: number | null) => void;
  getTextureData: (asset: Asset) => Promise<{ 
    header: TextureAssetHeader; 
    pixelData: Uint8Array;
    starpakOffset: bigint;
    optStarpakOffset: bigint;
    rpakPath: string;
  } | null>;
  getParser: (containerFile: string) => RpakParser | null;
}

// Create a simple reactive store (mimicking zustand without the dependency for now)
function createStore<T extends object>(
  initialState: T,
  actions: (set: (partial: Partial<T>) => void, get: () => T) => Partial<T>
): { getState: () => T; setState: (partial: Partial<T>) => void; subscribe: (listener: (state: T) => void) => () => void } & T {
  let state = { ...initialState };
  const listeners = new Set<(state: T) => void>();
  
  const set = (partial: Partial<T>) => {
    state = { ...state, ...partial };
    listeners.forEach((listener) => listener(state));
  };
  
  const get = () => state;
  
  const actionMethods = actions(set, get);
  
  return {
    ...state,
    ...actionMethods,
    getState: get,
    setState: set,
    subscribe: (listener: (state: T) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as any;
}

// For now, let's create a simple store with React hooks
import { useState, useCallback, useMemo } from 'react';

// Singleton state
let globalState: AssetState = {
  loadedFiles: [],
  assets: [],
  selectedAsset: null,
  selectedAssets: new Set(),
  assetStats: {},
  status: 'Ready',
  progress: null,
  isLoading: false,
  loadFiles: async () => {},
  loadFolder: async () => {},
  selectAsset: () => {},
  toggleAssetSelection: () => {},
  clearSelection: () => {},
  clearAll: () => {},
  setStatus: () => {},
  getTextureData: async () => null,
  getParser: () => null,
};

const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

export function useAssetStore(): AssetState {
  const [, forceUpdate] = useState({});
  
  // Subscribe to changes
  useState(() => {
    const listener = () => forceUpdate({});
    listeners.add(listener);
    return () => listeners.delete(listener);
  });

  const loadFiles = useCallback(async (filePaths: string[]) => {
    globalState = {
      ...globalState,
      isLoading: true,
      status: 'Loading files...',
      progress: 0,
    };
    notifyListeners();

    try {
      const newFiles = [...globalState.loadedFiles];
      const newAssets = [...globalState.assets];
      const warnings: string[] = [];

      for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i];
        
        if (!newFiles.includes(filePath)) {
          newFiles.push(filePath);
          
          // Parse the file using the file loader
          const result = await loadFile(filePath);
          
          if (result.success) {
            // Use for loop instead of spread to avoid stack overflow with large arrays
            for (const asset of result.assets) {
              newAssets.push(asset);
            }
            if (result.warnings) {
              for (const warning of result.warnings) {
                warnings.push(warning);
              }
            }
            // Cache the parser for texture data access
            if (result.rpakParser) {
              parsedRPakCache.set(filePath, result.rpakParser);
            }
          } else {
            console.error(`Failed to load ${filePath}: ${result.error}`);
            warnings.push(`Failed to load ${filePath.split(/[/\\]/).pop()}: ${result.error}`);
          }
        }

        globalState = {
          ...globalState,
          progress: ((i + 1) / filePaths.length) * 100,
          status: `Loading ${filePath.split(/[/\\]/).pop()}...`,
        };
        notifyListeners();
      }

      // Calculate stats
      const stats: Record<string, number> = {};
      for (const asset of newAssets) {
        stats[asset.type] = (stats[asset.type] || 0) + 1;
      }

      let statusMessage = `Loaded ${newAssets.length} assets from ${newFiles.length} files`;
      if (warnings.length > 0) {
        statusMessage += ` (${warnings.length} warnings)`;
        console.warn('Load warnings:', warnings);
      }

      globalState = {
        ...globalState,
        loadedFiles: newFiles,
        assets: newAssets,
        assetStats: stats,
        isLoading: false,
        status: statusMessage,
        progress: null,
      };
      notifyListeners();
    } catch (error) {
      console.error('Error loading files:', error);
      globalState = {
        ...globalState,
        isLoading: false,
        status: `Error: ${(error as Error).message}`,
        progress: null,
      };
      notifyListeners();
    }
  }, []);

  const loadFolder = useCallback(async (folderPath: string) => {
    globalState = {
      ...globalState,
      isLoading: true,
      status: 'Scanning folder...',
      progress: 0,
    };
    notifyListeners();

    try {
      const result = await window.electron.readDir(folderPath);
      
      if (result.success && result.data) {
        const supportedExtensions = ['rpak', 'starpak', 'mbnk', 'bsp', 'mdl', 'bpk'];
        const filesToLoad = result.data
          .filter((entry) => {
            if (entry.isDirectory) return false;
            const ext = entry.name.split('.').pop()?.toLowerCase();
            return ext && supportedExtensions.includes(ext);
          })
          .map((entry) => entry.path);

        if (filesToLoad.length > 0) {
          await loadFiles(filesToLoad);
        } else {
          globalState = {
            ...globalState,
            isLoading: false,
            status: 'No supported files found in folder',
            progress: null,
          };
          notifyListeners();
        }
      }
    } catch (error) {
      globalState = {
        ...globalState,
        isLoading: false,
        status: `Error: ${(error as Error).message}`,
        progress: null,
      };
      notifyListeners();
    }
  }, [loadFiles]);

  const selectAsset = useCallback((asset: Asset | null) => {
    globalState = {
      ...globalState,
      selectedAsset: asset,
      selectedAssets: asset ? new Set([asset.guid]) : new Set(),
    };
    notifyListeners();
  }, []);

  const toggleAssetSelection = useCallback((guid: string) => {
    const newSelection = new Set(globalState.selectedAssets);
    if (newSelection.has(guid)) {
      newSelection.delete(guid);
    } else {
      newSelection.add(guid);
    }
    
    globalState = {
      ...globalState,
      selectedAssets: newSelection,
    };
    notifyListeners();
  }, []);

  const clearSelection = useCallback(() => {
    globalState = {
      ...globalState,
      selectedAsset: null,
      selectedAssets: new Set(),
    };
    notifyListeners();
  }, []);

  const clearAll = useCallback(() => {
    globalState = {
      loadedFiles: [],
      assets: [],
      selectedAsset: null,
      selectedAssets: new Set(),
      assetStats: {},
      status: 'Ready',
      progress: null,
      isLoading: false,
      loadFiles: globalState.loadFiles,
      loadFolder: globalState.loadFolder,
      selectAsset: globalState.selectAsset,
      toggleAssetSelection: globalState.toggleAssetSelection,
      clearSelection: globalState.clearSelection,
      clearAll: globalState.clearAll,
      setStatus: globalState.setStatus,
      getTextureData: globalState.getTextureData,
      getParser: globalState.getParser,
    };
    notifyListeners();
  }, []);

  const setStatus = useCallback((status: string, progress: number | null = null) => {
    globalState = {
      ...globalState,
      status,
      progress,
    };
    notifyListeners();
  }, []);

  const getParser = useCallback((containerFile: string): RpakParser | null => {
    // Find the rpak file path in loaded files
    let rpakPath: string | undefined;
    for (const filePath of globalState.loadedFiles) {
      if (filePath.includes(containerFile) || filePath.endsWith(containerFile)) {
        rpakPath = filePath;
        break;
      }
    }
    
    if (!rpakPath) {
      // Try to find by just the filename
      rpakPath = globalState.loadedFiles.find(f => f.split(/[/\\]/).pop() === containerFile);
    }
    
    if (!rpakPath) return null;
    
    return parsedRPakCache.get(rpakPath) || null;
  }, []);

  const getTextureData = useCallback(async (asset: Asset): Promise<{ 
    header: TextureAssetHeader; 
    pixelData: Uint8Array;
    starpakOffset: bigint;
    optStarpakOffset: bigint;
    rpakPath: string;
  } | null> => {
    if (asset.type !== 'txtr') return null;
    
    const metadata = asset.metadata || {};
    let headerData = metadata.headerData;
    
    // Convert headerData to Uint8Array if needed (it may be serialized as an object)
    if (headerData && !(headerData instanceof Uint8Array)) {
      if (Array.isArray(headerData)) {
        headerData = new Uint8Array(headerData);
      } else if (typeof headerData === 'object') {
        const values = Object.values(headerData as Record<string, number>);
        headerData = new Uint8Array(values);
      }
    }
    
    if (!headerData || !(headerData instanceof Uint8Array)) {
      return null;
    }
    
    // Get starpak offsets from metadata
    let starpakOffset = 0n;
    let optStarpakOffset = 0n;
    
    if (metadata.starpakOffset !== undefined && metadata.starpakOffset !== null) {
      try {
        starpakOffset = BigInt(metadata.starpakOffset as string | number | bigint);
      } catch {
        starpakOffset = 0n;
      }
    }
    if (metadata.optStarpakOffset !== undefined && metadata.optStarpakOffset !== null) {
      try {
        optStarpakOffset = BigInt(metadata.optStarpakOffset as string | number | bigint);
      } catch {
        optStarpakOffset = 0n;
      }
    }
    
    // Parse the texture header - pass the asset version for correct header parsing
    const assetVersion = metadata.version as number || asset.version || 8;
    
    const header = parseTextureHeader({
      headerData: headerData as Uint8Array,
      guid: asset.guid,
      type: 0,
      typeFourCC: 'txtr',
      typeName: 'Texture',
      version: assetVersion,
      name: asset.name,
      headerSize: headerData.length,
      headPagePtr: metadata.headPagePtr as { index: number; offset: number } || { index: 0, offset: 0 },
      dataPagePtr: metadata.dataPagePtr as { index: number; offset: number } || { index: 0, offset: 0 },
      starpakOffset: starpakOffset,
      optStarpakOffset: optStarpakOffset,
      pageEnd: 0,
      dependentsCount: 0,
      dependenciesCount: 0,
    });
    
    if (!header) {
      return null;
    }
    
    // Try to get pixel data from the cached parser
    const containerFile = asset.containerFile;
    
    // Find the rpak file path in loaded files
    let rpakPath: string | undefined;
    for (const filePath of globalState.loadedFiles) {
      if (filePath.includes(containerFile) || filePath.endsWith(containerFile)) {
        rpakPath = filePath;
        break;
      }
    }
    
    if (!rpakPath) {
      // Try to find by just the filename
      rpakPath = globalState.loadedFiles.find(f => f.split(/[/\\]/).pop() === containerFile);
    }
    
    if (!rpakPath) return { header, pixelData: new Uint8Array(0), starpakOffset, optStarpakOffset, rpakPath: '' };
    
    const parser = parsedRPakCache.get(rpakPath);
    if (!parser) {
      return { header, pixelData: new Uint8Array(0), starpakOffset, optStarpakOffset, rpakPath };
    }
    
    // Get the data page pointer from metadata
    const dataPtr = metadata.dataPagePtr as { index: number; offset: number };
    
    if (!dataPtr) return { header, pixelData: new Uint8Array(0), starpakOffset, optStarpakOffset, rpakPath };
    
    // Calculate mip layout
    const totalStreamedMips = header.streamedMipCount + header.optStreamedMipCount;
    const totalMips = header.mipCount;
    const permanentMips = header.permanentMipCount;
    
    // Collect all mip data (streaming + permanent)
    const mipDataArray: Uint8Array[] = [];
    
    // Get rpak base path for starpak lookups (directory containing the rpak)
    const rpakBasePath = rpakPath.substring(0, rpakPath.lastIndexOf('\\')) || rpakPath.substring(0, rpakPath.lastIndexOf('/'));
    
    // First, try to load streaming mips from starpaks (mips 0 to totalStreamedMips-1)
    // These are in order: opt starpak mips first, then regular starpak mips
    for (let mip = 0; mip < totalStreamedMips; mip++) {
      // Determine if this mip is in opt starpak or regular starpak
      const isOptMip = mip < header.optStreamedMipCount;
      const mipOffset = isOptMip ? optStarpakOffset : starpakOffset;
      
      if (mipOffset === 0n || mipOffset === -1n) {
        // No streaming data for this mip, add empty placeholder or skip
        const mipSize = calculateMipSize(header.width, header.height, header.format, mip);
        mipDataArray.push(new Uint8Array(mipSize)); // Empty placeholder
        continue;
      }
      
      // Build header info for starpak loader
      const starpakHeader = {
        width: header.width,
        height: header.height,
        format: header.format,
        mipCount: header.mipCount,
        optStreamedMipCount: header.optStreamedMipCount,
        streamedMipCount: header.streamedMipCount,
        compTypePacked: 0, // Assume uncompressed for now
        compressedBytes: [0, 0, 0, 0, 0, 0, 0],
      };
      
      try {
        const mipResult = await loadTextureMipFromStarpak(
          mipOffset,
          mip,
          starpakHeader,
          isOptMip,
          rpakBasePath
        );
        
        if (mipResult && mipResult.data.length > 0) {
          mipDataArray.push(mipResult.data);
        } else {
          // Failed to load, add empty placeholder
          const mipSize = calculateMipSize(header.width, header.height, header.format, mip);
          mipDataArray.push(new Uint8Array(mipSize));
        }
      } catch (err) {
        console.warn(`[AssetStore] Failed to load streaming mip ${mip}:`, err);
        const mipSize = calculateMipSize(header.width, header.height, header.format, mip);
        mipDataArray.push(new Uint8Array(mipSize));
      }
    }
    
    // Then load permanent mips from rpak pages
    if (permanentMips > 0) {
      // Calculate total size for all non-streamed (permanent) mips
      let pixelDataSize = 0;
      for (let mip = totalStreamedMips; mip < totalMips; mip++) {
        const mipSize = calculateMipSize(header.width, header.height, header.format, mip);
        pixelDataSize += mipSize;
      }
      
      if (pixelDataSize > 0) {
        // Read pixel data from the data page
        const pageData = parser.getPageData(dataPtr.index);
        
        if (pageData) {
          const offset = dataPtr.offset;
          let actualSize = pixelDataSize;
          
          if (offset + pixelDataSize > pageData.length) {
            // Data extends beyond page, just get what we can
            actualSize = Math.min(pixelDataSize, pageData.length - offset);
          }
          
          if (actualSize > 0) {
            const permanentData = pageData.slice(offset, offset + actualSize);
            mipDataArray.push(permanentData);
          }
        }
      }
    }
    
    // Combine all mip data into a single buffer
    const totalSize = mipDataArray.reduce((sum, arr) => sum + arr.length, 0);
    const pixelData = new Uint8Array(totalSize);
    let writeOffset = 0;
    for (const mipData of mipDataArray) {
      pixelData.set(mipData, writeOffset);
      writeOffset += mipData.length;
    }
    
    return { header, pixelData, starpakOffset, optStarpakOffset, rpakPath };
  }, []);

  return {
    ...globalState,
    loadFiles,
    loadFolder,
    selectAsset,
    toggleAssetSelection,
    clearSelection,
    clearAll,
    setStatus,
    getParser,
    getTextureData,
  };
}
