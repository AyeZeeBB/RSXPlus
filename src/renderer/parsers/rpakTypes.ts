/**
 * RPak file format structures
 * Ported from the C++ RSX implementation
 */

// Header flags
export const PAK_HEADER_FLAGS = {
  RTECH_ENCODED: 1 << 8,
  OODLE_ENCODED: 1 << 9,
  ZSTD_ENCODED: 1 << 15,
} as const;

export const PAK_HEADER_FLAGS_COMPRESSED = 
  PAK_HEADER_FLAGS.RTECH_ENCODED | 
  PAK_HEADER_FLAGS.OODLE_ENCODED | 
  PAK_HEADER_FLAGS.ZSTD_ENCODED;

// Segment flags
export const SEGMENT_FLAGS = {
  SF_CPU: 1 << 0,    // any data other than headers - "cpu" in rson
  SF_TEMP: 1 << 1,   // unk - "temp" in rson
  SF_SERVER: 1 << 5, // data that is only used on the server
  SF_CLIENT: 1 << 6, // data that is only used on the client
  SF_DEV: 1 << 7,    // dev-only data
} as const;

export const SF_TYPE_MASK = SEGMENT_FLAGS.SF_CPU | SEGMENT_FLAGS.SF_TEMP;

// Virtual segment header
export interface PakSegmentHeader {
  flags: number;
  align: number;
  size: bigint;
}

// Page header - each page corresponds to a separate section of data
export interface PakPageHeader {
  segment: number;
  align: number;
  size: number;
}

// Page pointer - represents a pointer to data in an RPak data page
export interface PagePtr {
  index: number;
  offset: number;
}

// Patch data header
export interface PakPatchDataHeader {
  patchDataStreamSize: number;
  patchPageCount: number;
}

// Patch file header
export interface PakPatchFileHeader {
  cmpSize: bigint;
  dcmpSize: bigint;
}

// Asset entry for version 6/7
export interface PakAssetV6 {
  guid: bigint;
  unk0: Uint8Array;  // 8 bytes
  headPagePtr: PagePtr;
  dataPagePtr: PagePtr;
  starpakOffset: bigint;
  pageEnd: number;
  remainingDependencyCount: number;
  dependentsIndex: number;
  dependenciesIndex: number;
  dependentsCount: number;
  dependenciesCount: number;
  headerStructSize: number;
  version: number;
  type: number;
}

// Asset entry for version 8+
export interface PakAssetV8 {
  guid: bigint;
  unk0: Uint8Array;  // 8 bytes
  headPagePtr: PagePtr;
  dataPagePtr: PagePtr;
  starpakOffset: bigint;
  optStarpakOffset: bigint;
  pageEnd: number;
  remainingDependencyCount: number;
  dependentsIndex: number;
  dependenciesIndex: number;
  dependentsCount: number;
  dependenciesCount: number;
  unk2: number;
  headerStructSize: number;
  version: number;
  type: number;
}

export type PakAssetEntry = PakAssetV6 | PakAssetV8;

// Unified asset structure
export interface PakAsset {
  guid: bigint;
  headPagePtr: PagePtr;
  dataPagePtr: PagePtr;
  starpakOffset: bigint;
  optStarpakOffset: bigint;
  pageEnd: number;
  remainingDependencyCount: number;
  dependentsIndex: number;
  dependenciesIndex: number;
  dependentsCount: number;
  dependenciesCount: number;
  headerStructSize: number;
  version: number;
  type: number;
  // Resolved pointers
  headPtr?: Uint8Array;
  dataPtr?: Uint8Array;
}

// Header for version 6
export interface PakHeaderV6 {
  magic: number;
  version: number;
  flags: number;
  createdTime: bigint;
  crc: bigint;
  size: bigint;
  pad_0020: Uint8Array;
  streamingFilesBufSize: number;
  numSegments: number;
  numPages: number;
  numPointers: number;
  numAssets: number;
  numGuidRefs: number;
  numDependencies: number;
  numExternalAssetRefs: number;
  externalAssetRefsSize: number;
  unk_0054: number;
}

// Header for version 7
export interface PakHeaderV7 {
  magic: number;
  version: number;
  flags: number;
  createdTime: bigint;
  crc: bigint;
  cmpSize: bigint;
  pad_0020: Uint8Array;
  dcmpSize: bigint;
  pad_0030: Uint8Array;
  streamingFilesBufSize: number;
  numSegments: number;
  numPages: number;
  patchCount: number;
  numPointers: number;
  numAssets: number;
  numGuidRefs: number;
  numDependencies: number;
  numExternalAssetRefs: number;
  externalAssetRefsSize: number;
}

// Header for version 8
export interface PakHeaderV8 {
  magic: number;
  version: number;
  flags: number;
  createdTime: bigint;
  crc: bigint;
  cmpSize: bigint;
  gap_20: Uint8Array;
  dcmpSize: bigint;
  gap_38: Uint8Array;
  streamingFilesBufSize: number;
  optStreamingFilesBufSize: number;
  numSegments: number;
  numPages: number;
  patchCount: number;
  pad: number;
  numPointers: number;
  numAssets: number;
  numGuidRefs: number;
  numDependencies: number;
  numExternalAssetRefs: number;
  externalAssetRefsSize: number;
  gap_6C: Uint8Array;
  unkDataSize_74: number;
  unkDataSize_78: number;
  gap_7C: Uint8Array;
}

// Unified header structure
export interface PakHeader {
  magic: number;
  version: number;
  flags: number;
  createdTime: bigint;
  crc: bigint;
  cmpSize: bigint;
  dcmpSize: bigint;
  streamingFilesBufSize: number;
  optStreamingFilesBufSize: number;
  numSegments: number;
  numPages: number;
  patchCount: number;
  numPointers: number;
  numAssets: number;
  numGuidRefs: number;
  numDependencies: number;
  numExternalAssetRefs: number;
  externalAssetRefsSize: number;
  unkDataSize_74: number;
  unkDataSize_78: number;
  // Computed values
  pakHdrSize: number;
  pakAssetSize: number;
}

// RPak magic number
export const RPAK_MAGIC = 0x6B615052; // 'RPak' in little endian

// Header sizes
export const HEADER_SIZES = {
  V6: 0x58,
  V7: 0x58,
  V8: 0x80,
} as const;

// Asset sizes
export const ASSET_SIZES = {
  V6: 0x48,
  V8: 0x50,
} as const;
