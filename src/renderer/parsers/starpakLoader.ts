/**
 * StarPak streaming data loader
 * Loads streaming data (vertex data, textures, etc.) from .starpak files
 */

import { BinaryReader } from '../utils/binaryUtils';

export interface StarpakEntry {
  offset: bigint;
  size: bigint;
}

export interface StarpakFile {
  filePath: string;
  entries: Map<bigint, bigint>; // offset -> size
}

/**
 * Parse a starpak file to get its entry table
 * The entry table is at the END of the file
 */
export async function parseStarpakEntries(filePath: string): Promise<StarpakFile | null> {
  try {
    // First get the file size
    const statResult = await window.electron.stat(filePath);
    if (!statResult.success || !statResult.data) {
      return null;
    }
    
    const fileSize = statResult.data.size;
    
    // Read just the entry count (last 8 bytes)
    const countResult = await window.electron.readFileRange(filePath, fileSize - 8, 8);
    if (!countResult.success || !countResult.data) {
      return null;
    }
    
    // Convert to Uint8Array
    let countArray: Uint8Array;
    if (countResult.data instanceof Uint8Array) {
      countArray = countResult.data;
    } else if (typeof countResult.data === 'object' && 'data' in countResult.data) {
      countArray = new Uint8Array((countResult.data as any).data);
    } else {
      const values = Object.values(countResult.data) as number[];
      countArray = new Uint8Array(values);
    }
    
    const countReader = new BinaryReader(countArray);
    const entryCount = countReader.readUint64();
    
    // Each entry is 16 bytes (offset: u64, size: u64)
    const entryTableSize = Number(entryCount) * 16;
    const entryTableStart = fileSize - 8 - entryTableSize;
    
    // Read the entry table
    const tableResult = await window.electron.readFileRange(filePath, entryTableStart, entryTableSize);
    if (!tableResult.success || !tableResult.data) {
      return null;
    }
    
    // Convert to Uint8Array
    let tableArray: Uint8Array;
    if (tableResult.data instanceof Uint8Array) {
      tableArray = tableResult.data;
    } else if (typeof tableResult.data === 'object' && 'data' in tableResult.data) {
      tableArray = new Uint8Array((tableResult.data as any).data);
    } else {
      const values = Object.values(tableResult.data) as number[];
      tableArray = new Uint8Array(values);
    }
    
    const reader = new BinaryReader(tableArray);
    const entries = new Map<bigint, bigint>();
    
    for (let i = 0; i < Number(entryCount); i++) {
      const offset = reader.readUint64();
      const size = reader.readUint64();
      
      // Skip invalid entries (size 0)
      if (size > 0n) {
        entries.set(offset, size);
      }
    }

    return {
      filePath,
      entries,
    };
  } catch (err) {
    console.error(`[StarpakLoader] Error parsing starpak ${filePath}:`, err);
    return null;
  }
}

/**
 * Read data from a starpak file at a specific offset
 */
export async function readStarpakData(
  filePath: string,
  offset: bigint,
  size: bigint
): Promise<Uint8Array | null> {
  try {
    // Read the specific range from the file
    const result = await window.electron.readFileRange(filePath, Number(offset), Number(size));
    if (!result.success || !result.data) {
      return null;
    }

    // Convert to Uint8Array - data could be Uint8Array or serialized form
    let uint8Array: Uint8Array;
    const data = result.data as unknown;
    if (data instanceof Uint8Array) {
      uint8Array = data;
    } else if (typeof data === 'object' && data !== null) {
      // Handle serialized Uint8Array (from IPC) which comes as object with 'data' property or numbered keys
      if ('data' in data && Array.isArray((data as Record<string, unknown>).data)) {
        uint8Array = new Uint8Array((data as { data: number[] }).data);
      } else {
        const values = Object.values(data as Record<string, number>);
        uint8Array = new Uint8Array(values);
      }
    } else {
      return null;
    }

    return uint8Array;
  } catch (err) {
    console.error(`[StarpakLoader] Error reading starpak data:`, err);
    return null;
  }
}

/**
 * Decode starpak offset value
 * Lower 12 bits = starpak file index
 * Upper bits = actual offset in file
 */
export function decodeStarpakOffset(value: bigint): { index: number; offset: bigint } {
  const index = Number(value & 0xFFFn);
  const offset = value & 0xFFFFFFFFFFFFF000n;
  return { index, offset };
}

/**
 * Get the size of streaming data for an asset from the starpak entry table
 */
export function getStarpakEntrySize(
  starpak: StarpakFile,
  offset: bigint
): bigint | null {
  return starpak.entries.get(offset) ?? null;
}

/**
 * StarpakManager - manages loaded starpak files
 */
export class StarpakManager {
  private starpaks: Map<string, StarpakFile> = new Map();
  // Store starpak lists per rpak base path
  private starpakListsByPath: Map<string, string[]> = new Map();
  private optStarpakListsByPath: Map<string, string[]> = new Map();
  // Active/default base path
  private activeBasePath: string = '';

  /**
   * Initialize with starpak paths from an RPak
   * Now stores paths per-rpak so multiple rpaks can have their own starpaks
   */
  async initialize(
    basePath: string,
    streamingFiles: string[],
    optStreamingFiles: string[]
  ): Promise<void> {
    // Store for this specific rpak path
    this.starpakListsByPath.set(basePath, streamingFiles);
    this.optStarpakListsByPath.set(basePath, optStreamingFiles);
    // Set as active path (most recently loaded)
    this.activeBasePath = basePath;
  }

  /**
   * Get starpak lists for a specific rpak path, or active path if not specified
   */
  getStarpakListsForPath(basePath?: string): { starpakList: string[]; optStarpakList: string[] } {
    const path = basePath || this.activeBasePath;
    return {
      starpakList: this.starpakListsByPath.get(path) || [],
      optStarpakList: this.optStarpakListsByPath.get(path) || [],
    };
  }

  /**
   * Get the full path to a starpak file
   * @param index - The starpak index from the asset's encoded offset
   * @param isOpt - Whether to look in opt starpaks
   * @param basePath - Optional base path to look up (uses active path if not specified)
   */
  getStarpakPath(index: number, isOpt: boolean, basePath?: string): string | null {
    const path = basePath || this.activeBasePath;
    const lists = this.getStarpakListsForPath(path);
    const list = isOpt ? lists.optStarpakList : lists.starpakList;
    
    if (index < 0 || index >= list.length) {
      return null;
    }

    const filePath = list[index];
    // Extract just the filename from the path (the rpak stores relative paths like "paks\Win64\file.starpak")
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    // Starpak is in the same directory as the rpak
    // Use backslash for Windows paths
    const separator = path.includes('\\') ? '\\' : '/';
    return `${path}${separator}${fileName}`;
  }

  /**
   * Load and cache a starpak file's entry table
   */
  private async loadStarpak(path: string): Promise<StarpakFile | null> {
    if (this.starpaks.has(path)) {
      return this.starpaks.get(path)!;
    }

    const starpak = await parseStarpakEntries(path);
    if (starpak) {
      this.starpaks.set(path, starpak);
    }
    return starpak;
  }

  /**
   * Read streaming data for an asset
   * @param starpakOffset - The encoded starpak offset from the asset
   * @param isOpt - Whether to read from opt starpak
   * @param basePath - Optional base path to look up starpaks for (uses active if not specified)
   */
  async readStreamingData(
    starpakOffset: bigint,
    isOpt: boolean = false,
    basePath?: string
  ): Promise<Uint8Array | null> {
    // Check for invalid offset (-1 or 0)
    if (starpakOffset === -1n || starpakOffset === 0n) {
      return null;
    }

    // Decode the offset value
    const { index, offset } = decodeStarpakOffset(starpakOffset);

    // Get the starpak path
    const starpakPath = this.getStarpakPath(index, isOpt, basePath);
    if (!starpakPath) {
      return null;
    }

    // Load the starpak entry table
    const starpak = await this.loadStarpak(starpakPath);
    if (!starpak) {
      return null;
    }

    // Get the size from the entry table
    const size = getStarpakEntrySize(starpak, offset);
    if (!size) {
      return null;
    }

    // Read the actual data
    return readStarpakData(starpakPath, offset, size);
  }

  /**
   * Check if a starpak file exists
   */
  async checkStarpakExists(index: number, isOpt: boolean, basePath?: string): Promise<boolean> {
    const starpakPath = this.getStarpakPath(index, isOpt, basePath);
    if (!starpakPath) return false;
    
    try {
      const statResult = await window.electron.stat(starpakPath);
      return statResult.success && !!statResult.data;
    } catch {
      return false;
    }
  }

  /**
   * Get the starpak paths for checking availability
   */
  getStarpakPaths(basePath?: string): { starpaks: string[]; optStarpaks: string[] } {
    const lists = this.getStarpakListsForPath(basePath);
    return {
      starpaks: lists.starpakList.map((_, i) => this.getStarpakPath(i, false, basePath) || ''),
      optStarpaks: lists.optStarpakList.map((_, i) => this.getStarpakPath(i, true, basePath) || ''),
    };
  }

  /**
   * Clear cached starpak data
   */
  clear(): void {
    this.starpaks.clear();
    this.starpakListsByPath.clear();
    this.optStarpakListsByPath.clear();
    this.activeBasePath = '';
  }
}

// Global singleton
export const starpakManager = new StarpakManager();

/**
 * Load texture streaming data for a specific mip from starpak/optStarpak
 * This handles the offset calculation based on which mips precede this one
 * 
 * @param starpakOffset - The base starpak offset from the asset (for this starpak type)
 * @param mipIndex - The mip level to load (0 = highest res)
 * @param header - The texture header with mip count info
 * @param isOpt - Whether to load from opt.starpak
 * @param rpakBasePath - The base path of the rpak this texture comes from
 */
export async function loadTextureMipFromStarpak(
  starpakOffset: bigint,
  mipIndex: number,
  header: {
    width: number;
    height: number;
    format: number;
    mipCount: number;
    optStreamedMipCount: number;
    streamedMipCount: number;
    compTypePacked: number;
    compressedBytes: number[];
  },
  isOpt: boolean,
  rpakBasePath?: string
): Promise<{ data: Uint8Array; compressed: boolean; compressionType: number } | null> {
  if (starpakOffset === 0n || starpakOffset === -1n) {
    return null;
  }

  const { index, offset: baseOffset } = decodeStarpakOffset(starpakOffset);
  
  // Get the starpak paths to find the correct file (use rpakBasePath if provided)
  const starpakPath = starpakManager.getStarpakPath(index, isOpt, rpakBasePath);
  if (!starpakPath) {
    return null;
  }

  // Load the starpak entry table
  const starpak = await starpakManager['loadStarpak'](starpakPath);
  if (!starpak) {
    return null;
  }

  // Determine the mip range for this starpak type
  // Mip layout: [0..optStreamedMipCount-1] = OptStarPak, [optStreamedMipCount..optStreamedMipCount+streamedMipCount-1] = StarPak
  const startMipForStorage = isOpt ? 0 : header.optStreamedMipCount;
  const totalStreamedMips = header.streamedMipCount + header.optStreamedMipCount;
  
  // On PC (retail), textures use SORT_MIXED mode:
  // - Permanent mips: stored bottom to top (highest resolution first)
  // - Streamed mips: stored TOP to bottom (also highest resolution first, i.e., lowest mip index first)
  //
  // This means mip 0 (highest res) is at offset 0 in the starpak,
  // mip 1 is at offset = mip0.size, etc.
  //
  // To read mip N, we sum the sizes of mips 0 through N-1 (within this starpak's range)
  
  // Calculate offset by summing sizes of all mips from startMipForStorage up to mipIndex
  let mipOffset = 0;
  
  for (let m = startMipForStorage; m < mipIndex; m++) {
    // compIdx = m for streamed mip at index m
    const compIdx = m;
    
    // Check if this mip is compressed (2 bits per mip in compTypePacked)
    const compType = (header.compTypePacked >> (2 * compIdx)) & 3;
    let mipSize: number;
    
    if (compType !== 0 && compIdx < 7) {
      // Compressed - use compressedBytes
      const compValue = header.compressedBytes[compIdx];
      mipSize = compValue > 0 ? ((compValue + 1) << 12) : 0; // (value + 1) * 4096
    } else {
      // Uncompressed - calculate normally with alignment
      mipSize = calculateMipSizeAligned(header.width, header.height, header.format, m);
    }
    
    mipOffset += mipSize;
  }

  // Calculate this mip's size using the same compIdx logic
  const compIdx = mipIndex;
  const compType = (header.compTypePacked >> (2 * compIdx)) & 3;
  let thisMipSize: number;
  
  if (compType !== 0 && compIdx < 7) {
    const compValue = header.compressedBytes[compIdx];
    thisMipSize = compValue > 0 ? ((compValue + 1) << 12) : 0;
  } else {
    thisMipSize = calculateMipSizeAligned(header.width, header.height, header.format, mipIndex);
  }

  console.log(`[starpakLoader] Mip ${mipIndex} loading:`, {
    starpakPath,
    baseOffset: baseOffset.toString(),
    mipOffset,
    finalOffset: (baseOffset + BigInt(mipOffset)).toString(),
    thisMipSize,
    compType,
    compIdx,
    totalStreamedMips,
    compTypePacked: header.compTypePacked.toString(2).padStart(16, '0'),
    compressedBytes: header.compressedBytes,
  });

  if (thisMipSize === 0) {
    return null;
  }

  const finalOffset = baseOffset + BigInt(mipOffset);

  // Read the data
  const data = await readStarpakData(starpakPath, finalOffset, BigInt(thisMipSize));
  if (!data) {
    return null;
  }

  return {
    data,
    compressed: compType !== 0,
    compressionType: compType,
  };
}

/**
 * Calculate mip size with 16-byte alignment (for streaming data)
 */
function calculateMipSizeAligned(width: number, height: number, format: number, mipLevel: number): number {
  const w = Math.max(1, width >> mipLevel);
  const h = Math.max(1, height >> mipLevel);
  
  // Block-compressed formats (BC1-BC7)
  const isBC = format >= 0 && format <= 13;
  
  if (isBC) {
    const blocksX = Math.max(1, Math.ceil(w / 4));
    const blocksY = Math.max(1, Math.ceil(h / 4));
    const bytesPerBlock = [8, 8, 16, 16, 16, 16, 8, 8, 16, 16, 16, 16, 16, 16][format] || 16;
    const slicePitch = blocksX * blocksY * bytesPerBlock;
    return Math.ceil(slicePitch / 16) * 16; // Align to 16
  } else {
    // Uncompressed - assume 4 bytes per pixel for common formats
    const bpp = 4; // This should be looked up properly
    const slicePitch = w * h * bpp;
    return Math.ceil(slicePitch / 16) * 16;
  }
}
