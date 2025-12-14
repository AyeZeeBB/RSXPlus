/**
 * Oodle Decompression via FFI
 * 
 * This module provides Oodle decompression by loading the oo2core DLL
 * which can be obtained from games like Apex Legends, Warframe, Titanfall 2, etc.
 * 
 * The DLL should be placed in the app's resources folder or a configured path.
 */

import * as koffi from 'koffi';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

// Oodle function signature:
// OO_SINTa OodleLZ_Decompress(
//   const void* compBuf, OO_SINTa compBufSize,
//   void* rawBuf, OO_SINTa rawLen,
//   OodleLZ_FuzzSafe fuzzSafe,
//   OodleLZ_CheckCRC checkCRC,
//   OodleLZ_Verbosity verbosity,
//   void* decBufBase,
//   OO_SINTa decBufSize,
//   void* fpCallback,
//   void* callbackUserData,
//   void* decoderMemory,
//   OO_SINTa decoderMemorySize,
//   OodleLZ_Decode_ThreadPhase threadPhase
// )

// Oodle enums
export enum OodleLZ_FuzzSafe {
  No = 0,
  Yes = 1,
}

export enum OodleLZ_CheckCRC {
  No = 0,
  Yes = 1,
}

export enum OodleLZ_Verbosity {
  None = 0,
  Minimal = 1,
  Some = 2,
  Lots = 3,
}

export enum OodleLZ_Decode_ThreadPhase {
  Unthreaded = 0,
  ThreadPhase1 = 1,
  ThreadPhase2 = 2,
  ThreadPhaseAll = 3,
}

// Type for the OodleLZ_Decompress function
type OodleLZ_DecompressFunc = (
  compBuf: Buffer,
  compBufSize: number,
  rawBuf: Buffer,
  rawLen: number,
  fuzzSafe: number,
  checkCRC: number,
  verbosity: number,
  decBufBase: null,
  decBufSize: number,
  fpCallback: null,
  callbackUserData: null,
  decoderMemory: null,
  decoderMemorySize: number,
  threadPhase: number
) => number;

let oodleLib: koffi.IKoffiLib | null = null;
let oodleDecompressFunc: OodleLZ_DecompressFunc | null = null;
let oodleDllPath: string | null = null;

// Possible DLL names (different versions - newer versions first)
const OODLE_DLL_NAMES = [
  'oo2core_9_win64.dll',   // Apex Legends current
  'oo2core_8_win64.dll',
  'oo2core_7_win64.dll',
  'oo2core_6_win64.dll',
  'oo2core_5_win64.dll',
  'oo2core_4_win64.dll',
  'oo2core_3_win64.dll',
  'oo2core_2_win64.dll',
  'oo2core_win64.dll',
];

/**
 * Search for Oodle DLL in various locations
 */
function findOodleDll(): string | null {
  // Locations to search
  const searchPaths: string[] = [];

  // 1. App resources directory (packaged)
  if (app.isPackaged) {
    searchPaths.push(path.join(process.resourcesPath, 'oodle'));
    searchPaths.push(process.resourcesPath);
  }
  
  // 2. Development paths - relative to main.ts output location
  searchPaths.push(path.join(__dirname, '..', '..', 'resources', 'oodle'));
  searchPaths.push(path.join(__dirname, '..', '..', 'resources'));
  searchPaths.push(path.join(__dirname, '..', '..'));  // Project root
  searchPaths.push(path.join(__dirname, '..'));        // dist folder
  searchPaths.push(__dirname);                         // dist/main folder
  
  // 3. Source directory (for development)
  searchPaths.push(path.join(__dirname, '..', '..', 'src', 'main'));
  searchPaths.push(path.join(__dirname, '..', '..', 'src'));

  // 4. Current working directory
  searchPaths.push(process.cwd());
  searchPaths.push(path.join(process.cwd(), 'resources'));
  searchPaths.push(path.join(process.cwd(), 'resources', 'oodle'));

  // 5. User data directory
  searchPaths.push(path.join(app.getPath('userData'), 'oodle'));
  searchPaths.push(app.getPath('userData'));

  // 6. App directory
  searchPaths.push(path.dirname(app.getPath('exe')));

  // 7. Check common game install locations (multiple drive letters)
  const driveLetters = ['C', 'D', 'E', 'F', 'G'];
  for (const drive of driveLetters) {
    const gameLocations = [
      // Apex Legends (Steam library)
      `${drive}:\\SteamLibrary\\steamapps\\common\\Apex Legends`,
      `${drive}:\\Steam\\steamapps\\common\\Apex Legends`,
      // Default Steam path
      `${drive}:\\Program Files (x86)\\Steam\\steamapps\\common\\Apex Legends`,
      // Titanfall 2 (Steam)
      `${drive}:\\SteamLibrary\\steamapps\\common\\Titanfall2`,
      `${drive}:\\Program Files (x86)\\Steam\\steamapps\\common\\Titanfall2`,
      // Warframe (Steam)
      `${drive}:\\SteamLibrary\\steamapps\\common\\Warframe`,
      `${drive}:\\Program Files (x86)\\Steam\\steamapps\\common\\Warframe`,
      // EA Play / Origin
      `${drive}:\\Program Files\\EA Games\\Apex Legends`,
      `${drive}:\\Program Files (x86)\\Origin Games\\Apex Legends`,
    ];
    searchPaths.push(...gameLocations);
  }

  console.log('[Oodle] Searching for DLL in paths:', searchPaths);

  // Search for DLL
  for (const searchPath of searchPaths) {
    for (const dllName of OODLE_DLL_NAMES) {
      const fullPath = path.join(searchPath, dllName);
      try {
        if (fs.existsSync(fullPath)) {
          console.log(`[Oodle] Found DLL at: ${fullPath}`);
          return fullPath;
        }
      } catch {
        // Ignore access errors
      }
    }
  }

  console.log('[Oodle] DLL not found in any search path');
  return null;
}

/**
 * Initialize the Oodle library
 * @param customDllPath Optional custom path to the Oodle DLL
 * @returns true if initialization successful
 */
export function initOodle(customDllPath?: string): boolean {
  if (oodleLib !== null) {
    // Already initialized
    return true;
  }

  try {
    // Find the DLL
    oodleDllPath = customDllPath || findOodleDll();

    if (!oodleDllPath) {
      console.warn('[Oodle] No Oodle DLL found. Oodle decompression will not be available.');
      console.warn('[Oodle] To enable Oodle support, place oo2core_X_win64.dll in:');
      console.warn('[Oodle]   - The app\'s resources/oodle folder');
      console.warn('[Oodle]   - Your user data folder');
      console.warn('[Oodle]   - Or install a game that uses Oodle (Apex Legends, Warframe, etc.)');
      return false;
    }

    // Load the library
    oodleLib = koffi.load(oodleDllPath);

    // Define the function signature
    // OodleLZ_Decompress returns ssize_t (64-bit on 64-bit systems)
    const funcDef = oodleLib.func('int64 OodleLZ_Decompress(' +
      'const void* compBuf, ' +
      'int64 compBufSize, ' +
      'void* rawBuf, ' +
      'int64 rawLen, ' +
      'int fuzzSafe, ' +
      'int checkCRC, ' +
      'int verbosity, ' +
      'void* decBufBase, ' +
      'int64 decBufSize, ' +
      'void* fpCallback, ' +
      'void* callbackUserData, ' +
      'void* decoderMemory, ' +
      'int64 decoderMemorySize, ' +
      'int threadPhase' +
    ')');

    oodleDecompressFunc = funcDef as unknown as OodleLZ_DecompressFunc;

    console.log(`[Oodle] Successfully loaded Oodle from: ${oodleDllPath}`);
    return true;
  } catch (error) {
    console.error('[Oodle] Failed to load Oodle DLL:', error);
    oodleLib = null;
    oodleDecompressFunc = null;
    return false;
  }
}

/**
 * Check if Oodle is available
 */
export function isOodleAvailable(): boolean {
  return oodleDecompressFunc !== null;
}

/**
 * Get the path to the loaded Oodle DLL
 */
export function getOodleDllPath(): string | null {
  return oodleDllPath;
}

/**
 * Decompress Oodle-compressed data
 * @param compressedData The compressed data
 * @param decompressedSize The expected decompressed size
 * @returns Decompressed data, or null on failure
 */
export function decompressOodle(
  compressedData: Uint8Array | Buffer,
  decompressedSize: number
): Uint8Array | null {
  if (!oodleDecompressFunc) {
    // Try to initialize
    if (!initOodle()) {
      console.error('[Oodle] Oodle not available');
      return null;
    }
  }

  try {
    // Convert input to Buffer if needed
    const compBuf = Buffer.isBuffer(compressedData)
      ? compressedData
      : Buffer.from(compressedData);

    // Allocate output buffer
    const rawBuf = Buffer.alloc(decompressedSize);

    console.log(`[Oodle] Decompressing ${compBuf.length} bytes to ${decompressedSize} bytes`);
    console.log(`[Oodle] First 16 bytes: ${Array.from(compBuf.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

    // Call the decompression function
    const result = oodleDecompressFunc!(
      compBuf,
      compBuf.length,
      rawBuf,
      decompressedSize,
      OodleLZ_FuzzSafe.Yes,
      OodleLZ_CheckCRC.No,
      OodleLZ_Verbosity.None,
      null,
      0,
      null,
      null,
      null,
      0,
      OodleLZ_Decode_ThreadPhase.Unthreaded
    );

    console.log(`[Oodle] Decompression result: ${result}`);

    if (result <= 0) {
      console.error('[Oodle] Decompression failed, returned:', result);
      return null;
    }

    // Return the decompressed data (may be smaller than buffer if result < decompressedSize)
    if (result < decompressedSize) {
      return new Uint8Array(rawBuf.subarray(0, result));
    }

    return new Uint8Array(rawBuf);
  } catch (error) {
    console.error('[Oodle] Decompression error:', error);
    return null;
  }
}

/**
 * Cleanup - unload the Oodle library
 */
export function cleanupOodle(): void {
  if (oodleLib) {
    // koffi doesn't have an explicit unload, but we can clear references
    oodleLib = null;
    oodleDecompressFunc = null;
    oodleDllPath = null;
  }
}
