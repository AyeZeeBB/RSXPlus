/**
 * Texture asset parser
 * Ported from the C++ RSX implementation
 */

import { BinaryReader } from '../utils/binaryUtils';
import { ParsedAsset } from './rpakParser';

// Texture formats - matches eTextureFormat enum from C++ RSX
export enum TextureFormat {
  // Block Compressed formats
  BC1_UNORM = 0,
  BC1_UNORM_SRGB = 1,
  BC2_UNORM = 2,
  BC2_UNORM_SRGB = 3,
  BC3_UNORM = 4,
  BC3_UNORM_SRGB = 5,
  BC4_UNORM = 6,
  BC4_SNORM = 7,
  BC5_UNORM = 8,
  BC5_SNORM = 9,
  BC6H_UF16 = 10,
  BC6H_SF16 = 11,
  BC7_UNORM = 12,
  BC7_UNORM_SRGB = 13,
  
  // Float formats
  R32G32B32A32_FLOAT = 14,
  R32G32B32A32_UINT = 15,
  R32G32B32A32_SINT = 16,
  R32G32B32_FLOAT = 17,
  R32G32B32_UINT = 18,
  R32G32B32_SINT = 19,
  R16G16B16A16_FLOAT = 20,
  R16G16B16A16_UNORM = 21,
  R16G16B16A16_UINT = 22,
  R16G16B16A16_SNORM = 23,
  R16G16B16A16_SINT = 24,
  R32G32_FLOAT = 25,
  R32G32_UINT = 26,
  R32G32_SINT = 27,
  R10G10B10A2_UNORM = 28,
  R10G10B10A2_UINT = 29,
  R11G11B10_FLOAT = 30,
  
  // 8-bit formats
  R8G8B8A8_UNORM = 31,
  R8G8B8A8_UNORM_SRGB = 32,
  R8G8B8A8_UINT = 33,
  R8G8B8A8_SNORM = 34,
  R8G8B8A8_SINT = 35,
  R16G16_FLOAT = 36,
  R16G16_UNORM = 37,
  R16G16_UINT = 38,
  R16G16_SNORM = 39,
  R16G16_SINT = 40,
  R32_FLOAT = 41,
  R32_UINT = 42,
  R32_SINT = 43,
  R8G8_UNORM = 44,
  R8G8_UINT = 45,
  R8G8_SNORM = 46,
  R8G8_SINT = 47,
  R16_FLOAT = 48,
  R16_UNORM = 49,
  R16_UINT = 50,
  R16_SNORM = 51,
  R16_SINT = 52,
  R8_UNORM = 53,
  R8_UINT = 54,
  R8_SNORM = 55,
  R8_SINT = 56,
  A8_UNORM = 57,
}

// Format names
export const TextureFormatNames: Record<number, string> = {
  [TextureFormat.BC1_UNORM]: 'BC1',
  [TextureFormat.BC1_UNORM_SRGB]: 'BC1 sRGB',
  [TextureFormat.BC2_UNORM]: 'BC2',
  [TextureFormat.BC2_UNORM_SRGB]: 'BC2 sRGB',
  [TextureFormat.BC3_UNORM]: 'BC3',
  [TextureFormat.BC3_UNORM_SRGB]: 'BC3 sRGB',
  [TextureFormat.BC4_UNORM]: 'BC4',
  [TextureFormat.BC4_SNORM]: 'BC4 SNorm',
  [TextureFormat.BC5_UNORM]: 'BC5',
  [TextureFormat.BC5_SNORM]: 'BC5 SNorm',
  [TextureFormat.BC6H_UF16]: 'BC6H',
  [TextureFormat.BC6H_SF16]: 'BC6H Signed',
  [TextureFormat.BC7_UNORM]: 'BC7',
  [TextureFormat.BC7_UNORM_SRGB]: 'BC7 sRGB',
  [TextureFormat.R32G32B32A32_FLOAT]: 'RGBA32F',
  [TextureFormat.R16G16B16A16_FLOAT]: 'RGBA16F',
  [TextureFormat.R16G16B16A16_UNORM]: 'RGBA16',
  [TextureFormat.R8G8B8A8_UNORM]: 'RGBA8',
  [TextureFormat.R8G8B8A8_UNORM_SRGB]: 'RGBA8 sRGB',
  [TextureFormat.R8G8_UNORM]: 'RG8',
  [TextureFormat.R8_UNORM]: 'R8',
  [TextureFormat.A8_UNORM]: 'A8',
  [TextureFormat.R16_UNORM]: 'R16',
  [TextureFormat.R16G16_UNORM]: 'RG16',
  [TextureFormat.R10G10B10A2_UNORM]: 'RGB10A2',
  [TextureFormat.R11G11B10_FLOAT]: 'R11G11B10F',
};

// Bytes per pixel/block for each format
export const BytesPerPixel: Record<number, number> = {
  // Block compressed - bytes per 4x4 block
  [TextureFormat.BC1_UNORM]: 8,
  [TextureFormat.BC1_UNORM_SRGB]: 8,
  [TextureFormat.BC2_UNORM]: 16,
  [TextureFormat.BC2_UNORM_SRGB]: 16,
  [TextureFormat.BC3_UNORM]: 16,
  [TextureFormat.BC3_UNORM_SRGB]: 16,
  [TextureFormat.BC4_UNORM]: 8,
  [TextureFormat.BC4_SNORM]: 8,
  [TextureFormat.BC5_UNORM]: 16,
  [TextureFormat.BC5_SNORM]: 16,
  [TextureFormat.BC6H_UF16]: 16,
  [TextureFormat.BC6H_SF16]: 16,
  [TextureFormat.BC7_UNORM]: 16,
  [TextureFormat.BC7_UNORM_SRGB]: 16,
  
  // Uncompressed - bytes per pixel
  [TextureFormat.R32G32B32A32_FLOAT]: 16,
  [TextureFormat.R16G16B16A16_FLOAT]: 8,
  [TextureFormat.R16G16B16A16_UNORM]: 8,
  [TextureFormat.R8G8B8A8_UNORM]: 4,
  [TextureFormat.R8G8B8A8_UNORM_SRGB]: 4,
  [TextureFormat.R8G8_UNORM]: 2,
  [TextureFormat.R8_UNORM]: 1,
  [TextureFormat.A8_UNORM]: 1,
  [TextureFormat.R16_UNORM]: 2,
  [TextureFormat.R16G16_UNORM]: 4,
  [TextureFormat.R10G10B10A2_UNORM]: 4,
  [TextureFormat.R11G11B10_FLOAT]: 4,
};

// Is format block-compressed?
export function isBlockCompressed(format: number): boolean {
  // BC1-BC7 formats (0-13)
  return format >= TextureFormat.BC1_UNORM && format <= TextureFormat.BC7_UNORM_SRGB;
}

// Mip storage type
export enum MipType {
  RPak = 0,       // Permanent mips stored in rpak
  StarPak = 1,    // Streamed mips stored in starpak
  OptStarPak = 2, // Optional streamed mips stored in opt.starpak
}

// Compression type for streamed mips (matches C++ eCompressionType)
export enum CompressionType {
  NONE = 0,
  PAKFILE = 1,    // RTech custom LZ
  SNOWFLAKE = 2,  // Another custom compression
  OODLE = 3,      // Oodle SDK
}

// Texture asset header (v8/v9/v10 - same layout)
export interface TextureAssetHeader {
  namePtr: { index: number; offset: number };
  width: number;
  height: number;
  depth: number;
  format: number;
  dataOffset: number;
  arraySize: number;
  layerCount: number;
  mipCount: number;
  permanentMipCount: number;  // Mips in rpak
  streamedMipCount: number;   // Mips in starpak
  optStreamedMipCount: number; // Mips in opt.starpak
  unk: number;
  totalSize: bigint;
  
  // V9/V10 streaming data
  compTypePacked: number;     // Packed compression types (2 bits per mip)
  compressedBytes: number[];  // Compressed size info for each streamed mip
}

// Parsed texture info
export interface ParsedTexture {
  name: string;
  width: number;
  height: number;
  depth: number;
  format: number;
  formatName: string;
  mipCount: number;
  streamedMipCount: number;
  arraySize: number;
  isStreamed: boolean;
  totalSize: number;
  
  // Pixel data (if available - non-streamed only)
  pixelData?: Uint8Array;
}

/**
 * Parse a texture asset header (supports v8, v9, v10)
 * Based on TextureAssetHeader_v8_t, v9_t, v10_t from C++ RSX
 */
export function parseTextureHeader(asset: ParsedAsset): TextureAssetHeader | null {
  if (!asset.headerData || asset.headerData.length < 56) {
    return null;
  }

  const reader = new BinaryReader(asset.headerData);
  const assetVersion = asset.version || 8;
  
  let width: number, height: number, depth: number, format: number;
  let dataSize: number, arraySize: number, layerCount: number;
  let permanentMipLevels: number, streamedMipCount: number, optStreamedMipCount: number;
  let nameIndex: number, nameOffset: number;
  let unk: number = 0;
  let compTypePacked: number = 0;
  let compressedBytes: number[] = [0, 0, 0, 0, 0, 0, 0];

  if (assetVersion === 8) {
    // V8 Header layout (56 bytes):
    // uint64_t guid (8)
    // char* name (8)
    // uint16_t width, height, depth (6)
    // eTextureFormat imgFormat (2)
    // uint32_t dataSize (4)
    // uint8_t unk_1C, optStreamedMipLevels, arraySize, layerCount (4)
    // uint8_t usageFlags, permanentMipLevels, streamedMipLevels (3)
    // ...
    
    reader.skip(8); // Skip guid
    nameIndex = reader.readUint32();
    nameOffset = reader.readUint32();
    
    width = reader.readUint16();
    height = reader.readUint16();
    depth = reader.readUint16();
    format = reader.readUint16();
    dataSize = reader.readUint32();
    
    unk = reader.readUint8();
    optStreamedMipCount = reader.readUint8();
    arraySize = reader.readUint8();
    layerCount = reader.readUint8();
    
    reader.readUint8(); // usageFlags
    permanentMipLevels = reader.readUint8();
    streamedMipCount = reader.readUint8();
    
  } else {
    // V9/V10 Header layout (56 bytes):
    // char* name (8)
    // eTextureFormat imgFormat (2)
    // uint16_t width, height, depth (6)
    // uint8_t arraySize, layerCount, unk_12, usageFlags (4)
    // uint32_t dataSize (4)
    // uint8_t permanentMipLevels, streamedMipLevels, optStreamedMipLevels (3)
    // uint8_t type (1) - v9
    // or: uint8_t unk_1B, unkMipLevels, type (3) - v10
    // uint16_t compTypePacked (2)
    // uint16_t compressedBytes[7] (14)
    // ...
    
    nameIndex = reader.readUint32();
    nameOffset = reader.readUint32();
    
    format = reader.readUint16();
    width = reader.readUint16();
    height = reader.readUint16();
    depth = reader.readUint16();
    
    arraySize = reader.readUint8();
    layerCount = reader.readUint8();
    reader.skip(2); // unk_12, usageFlags
    
    dataSize = reader.readUint32();
    permanentMipLevels = reader.readUint8();
    streamedMipCount = reader.readUint8();
    optStreamedMipCount = reader.readUint8();
    
    // V9: 1 byte type, then compTypePacked
    // V10: 3 more bytes (unk_1B, unkMipLevels, type), then compTypePacked
    if (assetVersion === 9) {
      reader.skip(1); // type
    } else {
      reader.skip(3); // unk_1B, unkMipLevels, type
    }
    
    // compTypePacked: packed eCompressionType (2 bits per enum)
    compTypePacked = reader.readUint16();
    
    // compressedBytes[7]: compressed size info for each streamed mip
    for (let i = 0; i < 7; i++) {
      compressedBytes[i] = reader.readUint16();
    }
  }
  
  // Total mips = optStreamedMipLevels + streamedMipLevels + permanentMipLevels
  const mipCount = optStreamedMipCount + streamedMipCount + permanentMipLevels;

  return {
    namePtr: { index: nameIndex, offset: nameOffset },
    width,
    height,
    depth,
    format,
    dataOffset: dataSize, // reusing this field for dataSize
    arraySize: arraySize || 1, // Default to 1 if 0
    layerCount,
    mipCount,
    permanentMipCount: permanentMipLevels,
    streamedMipCount,
    optStreamedMipCount,
    unk,
    totalSize: BigInt(dataSize),
    compTypePacked,
    compressedBytes,
  };
}

/**
 * Align a value to a boundary (round up to nearest multiple)
 */
function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

/**
 * Determine the mip type (where it's stored) based on mip index
 * Mips are indexed from 0 (highest res) to totalMips-1 (lowest res)
 * Storage order: optStreamedMips, streamedMips, permanentMips
 */
export function getMipType(
  mipIndex: number,
  optStreamedMipCount: number,
  streamedMipCount: number
): MipType {
  if (mipIndex < optStreamedMipCount) {
    return MipType.OptStarPak;
  } else if (mipIndex < optStreamedMipCount + streamedMipCount) {
    return MipType.StarPak;
  }
  return MipType.RPak;
}

/**
 * Get the compression type for a streamed mip
 * @param header - The texture header
 * @param streamMipIndex - Index within streamed mips (0 = first streamed, etc.)
 */
export function getStreamMipCompression(header: TextureAssetHeader, streamMipIndex: number): CompressionType {
  // compTypePacked: 2 bits per enum, index 0 is the first streamed mip
  const compType = (header.compTypePacked >> (2 * streamMipIndex)) & 3;
  return compType as CompressionType;
}

/**
 * Get the compressed size for a streamed mip from the compressedBytes array
 * Returns the actual size in bytes if compressed, or 0 if not compressed
 * @param header - The texture header
 * @param streamMipIndex - Index within streamed mips (0 = first opt, etc.)
 */
export function getCompressedMipSize(header: TextureAssetHeader, streamMipIndex: number): number {
  if (streamMipIndex < 0 || streamMipIndex >= 7) return 0;
  
  const compType = getStreamMipCompression(header, streamMipIndex);
  if (compType === CompressionType.NONE) return 0;
  
  // compressedBytes stores the size as: ((value + 1) << 12) - aligned to 4096 byte pages
  const compressedValue = header.compressedBytes[streamMipIndex];
  if (compressedValue === 0) return 0;
  
  return ((compressedValue + 1) << 12); // (value + 1) * 4096
}

/**
 * Calculate texture mip level size (aligned for storage)
 * PC textures align slice pitch to 16 bytes
 */
export function calculateMipSize(width: number, height: number, format: number, mipLevel: number): number {
  const w = Math.max(1, width >> mipLevel);
  const h = Math.max(1, height >> mipLevel);
  
  if (isBlockCompressed(format)) {
    // Block-compressed formats use 4x4 blocks
    const blocksX = Math.max(1, Math.ceil(w / 4));
    const blocksY = Math.max(1, Math.ceil(h / 4));
    const slicePitch = blocksX * blocksY * (BytesPerPixel[format] || 16);
    // Align to 16 bytes (PC alignment)
    return alignTo(slicePitch, 16);
  } else {
    // Uncompressed format
    const slicePitch = w * h * (BytesPerPixel[format] || 4);
    return alignTo(slicePitch, 16);
  }
}

/**
 * Calculate total texture size for all mip levels
 */
export function calculateTotalSize(width: number, height: number, format: number, mipCount: number): number {
  let total = 0;
  for (let i = 0; i < mipCount; i++) {
    total += calculateMipSize(width, height, format, i);
  }
  return total;
}

/**
 * Create a DDS file header for a texture
 */
export function createDDSHeader(
  width: number,
  height: number,
  format: number,
  mipCount: number,
  depth: number = 1
): Uint8Array {
  const DDS_MAGIC = 0x20534444; // 'DDS '
  const DDS_HEADER_SIZE = 124;
  const DDS_PIXELFORMAT_SIZE = 32;
  
  // DDS Header flags
  const DDSD_CAPS = 0x1;
  const DDSD_HEIGHT = 0x2;
  const DDSD_WIDTH = 0x4;
  const DDSD_PITCH = 0x8;
  const DDSD_PIXELFORMAT = 0x1000;
  const DDSD_MIPMAPCOUNT = 0x20000;
  const DDSD_LINEARSIZE = 0x80000;
  const DDSD_DEPTH = 0x800000;

  // DDS Pixel format flags
  const DDPF_FOURCC = 0x4;
  const DDPF_RGB = 0x40;
  const DDPF_ALPHA = 0x1;

  // DDS Caps
  const DDSCAPS_COMPLEX = 0x8;
  const DDSCAPS_TEXTURE = 0x1000;
  const DDSCAPS_MIPMAP = 0x400000;

  // Determine format info
  const isBC = isBlockCompressed(format);
  let fourCC = 0;
  let rgbBitCount = 0;
  let rMask = 0, gMask = 0, bMask = 0, aMask = 0;
  let dx10Format = 0;
  let needsDX10Header = false;

  switch (format) {
    case TextureFormat.BC1_UNORM:
    case TextureFormat.BC1_UNORM_SRGB:
      fourCC = 0x31545844; // 'DXT1'
      break;
    case TextureFormat.BC3_UNORM:
    case TextureFormat.BC3_UNORM_SRGB:
      fourCC = 0x35545844; // 'DXT5'
      break;
    case TextureFormat.BC4_UNORM:
      fourCC = 0x31495441; // 'ATI1'
      break;
    case TextureFormat.BC5_UNORM:
      fourCC = 0x32495441; // 'ATI2'
      break;
    case TextureFormat.BC6H_UF16:
    case TextureFormat.BC7_UNORM:
    case TextureFormat.BC7_UNORM_SRGB:
      // These need DX10 header
      fourCC = 0x30315844; // 'DX10'
      needsDX10Header = true;
      if (format === TextureFormat.BC6H_UF16) dx10Format = 95; // DXGI_FORMAT_BC6H_UF16
      else if (format === TextureFormat.BC7_UNORM) dx10Format = 98; // DXGI_FORMAT_BC7_UNORM
      else dx10Format = 99; // DXGI_FORMAT_BC7_UNORM_SRGB
      break;
    case TextureFormat.R8G8B8A8_UNORM:
    case TextureFormat.R8G8B8A8_UNORM_SRGB:
      rgbBitCount = 32;
      rMask = 0x000000FF;
      gMask = 0x0000FF00;
      bMask = 0x00FF0000;
      aMask = 0xFF000000;
      break;
    default:
      // Default to RGBA8
      rgbBitCount = 32;
      rMask = 0x000000FF;
      gMask = 0x0000FF00;
      bMask = 0x00FF0000;
      aMask = 0xFF000000;
  }

  // Calculate buffer size
  const totalSize = needsDX10Header ? 4 + DDS_HEADER_SIZE + 20 : 4 + DDS_HEADER_SIZE;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  let offset = 0;

  // Write magic
  view.setUint32(offset, DDS_MAGIC, true); offset += 4;

  // Write header size
  view.setUint32(offset, DDS_HEADER_SIZE, true); offset += 4;

  // Write flags
  let flags = DDSD_CAPS | DDSD_HEIGHT | DDSD_WIDTH | DDSD_PIXELFORMAT;
  if (mipCount > 1) flags |= DDSD_MIPMAPCOUNT;
  if (isBC) flags |= DDSD_LINEARSIZE;
  else flags |= DDSD_PITCH;
  if (depth > 1) flags |= DDSD_DEPTH;
  view.setUint32(offset, flags, true); offset += 4;

  // Write height
  view.setUint32(offset, height, true); offset += 4;

  // Write width
  view.setUint32(offset, width, true); offset += 4;

  // Write pitch/linear size
  const pitchOrSize = isBC ? calculateMipSize(width, height, format, 0) : width * (rgbBitCount / 8);
  view.setUint32(offset, pitchOrSize, true); offset += 4;

  // Write depth
  view.setUint32(offset, depth, true); offset += 4;

  // Write mip count
  view.setUint32(offset, mipCount, true); offset += 4;

  // Write reserved (11 DWORDs)
  for (let i = 0; i < 11; i++) {
    view.setUint32(offset, 0, true); offset += 4;
  }

  // Write pixel format
  view.setUint32(offset, DDS_PIXELFORMAT_SIZE, true); offset += 4;

  // Pixel format flags
  let pfFlags = 0;
  if (fourCC !== 0) pfFlags |= DDPF_FOURCC;
  else {
    pfFlags |= DDPF_RGB;
    if (aMask !== 0) pfFlags |= DDPF_ALPHA;
  }
  view.setUint32(offset, pfFlags, true); offset += 4;

  // FourCC
  view.setUint32(offset, fourCC, true); offset += 4;

  // RGB bit count
  view.setUint32(offset, rgbBitCount, true); offset += 4;

  // Color masks
  view.setUint32(offset, rMask, true); offset += 4;
  view.setUint32(offset, gMask, true); offset += 4;
  view.setUint32(offset, bMask, true); offset += 4;
  view.setUint32(offset, aMask, true); offset += 4;

  // Caps
  let caps = DDSCAPS_TEXTURE;
  if (mipCount > 1) caps |= DDSCAPS_COMPLEX | DDSCAPS_MIPMAP;
  view.setUint32(offset, caps, true); offset += 4;

  // Caps2, Caps3, Caps4, Reserved2
  view.setUint32(offset, 0, true); offset += 4;
  view.setUint32(offset, 0, true); offset += 4;
  view.setUint32(offset, 0, true); offset += 4;
  view.setUint32(offset, 0, true); offset += 4;

  // DX10 header if needed
  if (needsDX10Header) {
    view.setUint32(offset, dx10Format, true); offset += 4;
    view.setUint32(offset, 3, true); offset += 4; // D3D10_RESOURCE_DIMENSION_TEXTURE2D
    view.setUint32(offset, 0, true); offset += 4; // miscFlag
    view.setUint32(offset, 1, true); offset += 4; // arraySize
    view.setUint32(offset, 0, true); offset += 4; // miscFlags2
  }

  return new Uint8Array(buffer);
}

/**
 * Export texture as DDS file
 */
export function exportTextureToDDS(
  texture: ParsedTexture,
  pixelData: Uint8Array
): Uint8Array {
  const header = createDDSHeader(
    texture.width,
    texture.height,
    texture.format,
    texture.mipCount,
    texture.depth
  );

  // Combine header and pixel data
  const result = new Uint8Array(header.length + pixelData.length);
  result.set(header, 0);
  result.set(pixelData, header.length);

  return result;
}

/**
 * Decode BC1 (DXT1) compressed block to RGBA
 */
function decodeBC1Block(block: Uint8Array): Uint8Array {
  const output = new Uint8Array(64); // 4x4 pixels * 4 bytes
  
  // Read color endpoints (RGB565)
  const c0 = block[0] | (block[1] << 8);
  const c1 = block[2] | (block[3] << 8);
  
  // Extract RGB565 to RGB888
  const r0 = ((c0 >> 11) & 0x1F) * 255 / 31;
  const g0 = ((c0 >> 5) & 0x3F) * 255 / 63;
  const b0 = (c0 & 0x1F) * 255 / 31;
  
  const r1 = ((c1 >> 11) & 0x1F) * 255 / 31;
  const g1 = ((c1 >> 5) & 0x3F) * 255 / 63;
  const b1 = (c1 & 0x1F) * 255 / 31;
  
  // Build color table
  const colors: number[][] = [
    [r0, g0, b0, 255],
    [r1, g1, b1, 255],
    c0 > c1 
      ? [(2 * r0 + r1) / 3, (2 * g0 + g1) / 3, (2 * b0 + b1) / 3, 255]
      : [(r0 + r1) / 2, (g0 + g1) / 2, (b0 + b1) / 2, 255],
    c0 > c1
      ? [(r0 + 2 * r1) / 3, (g0 + 2 * g1) / 3, (b0 + 2 * b1) / 3, 255]
      : [0, 0, 0, 0], // Transparent for c0 <= c1
  ];
  
  // Read indices and fill pixels
  const indices = block[4] | (block[5] << 8) | (block[6] << 16) | (block[7] << 24);
  
  for (let i = 0; i < 16; i++) {
    const idx = (indices >> (i * 2)) & 0x3;
    const color = colors[idx];
    const offset = i * 4;
    output[offset] = color[0];
    output[offset + 1] = color[1];
    output[offset + 2] = color[2];
    output[offset + 3] = color[3];
  }
  
  return output;
}

/**
 * Decode BC3 (DXT5) compressed block to RGBA
 */
function decodeBC3Block(block: Uint8Array): Uint8Array {
  const output = new Uint8Array(64);
  
  // Decode alpha
  const a0 = block[0];
  const a1 = block[1];
  
  const alphas: number[] = [a0, a1];
  if (a0 > a1) {
    for (let i = 1; i <= 6; i++) {
      alphas.push(((7 - i) * a0 + i * a1) / 7);
    }
  } else {
    for (let i = 1; i <= 4; i++) {
      alphas.push(((5 - i) * a0 + i * a1) / 5);
    }
    alphas.push(0, 255);
  }
  
  // Read alpha indices (48 bits)
  let alphaBits = BigInt(0);
  for (let i = 0; i < 6; i++) {
    alphaBits |= BigInt(block[2 + i]) << BigInt(i * 8);
  }
  
  // Decode color (same as BC1)
  const c0 = block[8] | (block[9] << 8);
  const c1 = block[10] | (block[11] << 8);
  
  const r0 = ((c0 >> 11) & 0x1F) * 255 / 31;
  const g0 = ((c0 >> 5) & 0x3F) * 255 / 63;
  const b0 = (c0 & 0x1F) * 255 / 31;
  
  const r1 = ((c1 >> 11) & 0x1F) * 255 / 31;
  const g1 = ((c1 >> 5) & 0x3F) * 255 / 63;
  const b1 = (c1 & 0x1F) * 255 / 31;
  
  const colors: number[][] = [
    [r0, g0, b0],
    [r1, g1, b1],
    [(2 * r0 + r1) / 3, (2 * g0 + g1) / 3, (2 * b0 + b1) / 3],
    [(r0 + 2 * r1) / 3, (g0 + 2 * g1) / 3, (b0 + 2 * b1) / 3],
  ];
  
  const colorIndices = block[12] | (block[13] << 8) | (block[14] << 16) | (block[15] << 24);
  
  for (let i = 0; i < 16; i++) {
    const colorIdx = (colorIndices >> (i * 2)) & 0x3;
    const alphaIdx = Number((alphaBits >> BigInt(i * 3)) & BigInt(0x7));
    const color = colors[colorIdx];
    const offset = i * 4;
    output[offset] = color[0];
    output[offset + 1] = color[1];
    output[offset + 2] = color[2];
    output[offset + 3] = alphas[alphaIdx];
  }
  
  return output;
}

/**
 * Decode BC4 (single channel) compressed block
 */
function decodeBC4Block(block: Uint8Array): Uint8Array {
  const output = new Uint8Array(64);
  
  const a0 = block[0];
  const a1 = block[1];
  
  const values: number[] = [a0, a1];
  if (a0 > a1) {
    for (let i = 1; i <= 6; i++) {
      values.push(((7 - i) * a0 + i * a1) / 7);
    }
  } else {
    for (let i = 1; i <= 4; i++) {
      values.push(((5 - i) * a0 + i * a1) / 5);
    }
    values.push(0, 255);
  }
  
  let bits = BigInt(0);
  for (let i = 0; i < 6; i++) {
    bits |= BigInt(block[2 + i]) << BigInt(i * 8);
  }
  
  for (let i = 0; i < 16; i++) {
    const idx = Number((bits >> BigInt(i * 3)) & BigInt(0x7));
    const value = values[idx];
    const offset = i * 4;
    output[offset] = value;
    output[offset + 1] = value;
    output[offset + 2] = value;
    output[offset + 3] = 255;
  }
  
  return output;
}

/**
 * Decode BC5 (two channel) compressed block - used for normal maps
 */
function decodeBC5Block(block: Uint8Array): Uint8Array {
  const output = new Uint8Array(64);
  
  const decodeChannel = (channelBlock: Uint8Array): number[] => {
    const a0 = channelBlock[0];
    const a1 = channelBlock[1];
    
    const values: number[] = [a0, a1];
    if (a0 > a1) {
      for (let i = 1; i <= 6; i++) {
        values.push(((7 - i) * a0 + i * a1) / 7);
      }
    } else {
      for (let i = 1; i <= 4; i++) {
        values.push(((5 - i) * a0 + i * a1) / 5);
      }
      values.push(0, 255);
    }
    
    let bits = BigInt(0);
    for (let i = 0; i < 6; i++) {
      bits |= BigInt(channelBlock[2 + i]) << BigInt(i * 8);
    }
    
    const result: number[] = [];
    for (let i = 0; i < 16; i++) {
      const idx = Number((bits >> BigInt(i * 3)) & BigInt(0x7));
      result.push(values[idx]);
    }
    return result;
  };
  
  const rChannel = decodeChannel(block.slice(0, 8));
  const gChannel = decodeChannel(block.slice(8, 16));
  
  for (let i = 0; i < 16; i++) {
    const offset = i * 4;
    output[offset] = rChannel[i];
    output[offset + 1] = gChannel[i];
    output[offset + 2] = 128; // Blue channel for normals
    output[offset + 3] = 255;
  }
  
  return output;
}

// BC7 mode definitions
const BC7_MODES = [
  { partitions: 3, subsets: 3, pbits: 4, rotationBits: 0, indexSelectionBits: 0, colorBits: 4, alphaBits: 0, endpointBits: 0, indexBits: 3, index2Bits: 0 },
  { partitions: 2, subsets: 2, pbits: 2, rotationBits: 0, indexSelectionBits: 0, colorBits: 6, alphaBits: 0, endpointBits: 0, indexBits: 3, index2Bits: 0 },
  { partitions: 6, subsets: 3, pbits: 0, rotationBits: 0, indexSelectionBits: 0, colorBits: 5, alphaBits: 0, endpointBits: 0, indexBits: 2, index2Bits: 0 },
  { partitions: 6, subsets: 2, pbits: 0, rotationBits: 0, indexSelectionBits: 0, colorBits: 7, alphaBits: 0, endpointBits: 0, indexBits: 2, index2Bits: 0 },
  { partitions: 0, subsets: 1, pbits: 0, rotationBits: 2, indexSelectionBits: 1, colorBits: 5, alphaBits: 6, endpointBits: 0, indexBits: 2, index2Bits: 3 },
  { partitions: 0, subsets: 1, pbits: 0, rotationBits: 2, indexSelectionBits: 0, colorBits: 7, alphaBits: 8, endpointBits: 0, indexBits: 2, index2Bits: 2 },
  { partitions: 0, subsets: 1, pbits: 1, rotationBits: 0, indexSelectionBits: 0, colorBits: 7, alphaBits: 7, endpointBits: 0, indexBits: 4, index2Bits: 0 },
  { partitions: 6, subsets: 2, pbits: 2, rotationBits: 0, indexSelectionBits: 0, colorBits: 5, alphaBits: 5, endpointBits: 0, indexBits: 2, index2Bits: 0 },
];

// BC7 partition tables for 2 subsets (simplified)
const BC7_PARTITION_TABLE_2: number[][] = [
  [0,0,1,1,0,0,1,1,0,0,1,1,0,0,1,1],
  [0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1],
  [0,1,1,1,0,1,1,1,0,1,1,1,0,1,1,1],
  [0,0,0,1,0,0,1,1,0,0,1,1,0,1,1,1],
  [0,0,0,0,0,0,0,1,0,0,0,1,0,0,1,1],
  [0,0,1,1,0,1,1,1,0,1,1,1,1,1,1,1],
  [0,0,0,1,0,0,1,1,0,1,1,1,1,1,1,1],
  [0,0,0,0,0,0,0,1,0,0,1,1,0,1,1,1],
  [0,0,0,0,0,0,0,0,0,0,0,1,0,0,1,1],
  [0,0,1,1,0,1,1,1,1,1,1,1,1,1,1,1],
  [0,0,0,0,0,0,0,1,0,1,1,1,1,1,1,1],
  [0,0,0,0,0,0,0,0,0,0,0,1,0,1,1,1],
  [0,0,0,1,0,1,1,1,1,1,1,1,1,1,1,1],
  [0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1],
  [0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1],
  [0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1],
  [0,0,0,0,1,0,0,0,1,1,1,0,1,1,1,1],
  [0,1,1,1,0,0,0,1,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,1,0,0,0,1,1,1,0],
  [0,1,1,1,0,0,1,1,0,0,0,1,0,0,0,0],
  [0,0,1,1,0,0,0,1,0,0,0,0,0,0,0,0],
  [0,0,0,0,1,0,0,0,1,1,0,0,1,1,1,0],
  [0,0,0,0,0,0,0,0,1,0,0,0,1,1,0,0],
  [0,1,1,1,0,0,1,1,0,0,1,1,0,0,0,1],
  [0,0,1,1,0,0,0,1,0,0,0,1,0,0,0,0],
  [0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0],
  [0,1,0,0,0,1,1,0,0,1,1,1,0,1,1,1],
  [0,0,1,0,0,1,1,1,0,1,1,1,0,1,1,1],
  [0,0,0,0,0,0,0,1,0,0,1,1,0,1,1,1],
  [0,0,0,1,0,1,1,1,1,1,1,1,1,1,1,1],
  [0,1,0,0,0,0,0,0,1,1,1,0,1,1,1,1],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
];

/**
 * Read bits from a byte array (LSB first)
 */
class BitReader {
  private data: Uint8Array;
  private bitPos: number = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  readBits(numBits: number): number {
    let result = 0;
    for (let i = 0; i < numBits; i++) {
      const byteIdx = Math.floor(this.bitPos / 8);
      const bitIdx = this.bitPos % 8;
      if (byteIdx < this.data.length) {
        const bit = (this.data[byteIdx] >> bitIdx) & 1;
        result |= (bit << i);
      }
      this.bitPos++;
    }
    return result;
  }

  get position(): number {
    return this.bitPos;
  }
}

/**
 * Interpolate two values
 */
function interpolate(e0: number, e1: number, index: number, indexBits: number): number {
  const weights3 = [0, 9, 18, 27, 37, 46, 55, 64];
  const weights4 = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64];
  const weights2 = [0, 21, 43, 64];
  
  let weight: number;
  if (indexBits === 2) weight = weights2[index];
  else if (indexBits === 3) weight = weights3[index];
  else weight = weights4[index];
  
  return Math.round((e0 * (64 - weight) + e1 * weight + 32) / 64);
}

/**
 * Decode BC7 compressed block - full decoder for common modes (0, 1, 3, 6, 7)
 * BC7 has 8 modes with varying partition/endpoint/index configurations
 */
function decodeBC7Block(block: Uint8Array): Uint8Array {
  const output = new Uint8Array(64);
  const reader = new BitReader(block);
  
  // Get mode from leading bits (mode is encoded as 1-8 bits based on first 1 bit)
  let mode = 0;
  while (mode < 8 && reader.readBits(1) === 0) {
    mode++;
  }
  
  if (mode >= 8) {
    // Invalid block - fill with magenta
    for (let i = 0; i < 16; i++) {
      output[i * 4] = 255;
      output[i * 4 + 1] = 0;
      output[i * 4 + 2] = 255;
      output[i * 4 + 3] = 255;
    }
    return output;
  }
  
  const modeInfo = BC7_MODES[mode];
  
  // Read partition index (for modes with partitions)
  let partitionIndex = 0;
  if (modeInfo.subsets > 1) {
    partitionIndex = reader.readBits(mode === 0 ? 4 : 6);
  }
  
  // Read rotation and index selection bits (for modes 4 and 5)
  let rotation = 0;
  let indexSelection = 0;
  if (modeInfo.rotationBits > 0) {
    rotation = reader.readBits(modeInfo.rotationBits);
  }
  if (modeInfo.indexSelectionBits > 0) {
    indexSelection = reader.readBits(modeInfo.indexSelectionBits);
  }
  
  // Read color endpoints
  const colorBits = modeInfo.colorBits;
  const numSubsets = modeInfo.subsets;
  const endpoints: number[][] = []; // [subset][component] where component = r0,g0,b0,r1,g1,b1
  
  for (let c = 0; c < 3; c++) { // RGB
    for (let s = 0; s < numSubsets; s++) {
      for (let e = 0; e < 2; e++) { // endpoint 0 and 1
        if (!endpoints[s]) endpoints[s] = [];
        const idx = c * 2 + e;
        if (!endpoints[s][idx]) endpoints[s][idx] = 0;
        endpoints[s][c * 2 + e] = reader.readBits(colorBits);
      }
    }
  }
  
  // Read alpha endpoints (for modes with alpha)
  const alphaBits = modeInfo.alphaBits;
  const alphaEndpoints: number[][] = [];
  if (alphaBits > 0) {
    for (let s = 0; s < numSubsets; s++) {
      alphaEndpoints[s] = [];
      for (let e = 0; e < 2; e++) {
        alphaEndpoints[s][e] = reader.readBits(alphaBits);
      }
    }
  }
  
  // Read P-bits (for modes 0, 1, 3, 6, 7)
  const pbits: number[] = [];
  if (modeInfo.pbits > 0) {
    const numPbits = mode === 1 ? 2 : (numSubsets * 2);
    for (let i = 0; i < numPbits; i++) {
      pbits.push(reader.readBits(1));
    }
  }
  
  // Apply P-bits to endpoints
  for (let s = 0; s < numSubsets; s++) {
    for (let c = 0; c < 3; c++) {
      for (let e = 0; e < 2; e++) {
        let val = endpoints[s][c * 2 + e];
        val <<= (8 - colorBits);
        if (pbits.length > 0) {
          const pbitIdx = mode === 1 ? s : (s * 2 + e);
          if (pbitIdx < pbits.length) {
            val |= pbits[pbitIdx] << (7 - colorBits);
          }
        }
        // Replicate high bits to low
        val |= val >> colorBits;
        endpoints[s][c * 2 + e] = val;
      }
    }
    if (alphaBits > 0 && alphaEndpoints[s]) {
      for (let e = 0; e < 2; e++) {
        let val = alphaEndpoints[s][e];
        val <<= (8 - alphaBits);
        if (pbits.length > 0 && mode === 6) {
          const pbitIdx = s * 2 + e;
          if (pbitIdx < pbits.length) {
            val |= pbits[pbitIdx] << (7 - alphaBits);
          }
        }
        val |= val >> alphaBits;
        alphaEndpoints[s][e] = val;
      }
    }
  }
  
  // Read color indices
  const indexBits = modeInfo.indexBits;
  const indices: number[] = [];
  for (let i = 0; i < 16; i++) {
    // First index of each subset uses one less bit
    const bits = (i === 0 || (numSubsets > 1 && partitionIndex < 32)) ? indexBits - 1 : indexBits;
    indices.push(reader.readBits(indexBits)); // Simplified - always read full bits
  }
  
  // Get partition table
  const partitionTable = numSubsets === 2 ? 
    (BC7_PARTITION_TABLE_2[partitionIndex % 32] || BC7_PARTITION_TABLE_2[0]) :
    new Array(16).fill(0); // Single subset
  
  // Decode pixels
  for (let i = 0; i < 16; i++) {
    const subset = numSubsets > 1 ? partitionTable[i] : 0;
    const idx = indices[i] & ((1 << indexBits) - 1);
    
    const r = interpolate(endpoints[subset][0], endpoints[subset][1], idx, indexBits);
    const g = interpolate(endpoints[subset][2], endpoints[subset][3], idx, indexBits);
    const b = interpolate(endpoints[subset][4], endpoints[subset][5], idx, indexBits);
    
    let a = 255;
    if (alphaBits > 0 && alphaEndpoints[subset]) {
      a = interpolate(alphaEndpoints[subset][0], alphaEndpoints[subset][1], idx, indexBits);
    }
    
    // Apply rotation (modes 4 and 5)
    let finalR = r, finalG = g, finalB = b, finalA = a;
    if (rotation === 1) { finalA = r; finalR = a; }
    else if (rotation === 2) { finalA = g; finalG = a; }
    else if (rotation === 3) { finalA = b; finalB = a; }
    
    output[i * 4] = Math.min(255, Math.max(0, finalR));
    output[i * 4 + 1] = Math.min(255, Math.max(0, finalG));
    output[i * 4 + 2] = Math.min(255, Math.max(0, finalB));
    output[i * 4 + 3] = Math.min(255, Math.max(0, finalA));
  }
  
  return output;
}

/**
 * Decode block-compressed texture to RGBA
 */
export function decodeTextureToRGBA(
  data: Uint8Array,
  width: number,
  height: number,
  format: number
): Uint8Array {
  const output = new Uint8Array(width * height * 4);
  
  // Handle uncompressed RGBA8 formats
  if (format === TextureFormat.R8G8B8A8_UNORM || format === TextureFormat.R8G8B8A8_UNORM_SRGB) {
    output.set(data.slice(0, width * height * 4));
    return output;
  }
  
  // Handle R8 format
  if (format === TextureFormat.R8_UNORM) {
    for (let i = 0; i < width * height; i++) {
      const value = data[i] || 0;
      output[i * 4] = value;
      output[i * 4 + 1] = value;
      output[i * 4 + 2] = value;
      output[i * 4 + 3] = 255;
    }
    return output;
  }
  
  // Handle A8 format
  if (format === TextureFormat.A8_UNORM) {
    for (let i = 0; i < width * height; i++) {
      const value = data[i] || 0;
      output[i * 4] = value;
      output[i * 4 + 1] = value;
      output[i * 4 + 2] = value;
      output[i * 4 + 3] = 255;
    }
    return output;
  }
  
  // Handle RG8 format
  if (format === TextureFormat.R8G8_UNORM) {
    for (let i = 0; i < width * height; i++) {
      output[i * 4] = data[i * 2] || 0;
      output[i * 4 + 1] = data[i * 2 + 1] || 0;
      output[i * 4 + 2] = 128;
      output[i * 4 + 3] = 255;
    }
    return output;
  }
  
  // Handle block-compressed formats
  if (!isBlockCompressed(format)) {
    // Return checkerboard for unknown formats
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const checker = ((x >> 3) ^ (y >> 3)) & 1;
        output[i] = checker ? 255 : 128;
        output[i + 1] = 0;
        output[i + 2] = checker ? 128 : 255;
        output[i + 3] = 255;
      }
    }
    return output;
  }
  
  const bytesPerBlock = BytesPerPixel[format] || 16;
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  
  // Row pitch is just blocksX * bytesPerBlock (no per-row alignment on PC)
  const rowPitch = blocksX * bytesPerBlock;
  
  let decoder: (block: Uint8Array) => Uint8Array;
  
  switch (format) {
    case TextureFormat.BC1_UNORM:
    case TextureFormat.BC1_UNORM_SRGB:
      decoder = decodeBC1Block;
      break;
    case TextureFormat.BC2_UNORM:
    case TextureFormat.BC2_UNORM_SRGB:
      // BC2 has explicit alpha - use BC3 decoder as approximation
      decoder = decodeBC3Block;
      break;
    case TextureFormat.BC3_UNORM:
    case TextureFormat.BC3_UNORM_SRGB:
      decoder = decodeBC3Block;
      break;
    case TextureFormat.BC4_UNORM:
    case TextureFormat.BC4_SNORM:
      decoder = decodeBC4Block;
      break;
    case TextureFormat.BC5_UNORM:
    case TextureFormat.BC5_SNORM:
      decoder = decodeBC5Block;
      break;
    case TextureFormat.BC7_UNORM:
    case TextureFormat.BC7_UNORM_SRGB:
      decoder = decodeBC7Block;
      break;
    case TextureFormat.BC6H_UF16:
    case TextureFormat.BC6H_SF16:
      // BC6H is HDR format - use simplified BC7 decoder as approximation
      decoder = decodeBC7Block;
      break;
    default:
      // Use BC1 decoder as fallback for unknown formats
      decoder = decodeBC1Block;
  }
  
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      // Use aligned row pitch for reading blocks
      const blockOffset = by * rowPitch + bx * bytesPerBlock;
      const block = data.slice(blockOffset, blockOffset + bytesPerBlock);
      
      if (block.length < bytesPerBlock) continue;
      
      const decoded = decoder(block);
      
      // Copy decoded block to output
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          
          if (x >= width || y >= height) continue;
          
          const srcIdx = (py * 4 + px) * 4;
          const dstIdx = (y * width + x) * 4;
          
          output[dstIdx] = decoded[srcIdx];
          output[dstIdx + 1] = decoded[srcIdx + 1];
          output[dstIdx + 2] = decoded[srcIdx + 2];
          output[dstIdx + 3] = decoded[srcIdx + 3];
        }
      }
    }
  }
  
  return output;
}

/**
 * Convert RGBA data to a data URL for img element
 */
export function rgbaToDataUrl(rgba: Uint8Array, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  
  const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
  ctx.putImageData(imageData, 0, 0);
  
  return canvas.toDataURL('image/png');
}
