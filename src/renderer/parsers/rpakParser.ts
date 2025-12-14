/**
 * RPak file format parser
 * Ported from the C++ RSX implementation
 */

import { BinaryReader } from '../utils/binaryUtils';
import {
  PakHeader,
  PakAsset,
  PakSegmentHeader,
  PakPageHeader,
  PagePtr,
  RPAK_MAGIC,
  HEADER_SIZES,
  ASSET_SIZES,
  PAK_HEADER_FLAGS,
  PAK_HEADER_FLAGS_COMPRESSED,
  SF_TYPE_MASK,
  SEGMENT_FLAGS,
} from './rpakTypes';
import { fourCCToString, getAssetTypeName } from './assetTypes';
import { decompress as zstdDecompress } from 'fzstd';
import { decompressRTech } from '../utils/rtechDecompress';
import { decompressOodle } from '../utils/oodleDecompress';

// Compression type enum
export enum CompressionType {
  NONE = 0,
  RTECH = 1,
  OODLE = 2,
  ZSTD = 3,
}

export interface ParsedRPak {
  header: PakHeader;
  segments: PakSegmentHeader[];
  pages: PakPageHeader[];
  assets: ParsedAsset[];
  fileName: string;
  filePath: string;
  isCompressed: boolean;
  compressionType: CompressionType;
  isPatched: boolean;
  streamingFiles: string[];
  optStreamingFiles: string[];
}

export interface ParsedAsset {
  guid: string;
  type: number;
  typeFourCC: string;
  typeName: string;
  version: number;
  name: string;
  headerSize: number;
  headPagePtr: PagePtr;
  dataPagePtr: PagePtr;
  starpakOffset: bigint;
  optStarpakOffset: bigint;
  pageEnd: number;
  dependentsIndex: number;
  dependenciesIndex: number;
  dependentsCount: number;
  dependenciesCount: number;
  // Data pointers (resolved after page building)
  headerData?: Uint8Array;
  dataBuffer?: Uint8Array;
}

interface RPakVirtualSegment {
  type: number;
  dataSize: number;
}

interface RPakMemPage {
  virtualSegmentIndex: number;
  pageAlignment: number;
  dataSize: number;
}

// GuidRef is a page pointer to a GUID
interface GuidRef {
  pageIndex: number;
  pageOffset: number;
}

export class RPakParser {
  private reader: BinaryReader;
  private header!: PakHeader;
  private segments: PakSegmentHeader[] = [];
  private pages: PakPageHeader[] = [];
  private pageBuffers: Uint8Array[] = [];
  private assets: ParsedAsset[] = [];
  private guidRefs: GuidRef[] = [];
  private streamingFiles: string[] = [];
  private optStreamingFiles: string[] = [];
  private fileName: string;
  private filePath: string;
  private fileBuffer: Uint8Array;
  private patchDataStreamSize: number = 0;
  private patchPageCount: number = 0;

  constructor(buffer: ArrayBuffer | Uint8Array, filePath: string) {
    this.fileBuffer = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
    this.reader = new BinaryReader(this.fileBuffer);
    this.filePath = filePath;
    this.fileName = filePath.split(/[/\\]/).pop() || 'unknown';
  }

  /**
   * Parse the RPak file
   */
  async parse(): Promise<ParsedRPak> {
    console.log(`[RPakParser] Starting parse. Buffer size: ${this.fileBuffer.length} bytes, File: ${this.fileName}`);
    
    // Parse header
    this.parseHeader();

    console.log(`[RPakParser] Header parsed: version=${this.header.version}, flags=0x${this.header.flags.toString(16)}`);
    console.log(`[RPakParser] Sizes: pakHdrSize=${this.header.pakHdrSize}, pakAssetSize=${this.header.pakAssetSize}`);
    console.log(`[RPakParser] Counts: segments=${this.header.numSegments}, pages=${this.header.numPages}, assets=${this.header.numAssets}`);
    console.log(`[RPakParser] Streaming: filesBufSize=${this.header.streamingFilesBufSize}, optFilesBufSize=${this.header.optStreamingFilesBufSize}`);
    console.log(`[RPakParser] Patch: patchCount=${this.header.patchCount}`);
    console.log(`[RPakParser] cmpSize=${this.header.cmpSize}, dcmpSize=${this.header.dcmpSize}`);

    // Detect compression type
    const compressionType = this.getCompressionType();
    const isCompressed = compressionType !== CompressionType.NONE;
    
    // Handle ZSTD decompression
    if (compressionType === CompressionType.ZSTD) {
      await this.decompressZstd();
    } else if (compressionType === CompressionType.RTECH) {
      // RTech PAKFILE decompression
      await this.decompressRTech();
    } else if (compressionType === CompressionType.OODLE) {
      // Oodle decompression via native DLL
      await this.decompressOodle();
    }

    // Start reading after header
    this.reader.seek(this.header.pakHdrSize);

    // If patched, read patch data header first
    if (this.header.patchCount > 0) {
      this.parsePatchData();
    }

    // Parse streaming file paths (reads from current position)
    this.parseStreamingFiles();
    console.log(`[RPakParser] After streaming files: position=${this.reader.position}, streamingFiles=${this.streamingFiles.length}, optStreamingFiles=${this.optStreamingFiles.length}`);

    // Parse segments
    this.parseSegments();
    console.log(`[RPakParser] After segments: position=${this.reader.position}, parsed ${this.segments.length} segments`);

    // Parse pages
    this.parsePages();
    console.log(`[RPakParser] After pages: position=${this.reader.position}, parsed ${this.pages.length} pages`);

    // Build page buffers
    this.buildPageBuffers();

    // Parse assets
    this.parseAssets();
    console.log(`[RPakParser] Parsed ${this.assets.length} assets`);

    return {
      header: this.header,
      segments: this.segments,
      pages: this.pages,
      assets: this.assets,
      fileName: this.fileName,
      filePath: this.filePath,
      isCompressed,
      compressionType,
      isPatched: this.header.patchCount > 0,
      streamingFiles: this.streamingFiles,
      optStreamingFiles: this.optStreamingFiles,
    };
  }

  /**
   * Detect the compression type from header flags
   */
  private getCompressionType(): CompressionType {
    if (this.header.flags & PAK_HEADER_FLAGS.ZSTD_ENCODED) {
      return CompressionType.ZSTD;
    }
    if (this.header.flags & PAK_HEADER_FLAGS.OODLE_ENCODED) {
      return CompressionType.OODLE;
    }
    if (this.header.flags & PAK_HEADER_FLAGS.RTECH_ENCODED) {
      return CompressionType.RTECH;
    }
    return CompressionType.NONE;
  }

  /**
   * Decompress ZSTD-compressed data
   */
  private async decompressZstd(): Promise<void> {
    // Get the compressed data after the header
    const headerSize = this.header.pakHdrSize;
    const compressedData = this.fileBuffer.slice(headerSize);
    
    // Get expected decompressed size
    const decompressedSize = Number(this.header.dcmpSize) - headerSize;
    
    try {
      // Decompress using fzstd
      const decompressed = zstdDecompress(compressedData);
      
      // Create new buffer with header + decompressed data
      const newBuffer = new Uint8Array(headerSize + decompressed.length);
      newBuffer.set(this.fileBuffer.slice(0, headerSize), 0);
      newBuffer.set(decompressed, headerSize);
      
      // Replace the file buffer and reader
      this.fileBuffer = newBuffer;
      this.reader = new BinaryReader(this.fileBuffer);
      
      // Re-seek to after header
      this.reader.seek(headerSize);
      
      console.log(`ZSTD decompression successful: ${compressedData.length} -> ${decompressed.length} bytes`);
    } catch (error) {
      throw new Error(`ZSTD decompression failed: ${(error as Error).message}`);
    }
  }

  /**
   * Decompress RTech PAKFILE-compressed data
   */
  private async decompressRTech(): Promise<void> {
    // Get the compressed data after the header
    const headerSize = this.header.pakHdrSize;
    const compressedData = this.fileBuffer.slice(headerSize);
    
    try {
      // Decompress using RTech decompressor
      const decompressed = decompressRTech(compressedData, 0);
      
      // Create new buffer with header + decompressed data
      const newBuffer = new Uint8Array(headerSize + decompressed.length);
      newBuffer.set(this.fileBuffer.slice(0, headerSize), 0);
      newBuffer.set(decompressed, headerSize);
      
      // Replace the file buffer and reader
      this.fileBuffer = newBuffer;
      this.reader = new BinaryReader(this.fileBuffer);
      
      // Re-seek to after header
      this.reader.seek(headerSize);
      
      console.log(`RTech decompression successful: ${compressedData.length} -> ${decompressed.length} bytes`);
    } catch (error) {
      throw new Error(`RTech decompression failed: ${(error as Error).message}`);
    }
  }

  /**
   * Decompress the RPak file using Oodle via native DLL
   */
  private async decompressOodle(): Promise<void> {
    // Get the compressed data after the header
    const headerSize = this.header.pakHdrSize;
    const compressedData = this.fileBuffer.slice(headerSize);
    const decompressedSize = Number(this.header.dcmpSize);
    
    console.log(`[RPakParser] Attempting Oodle decompression: ${compressedData.length} -> ${decompressedSize} bytes`);
    
    try {
      // Decompress using Oodle decompressor (via IPC to main process)
      const decompressed = await decompressOodle(compressedData, decompressedSize);
      
      if (!decompressed) {
        throw new Error('Oodle decompression returned null - DLL may not be available');
      }
      
      // Create new buffer with header + decompressed data
      const newBuffer = new Uint8Array(headerSize + decompressed.length);
      newBuffer.set(this.fileBuffer.slice(0, headerSize), 0);
      newBuffer.set(decompressed, headerSize);
      
      // Replace the file buffer and reader
      this.fileBuffer = newBuffer;
      this.reader = new BinaryReader(this.fileBuffer);
      
      // Re-seek to after header
      this.reader.seek(headerSize);
      
      console.log(`[RPakParser] Oodle decompression successful: ${compressedData.length} -> ${decompressed.length} bytes`);
    } catch (error) {
      throw new Error(`Oodle decompression failed: ${(error as Error).message}`);
    }
  }

  /**
   * Parse the RPak header
   */
  private parseHeader(): void {
    const magic = this.reader.readUint32();
    
    if (magic !== RPAK_MAGIC) {
      throw new Error(`Invalid RPak magic: expected 0x${RPAK_MAGIC.toString(16)}, got 0x${magic.toString(16)}`);
    }

    const version = this.reader.readUint16();
    const flags = this.reader.readUint16();

    // Determine header and asset sizes based on version
    let pakHdrSize: number;
    let pakAssetSize: number;

    if (version <= 6) {
      pakHdrSize = HEADER_SIZES.V6;
      pakAssetSize = ASSET_SIZES.V6;
    } else if (version === 7) {
      pakHdrSize = HEADER_SIZES.V7;
      pakAssetSize = ASSET_SIZES.V6;
    } else {
      pakHdrSize = HEADER_SIZES.V8;
      pakAssetSize = ASSET_SIZES.V8;
    }

    // Reset and read full header
    this.reader.seek(0);

    if (version <= 6) {
      this.header = this.parseHeaderV6(pakHdrSize, pakAssetSize);
    } else if (version === 7) {
      this.header = this.parseHeaderV7(pakHdrSize, pakAssetSize);
    } else {
      this.header = this.parseHeaderV8(pakHdrSize, pakAssetSize);
    }
  }

  private parseHeaderV6(pakHdrSize: number, pakAssetSize: number): PakHeader {
    const magic = this.reader.readUint32();
    const version = this.reader.readUint16();
    const flags = this.reader.readUint16();
    const createdTime = this.reader.readUint64();
    const crc = this.reader.readUint64();
    const size = this.reader.readUint64();
    this.reader.skip(16); // pad_0020
    const streamingFilesBufSize = this.reader.readUint32();
    const numSegments = this.reader.readUint16();
    const numPages = this.reader.readUint16();
    const numPointers = this.reader.readUint32();
    const numAssets = this.reader.readUint32();
    const numGuidRefs = this.reader.readUint32();
    const numDependencies = this.reader.readUint32();
    const numExternalAssetRefs = this.reader.readUint32();
    const externalAssetRefsSize = this.reader.readUint32();
    this.reader.readUint32(); // unk_0054

    return {
      magic,
      version,
      flags,
      createdTime,
      crc,
      cmpSize: size,
      dcmpSize: size,
      streamingFilesBufSize,
      optStreamingFilesBufSize: 0,
      numSegments,
      numPages,
      patchCount: 0,
      numPointers,
      numAssets,
      numGuidRefs,
      numDependencies,
      numExternalAssetRefs,
      externalAssetRefsSize,
      unkDataSize_74: 0,
      unkDataSize_78: 0,
      pakHdrSize,
      pakAssetSize,
    };
  }

  private parseHeaderV7(pakHdrSize: number, pakAssetSize: number): PakHeader {
    const magic = this.reader.readUint32();
    const version = this.reader.readUint16();
    const flags = this.reader.readUint16();
    const createdTime = this.reader.readUint64();
    const crc = this.reader.readUint64();
    const cmpSize = this.reader.readUint64();
    this.reader.skip(8); // pad_0020
    const dcmpSize = this.reader.readUint64();
    this.reader.skip(8); // pad_0030
    const streamingFilesBufSize = this.reader.readUint32();
    const numSegments = this.reader.readUint16();
    const numPages = this.reader.readUint16();
    const patchCount = this.reader.readUint16();
    this.reader.skip(2); // padding
    const numPointers = this.reader.readUint32();
    const numAssets = this.reader.readUint32();
    const numGuidRefs = this.reader.readUint32();
    const numDependencies = this.reader.readUint32();
    const numExternalAssetRefs = this.reader.readUint32();
    const externalAssetRefsSize = this.reader.readUint32();

    return {
      magic,
      version,
      flags,
      createdTime,
      crc,
      cmpSize,
      dcmpSize,
      streamingFilesBufSize,
      optStreamingFilesBufSize: 0,
      numSegments,
      numPages,
      patchCount,
      numPointers,
      numAssets,
      numGuidRefs,
      numDependencies,
      numExternalAssetRefs,
      externalAssetRefsSize,
      unkDataSize_74: 0,
      unkDataSize_78: 0,
      pakHdrSize,
      pakAssetSize,
    };
  }

  private parseHeaderV8(pakHdrSize: number, pakAssetSize: number): PakHeader {
    const magic = this.reader.readUint32();
    const version = this.reader.readUint16();
    const flags = this.reader.readUint16();
    const createdTime = this.reader.readUint64();
    const crc = this.reader.readUint64();
    const cmpSize = this.reader.readUint64();
    this.reader.skip(16); // gap_20 is 16 bytes
    const dcmpSize = this.reader.readUint64();
    this.reader.skip(16); // gap_38 is 16 bytes
    const streamingFilesBufSize = this.reader.readUint16(); // short, not int
    const optStreamingFilesBufSize = this.reader.readUint16(); // short, not int
    const numSegments = this.reader.readUint16();
    const numPages = this.reader.readUint16();
    const patchCount = this.reader.readUint16();
    this.reader.skip(2); // pad
    const numPointers = this.reader.readUint32();
    const numAssets = this.reader.readUint32();
    const numGuidRefs = this.reader.readUint32();
    const numDependencies = this.reader.readUint32();
    const numExternalAssetRefs = this.reader.readUint32();
    const externalAssetRefsSize = this.reader.readUint32();
    this.reader.skip(8); // gap_6C
    const unkDataSize_74 = this.reader.readUint32();
    const unkDataSize_78 = this.reader.readUint32();
    this.reader.skip(4); // gap_7C

    return {
      magic,
      version,
      flags,
      createdTime,
      crc,
      cmpSize,
      dcmpSize,
      streamingFilesBufSize,
      optStreamingFilesBufSize,
      numSegments,
      numPages,
      patchCount,
      numPointers,
      numAssets,
      numGuidRefs,
      numDependencies,
      numExternalAssetRefs,
      externalAssetRefsSize,
      unkDataSize_74,
      unkDataSize_78,
      pakHdrSize,
      pakAssetSize,
    };
  }

  /**
   * Parse streaming file paths (reads from current position)
   */
  private parseStreamingFiles(): void {
    // Read regular streaming files
    if (this.header.streamingFilesBufSize > 0) {
      const streamingBuf = this.reader.readBytes(this.header.streamingFilesBufSize);
      this.streamingFiles = this.parseNullTerminatedStrings(streamingBuf);
    }

    // Read optional streaming files (v8+)
    if (this.header.optStreamingFilesBufSize > 0) {
      const optStreamingBuf = this.reader.readBytes(this.header.optStreamingFilesBufSize);
      this.optStreamingFiles = this.parseNullTerminatedStrings(optStreamingBuf);
    }
  }

  /**
   * Parse null-terminated strings from buffer
   */
  private parseNullTerminatedStrings(buffer: Uint8Array): string[] {
    const strings: string[] = [];
    let current = '';

    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i] === 0) {
        if (current.length > 0) {
          strings.push(current);
          current = '';
        }
      } else {
        current += String.fromCharCode(buffer[i]);
      }
    }

    if (current.length > 0) {
      strings.push(current);
    }

    return strings;
  }

  /**
   * Parse patch data section (comes right after header)
   */
  private parsePatchData(): void {
    if (this.header.patchCount === 0) return;

    console.log(`[RPakParser] Parsing patch data at position ${this.reader.position}`);

    // Read patch data header (8 bytes: int patchDataStreamSize + int patchPageCount)
    this.patchDataStreamSize = this.reader.readUint32();
    this.patchPageCount = this.reader.readUint32();

    console.log(`[RPakParser] Patch data: streamSize=${this.patchDataStreamSize}, pageCount=${this.patchPageCount}`);

    // Skip patch file header - PakPatchFileHdr_t = 16 bytes (int64 cmpSize + int64 dcmpSize)
    this.reader.skip(16);
    
    // Skip additional patch count related data (short * patchCount)
    this.reader.skip(this.header.patchCount * 2);
  }

  /**
   * Parse segment headers
   */
  private parseSegments(): void {
    for (let i = 0; i < this.header.numSegments; i++) {
      const flags = this.reader.readUint32();
      const align = this.reader.readUint32();
      const size = this.reader.readUint64();

      this.segments.push({ flags, align, size });
    }
  }

  /**
   * Parse page headers
   */
  private parsePages(): void {
    for (let i = 0; i < this.header.numPages; i++) {
      const segment = this.reader.readUint32();
      const align = this.reader.readUint32();
      const size = this.reader.readUint32();

      this.pages.push({ segment, align, size });
    }
  }

  /**
   * Build page buffers from data
   */
  private buildPageBuffers(): void {
    // The order after segments/pages is:
    // 1. Pointer headers (8 bytes each - PagePtr_t)
    // 2. Asset entries
    // 3. GUID ref headers (8 bytes each - PagePtr_t)
    // 4. Dependency indices (4 bytes each - int)
    // 5. External asset ref offsets (4 bytes each - int) if numExternalAssetRefs > 0
    // 6. External asset refs data
    // 7. Unknown data sections (v8+)
    // 8. Patch stream data (if patched)
    // 9. Page data

    console.log(`[RPakParser] Building page buffers at position ${this.reader.position}`);
    console.log(`[RPakParser] numPointers=${this.header.numPointers}, numAssets=${this.header.numAssets}, numGuidRefs=${this.header.numGuidRefs}, numDependencies=${this.header.numDependencies}`);
    
    // Skip over pointer headers section (8 bytes per pointer - PagePtr_t)
    const pointersSize = this.header.numPointers * 8;
    console.log(`[RPakParser] Skipping ${pointersSize} bytes for pointers`);
    this.reader.skip(pointersSize);

    // Now we're at the asset entries
    const assetStartPos = this.reader.position;
    console.log(`[RPakParser] Asset entries start at ${assetStartPos}`);

    // Skip asset entries
    const assetsSize = this.header.numAssets * this.header.pakAssetSize;
    console.log(`[RPakParser] Skipping ${assetsSize} bytes for assets (${this.header.numAssets} * ${this.header.pakAssetSize})`);
    this.reader.skip(assetsSize);

    // Read GUID refs section (8 bytes per ref - PagePtr_t: pageIndex u32, pageOffset u32)
    const guidRefsCount = this.header.numGuidRefs;
    console.log(`[RPakParser] Reading ${guidRefsCount} GUID refs`);
    this.guidRefs = [];
    for (let i = 0; i < guidRefsCount; i++) {
      const pageIndex = this.reader.readUint32();
      const pageOffset = this.reader.readUint32();
      this.guidRefs.push({ pageIndex, pageOffset });
    }

    // Skip over dependencies section (4 bytes per dependency - int)
    const dependenciesSize = this.header.numDependencies * 4;
    console.log(`[RPakParser] Skipping ${dependenciesSize} bytes for dependencies`);
    this.reader.skip(dependenciesSize);

    // Skip external asset refs (if present)
    if (this.header.numExternalAssetRefs > 0) {
      // First the offsets (4 bytes each)
      const extRefOffsetsSize = this.header.numExternalAssetRefs * 4;
      console.log(`[RPakParser] Skipping ${extRefOffsetsSize} bytes for external ref offsets`);
      this.reader.skip(extRefOffsetsSize);
      
      // Then the actual refs data
      console.log(`[RPakParser] Skipping ${this.header.externalAssetRefsSize} bytes for external refs data`);
      this.reader.skip(this.header.externalAssetRefsSize);
    }

    // Skip additional data sections (v8+)
    if (this.header.unkDataSize_74 > 0) {
      console.log(`[RPakParser] Skipping ${this.header.unkDataSize_74} bytes for unkDataSize_74`);
      this.reader.skip(this.header.unkDataSize_74);
    }
    if (this.header.unkDataSize_78 > 0) {
      console.log(`[RPakParser] Skipping ${this.header.unkDataSize_78} bytes for unkDataSize_78`);
      this.reader.skip(this.header.unkDataSize_78);
    }

    // Skip patch data stream (if patched)
    if (this.header.patchCount > 0 && this.patchDataStreamSize > 0) {
      console.log(`[RPakParser] Skipping ${this.patchDataStreamSize} bytes for patch data stream`);
      this.reader.skip(this.patchDataStreamSize);
    }

    console.log(`[RPakParser] Page data starts at position ${this.reader.position}`);

    // For patched paks, the first N pages are from previous patches, we skip them
    const pageStart = this.patchPageCount;
    console.log(`[RPakParser] Starting from page ${pageStart} (patchPageCount=${this.patchPageCount})`);

    // Pre-fill with empty buffers for pages from patches
    for (let i = 0; i < pageStart; i++) {
      this.pageBuffers.push(new Uint8Array(0));
    }

    // Read page data for ALL pages in this pak sequentially
    // The C++ RSX reads all pages regardless of segment type
    for (let i = pageStart; i < this.header.numPages; i++) {
      const page = this.pages[i];
      
      if (page.size > 0) {
        if (this.reader.remaining < page.size) {
          console.error(`[RPakParser] Not enough data for page ${i}: need ${page.size}, have ${this.reader.remaining}`);
          this.pageBuffers.push(new Uint8Array(0));
          continue;
        }
        const pageData = this.reader.readBytes(page.size);
        this.pageBuffers.push(pageData);
      } else {
        // Empty page
        this.pageBuffers.push(new Uint8Array(0));
      }
    }

    console.log(`[RPakParser] Built ${this.pageBuffers.length} page buffers, final position ${this.reader.position}`);

    // Go back to asset entries
    this.reader.seek(assetStartPos);
  }

  /**
   * Parse asset entries
   */
  private parseAssets(): void {
    for (let i = 0; i < this.header.numAssets; i++) {
      const asset = this.parseAssetEntry();
      this.assets.push(asset);
    }

    // Resolve asset names from header data
    for (const asset of this.assets) {
      this.resolveAssetName(asset);
    }
  }

  /**
   * Parse a single asset entry
   */
  private parseAssetEntry(): ParsedAsset {
    const guid = this.reader.readUint64();
    this.reader.skip(8); // unk0

    const headPageIndex = this.reader.readUint32();
    const headPageOffset = this.reader.readUint32();
    const dataPageIndex = this.reader.readUint32();
    const dataPageOffset = this.reader.readUint32();

    const starpakOffset = this.reader.readUint64();
    
    let optStarpakOffset = 0n;
    if (this.header.version >= 8) {
      optStarpakOffset = this.reader.readUint64();
    }

    const pageEnd = this.reader.readUint16();
    this.reader.skip(2); // remainingDependencyCount
    const dependentsIndex = this.reader.readUint32();
    const dependenciesIndex = this.reader.readUint32();
    
    let dependentsCount: number;
    let dependenciesCount: number;
    let headerSize: number;
    let version: number;
    let type: number;

    if (this.header.version >= 8) {
      // V8: dependentsCount is int (4 bytes)
      dependentsCount = this.reader.readUint32();
      // V8: dependenciesCount is uint16 (2 bytes)
      dependenciesCount = this.reader.readUint16();
      this.reader.skip(2); // unk2
      // V8: headerStructSize is uint32 (4 bytes)
      headerSize = this.reader.readUint32();
      // V8: version is uint8 (1 byte)
      version = this.reader.readUint8();
      this.reader.skip(3); // padding for alignment
      // V8: type is uint32 (4 bytes)
      type = this.reader.readUint32();
    } else {
      // V6/V7: dependentsCount is int (4 bytes)
      dependentsCount = this.reader.readUint32();
      // V6/V7: dependenciesCount is uint32 (4 bytes)
      dependenciesCount = this.reader.readUint32();
      // V6/V7: headerStructSize is uint32 (4 bytes)
      headerSize = this.reader.readUint32();
      // V6/V7: version is int (4 bytes)
      version = this.reader.readUint32();
      // V6/V7: type is uint32 (4 bytes)
      type = this.reader.readUint32();
    }

    // Get header data
    let headerData: Uint8Array | undefined;
    if (headPageIndex < this.pageBuffers.length) {
      const pageBuf = this.pageBuffers[headPageIndex];
      if (pageBuf.length > 0 && headPageOffset + headerSize <= pageBuf.length) {
        headerData = pageBuf.slice(headPageOffset, headPageOffset + headerSize);
      }
    }

    return {
      guid: guid.toString(16).padStart(16, '0').toUpperCase(),
      type,
      typeFourCC: fourCCToString(type),
      typeName: getAssetTypeName(type),
      version,
      name: `0x${guid.toString(16).padStart(16, '0').toUpperCase()}`,
      headerSize,
      headPagePtr: { index: headPageIndex, offset: headPageOffset },
      dataPagePtr: { index: dataPageIndex, offset: dataPageOffset },
      starpakOffset,
      optStarpakOffset,
      pageEnd,
      dependentsIndex,
      dependenciesIndex,
      dependentsCount,
      dependenciesCount,
      headerData,
    };
  }

  /**
   * Resolve asset name from header data
   */
  private resolveAssetName(asset: ParsedAsset): void {
    if (!asset.headerData || asset.headerData.length < 8) {
      return;
    }

    const headerReader = new BinaryReader(asset.headerData);
    
    // For model assets (mdl_), the name pointer location depends on version:
    // v8: data (8 bytes), name (8 bytes) -> name at offset 8
    // v9+: data (8 bytes), info (8 bytes), name (8 bytes) -> name at offset 16
    if (asset.typeFourCC === 'mdl_') {
      if (asset.version >= 9) {
        // v9+ has info pointer between data and name
        if (asset.headerData.length < 24) {
          return;
        }
        headerReader.skip(16); // Skip data + info pointers
      } else {
        // v8 has name right after data
        if (asset.headerData.length < 16) {
          return;
        }
        headerReader.skip(8); // Skip data pointer
      }
    }
    // For material assets (matl), name pointer is at offset 24:
    // vftableReserved (8) + gap8 (8) + guid (8) + namePtr (8)
    else if (asset.typeFourCC === 'matl') {
      if (asset.headerData.length < 32) {
        return;
      }
      headerReader.skip(24); // Skip vftable + gap + guid
    }
    // For animation rig assets (arig), name pointer is at offset 8:
    // data (8 bytes) + name (8 bytes)
    else if (asset.typeFourCC === 'arig') {
      if (asset.headerData.length < 16) {
        return;
      }
      headerReader.skip(8); // Skip data pointer
    }
    // For animation sequence assets (aseq), name pointer is at offset 8:
    // data (8 bytes) + name (8 bytes)
    else if (asset.typeFourCC === 'aseq') {
      if (asset.headerData.length < 16) {
        return;
      }
      headerReader.skip(8); // Skip data pointer
    }
    
    // Read the name pointer
    const namePtrIndex = headerReader.readUint32();
    const namePtrOffset = headerReader.readUint32();

    // Check if it's a valid page pointer
    if (namePtrIndex === 0 && namePtrOffset === 0) {
      return; // Null pointer
    }

    if (namePtrIndex >= this.pageBuffers.length) {
      return; // Invalid page index
    }

    const pageBuf = this.pageBuffers[namePtrIndex];
    if (namePtrOffset >= pageBuf.length) {
      return; // Invalid offset
    }

    // Read null-terminated string
    let name = '';
    for (let i = namePtrOffset; i < pageBuf.length && pageBuf[i] !== 0; i++) {
      name += String.fromCharCode(pageBuf[i]);
    }

    if (name.length > 0 && this.isValidAssetName(name)) {
      asset.name = name;
    }
  }

  /**
   * Check if a string looks like a valid asset name
   */
  private isValidAssetName(name: string): boolean {
    // Must be printable ASCII
    for (let i = 0; i < name.length; i++) {
      const code = name.charCodeAt(i);
      if (code < 32 || code > 126) {
        return false;
      }
    }
    return name.length > 0 && name.length < 256;
  }

  /**
   * Get data for an asset from its page pointer
   */
  getAssetData(asset: ParsedAsset, maxSize?: number): Uint8Array | null {
    const { index, offset } = asset.dataPagePtr;
    
    if (index >= this.pageBuffers.length) {
      return null;
    }

    const pageBuf = this.pageBuffers[index];
    if (offset >= pageBuf.length) {
      return null;
    }

    const size = maxSize !== undefined 
      ? Math.min(maxSize, pageBuf.length - offset)
      : pageBuf.length - offset;

    return pageBuf.slice(offset, offset + size);
  }

  /**
   * Get raw page data
   */
  getPageData(pageIndex: number): Uint8Array | null {
    if (pageIndex >= this.pageBuffers.length) {
      return null;
    }
    return this.pageBuffers[pageIndex];
  }

  /**
   * Read data at a page pointer
   */
  readPagePtr(ptr: PagePtr, size: number): Uint8Array | null {
    if (ptr.index >= this.pageBuffers.length) {
      return null;
    }

    const pageBuf = this.pageBuffers[ptr.index];
    if (ptr.offset + size > pageBuf.length) {
      return null;
    }

    return pageBuf.slice(ptr.offset, ptr.offset + size);
  }

  /**
   * Get the dependency GUIDs for an asset
   * Returns array of { guid: string, type?: string } for each dependency
   */
  getAssetDependencies(asset: ParsedAsset): { guid: string }[] {
    const dependencies: { guid: string }[] = [];
    
    if (asset.dependenciesCount === 0) {
      return dependencies;
    }
    
    // Each dependency entry uses a GUID ref which is a page pointer to the actual GUID
    for (let i = 0; i < asset.dependenciesCount; i++) {
      const refIndex = asset.dependenciesIndex + i;
      
      if (refIndex >= this.guidRefs.length) {
        console.warn(`[RPakParser] Dependency ref index ${refIndex} out of bounds (max ${this.guidRefs.length})`);
        continue;
      }
      
      const guidRef = this.guidRefs[refIndex];
      
      // Read the GUID from the page (8 bytes)
      if (guidRef.pageIndex >= this.pageBuffers.length) {
        continue;
      }
      
      const pageBuf = this.pageBuffers[guidRef.pageIndex];
      if (guidRef.pageOffset + 8 > pageBuf.length) {
        continue;
      }
      
      // Read the 8-byte GUID as uint64
      const guidBytes = pageBuf.slice(guidRef.pageOffset, guidRef.pageOffset + 8);
      const reader = new BinaryReader(guidBytes);
      const guidValue = reader.readUint64();
      const guidHex = guidValue.toString(16).padStart(16, '0').toUpperCase();
      
      dependencies.push({ guid: guidHex });
    }
    
    return dependencies;
  }

  /**
   * Find an asset by GUID
   */
  findAssetByGuid(guid: string): ParsedAsset | undefined {
    const normalizedGuid = guid.toUpperCase().replace(/^0X/, '');
    return this.assets.find(a => a.guid === normalizedGuid);
  }

  /**
   * Get all parsed assets
   */
  getAssets(): ParsedAsset[] {
    return this.assets;
  }
}

/**
 * Parse an RPak file from a buffer
 * Returns both the parsed result and the parser instance for data access
 */
export async function parseRPak(buffer: ArrayBuffer | Uint8Array, filePath: string): Promise<{ parsed: ParsedRPak; parser: RPakParser }> {
  const parser = new RPakParser(buffer, filePath);
  const parsed = await parser.parse();
  return { parsed, parser };
}

// Alias for external use
export { RPakParser as RpakParser };
