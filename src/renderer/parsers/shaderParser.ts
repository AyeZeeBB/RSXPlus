/**
 * Shader and ShaderSet Asset Parsers
 * Parses shader assets to extract DXBC bytecode for resource binding extraction
 */

import { BinaryReader } from '../utils/binaryUtils';
import { extractTextureBindings } from './dxbcParser';

// Page pointer type
interface PagePtr {
  index: number;
  offset: number;
}

// Shader asset header (shdr)
export interface ShaderAssetHeader {
  dataPtr: PagePtr;
  dataSize: number;
}

// Shader set asset header (shds)
export interface ShaderSetAssetHeader {
  name: string;
  namePtr: PagePtr;
  numVertexShaderTextures: number;
  numPixelShaderTextures: number;
  numSamplers: number;
  firstResourceBindPoint: number;
  numResources: number;
  vertexShaderGuid: bigint;
  pixelShaderGuid: bigint;
}

// Parsed shader data
export interface ParsedShader {
  data: Uint8Array | null;
  textureBindings: Map<number, string>;
}

// Parsed shader set
export interface ParsedShaderSet {
  header: ShaderSetAssetHeader;
  name: string;
  pixelShaderGuid: bigint;
}

/**
 * Parse shader asset header (shdr)
 */
export function parseShaderHeader(
  headerData: Uint8Array,
  version: number
): ShaderAssetHeader | null {
  if (headerData.length < 16) {
    return null;
  }

  const reader = new BinaryReader(headerData);

  // shdr header structure:
  // void* data (8 bytes as page ptr)
  // uint32_t dataSize
  const dataPtr: PagePtr = {
    index: reader.readUint32(),
    offset: reader.readUint32(),
  };
  const dataSize = reader.readUint32();

  return {
    dataPtr,
    dataSize,
  };
}

/**
 * Parse shader set asset header (shds)
 * Supports versions: v8, v11, v12, v13, v14
 */
export function parseShaderSetHeader(
  headerData: Uint8Array,
  version: number,
  getPageData: (pageIndex: number) => Uint8Array | null
): ParsedShaderSet | null {
  // Minimum header size varies by version
  const minSize = version <= 8 ? 88 : version <= 11 ? 64 : version <= 12 ? 80 : version <= 13 ? 112 : 64;
  if (headerData.length < minSize) {
    console.warn(`[ShaderSetParser] Header too small for v${version}: ${headerData.length} < ${minSize}`);
    return null;
  }

  const reader = new BinaryReader(headerData);

  let namePtr: PagePtr;
  let numPixelShaderTextures: number;
  let numVertexShaderTextures: number;
  let numSamplers: number;
  let firstResourceBindPoint: number;
  let numResources: number;
  let vertexShaderGuid: bigint;
  let pixelShaderGuid: bigint;

  if (version <= 8) {
    // v8: ShaderSetAssetHeader_v8_t (88 bytes)
    // uint64_t reserved_vftable (8)
    // char* name (8)
    // uint64_t reserved_inputFlags (8)
    // uint16_t textureInputCounts[2] (4)
    // uint16_t numSamplers (2)
    // uint16_t firstResourceBindPoint (2)
    // uint16_t numResources (2)
    // uint8_t reserved_vsInputLayoutIds[32] (32)
    // uint64_t vertexShader (8)
    // uint64_t pixelShader (8)
    reader.skip(8); // vftable
    namePtr = { index: reader.readUint32(), offset: reader.readUint32() };
    reader.skip(8); // inputFlags
    const textureInputCount0 = reader.readUint16();
    const textureInputCount1 = reader.readUint16();
    numSamplers = reader.readUint16();
    firstResourceBindPoint = reader.readUint16();
    numResources = reader.readUint16();
    reader.skip(32); // vsInputLayoutIds
    vertexShaderGuid = reader.readUint64();
    pixelShaderGuid = reader.readUint64();
    // v8: textures work differently
    numPixelShaderTextures = textureInputCount0;
    numVertexShaderTextures = textureInputCount1;
  } else if (version <= 11) {
    // v11: ShaderSetAssetHeader_v11_t (64 bytes)
    reader.skip(8); // vftable
    namePtr = { index: reader.readUint32(), offset: reader.readUint32() };
    reader.skip(8); // inputFlags
    const textureInputCount0 = reader.readUint16();
    const textureInputCount1 = reader.readUint16();
    numSamplers = reader.readUint16();
    firstResourceBindPoint = reader.readUint8();
    numResources = reader.readUint8();
    reader.skip(16); // vsInputLayoutIds[16]
    vertexShaderGuid = reader.readUint64();
    pixelShaderGuid = reader.readUint64();
    numPixelShaderTextures = textureInputCount0;
    numVertexShaderTextures = textureInputCount1 - textureInputCount0;
  } else if (version <= 12) {
    // v12: ShaderSetAssetHeader_v12_t (80 bytes)
    reader.skip(8); // vftable
    namePtr = { index: reader.readUint32(), offset: reader.readUint32() };
    reader.skip(8); // inputFlags
    const textureInputCount0 = reader.readUint16();
    const textureInputCount1 = reader.readUint16();
    numSamplers = reader.readUint16();
    firstResourceBindPoint = reader.readUint8();
    numResources = reader.readUint8();
    reader.skip(32); // vsInputLayoutIds[32]
    vertexShaderGuid = reader.readUint64();
    pixelShaderGuid = reader.readUint64();
    numPixelShaderTextures = textureInputCount0;
    numVertexShaderTextures = textureInputCount1 - textureInputCount0;
  } else if (version <= 13) {
    // v13: ShaderSetAssetHeader_v13_t (112 bytes)
    reader.skip(8); // vftable
    namePtr = { index: reader.readUint32(), offset: reader.readUint32() };
    reader.skip(8); // inputFlags
    const textureInputCount0 = reader.readUint16();
    const textureInputCount1 = reader.readUint16();
    numSamplers = reader.readUint16();
    firstResourceBindPoint = reader.readUint8();
    numResources = reader.readUint8();
    reader.skip(32); // vsInputLayoutIds[32]
    reader.skip(32); // unk_40[32]
    vertexShaderGuid = reader.readUint64();
    pixelShaderGuid = reader.readUint64();
    numPixelShaderTextures = textureInputCount0;
    numVertexShaderTextures = textureInputCount1 - textureInputCount0;
  } else {
    // v14+: ShaderSetAssetHeader_v14_t (64 bytes)
    reader.skip(8); // vftable
    namePtr = { index: reader.readUint32(), offset: reader.readUint32() };
    const textureInputCount0 = reader.readUint16();
    const textureInputCount1 = reader.readUint16();
    numSamplers = reader.readUint16();
    firstResourceBindPoint = reader.readUint8();
    numResources = reader.readUint8();
    reader.skip(16); // unk_28[16]
    reader.skip(8); // unk_38
    vertexShaderGuid = reader.readUint64();
    pixelShaderGuid = reader.readUint64();
    numPixelShaderTextures = textureInputCount0;
    numVertexShaderTextures = textureInputCount1 - textureInputCount0;
  }

  // Read name from page
  let name = '';
  if (namePtr.index !== 0 || namePtr.offset !== 0) {
    const page = getPageData(namePtr.index);
    if (page && namePtr.offset < page.length) {
      let end = namePtr.offset;
      while (end < page.length && page[end] !== 0) {
        end++;
      }
      name = new TextDecoder().decode(page.slice(namePtr.offset, end));
    }
  }

  return {
    header: {
      name,
      namePtr,
      numVertexShaderTextures,
      numPixelShaderTextures,
      numSamplers,
      firstResourceBindPoint,
      numResources,
      vertexShaderGuid,
      pixelShaderGuid,
    },
    name,
    pixelShaderGuid,
  };
}

/**
 * Parse shader bytecode and extract texture bindings
 */
export function parseShaderData(
  shaderData: Uint8Array
): Map<number, string> {
  return extractTextureBindings(shaderData);
}

/**
 * Get texture binding names for a material by parsing its shader set's pixel shader
 */
export function getTextureBindingsForMaterial(
  shaderSetGuid: bigint,
  findAssetByGuid: (guid: bigint) => { headerData: Uint8Array; version: number } | null,
  getPageData: (pageIndex: number) => Uint8Array | null,
  getShaderData: (shaderGuid: bigint) => Uint8Array | null
): Map<number, string> {
  const defaultBindings = new Map<number, string>();

  // Find shader set asset
  const shaderSetAsset = findAssetByGuid(shaderSetGuid);
  if (!shaderSetAsset) {
    return defaultBindings;
  }

  // Parse shader set header
  const shaderSet = parseShaderSetHeader(
    shaderSetAsset.headerData,
    shaderSetAsset.version,
    getPageData
  );
  if (!shaderSet) {
    return defaultBindings;
  }

  // Get pixel shader data
  const pixelShaderData = getShaderData(shaderSet.pixelShaderGuid);
  if (!pixelShaderData) {
    return defaultBindings;
  }

  // Parse DXBC and extract texture bindings
  return parseShaderData(pixelShaderData);
}
