/**
 * Material asset parser
 * Ported from the C++ RSX implementation
 */

import { BinaryReader } from '../utils/binaryUtils';
import { ParsedAsset } from './rpakParser';
import { PagePtr } from './rpakTypes';

// Material shader types from RSX
export enum MaterialShaderType {
  RGDU = 0x0,  // Static Props with regular vertices
  RGDP = 0x1,  // Static Props with packed vertex positions
  RGDC = 0x2,  // Static Props with packed vertex positions
  SKNU = 0x3,  // Skinned model with regular vertices
  SKNP = 0x4,  // Skinned model with packed vertex positions
  SKNC = 0x5,  // Skinned model with packed vertex positions
  WLDU = 0x6,  // World geometry with regular vertices
  WLDC = 0x7,  // World geometry with packed vertex positions
  PTCU = 0x8,  // Particles with regular vertices
  PTCS = 0x9,  // Particles
  RGBS = 0xA,  // Unknown
  
  // Legacy types (Titanfall)
  SKN = 0x0C,
  FIX = 0x0D,
  WLD = 0x0E,
  GEN = 0x0F,
  RGD = 0x10,
  LEGACY = 0x11,
  
  UNKNOWN = 0xFF,
}

// Material shader type names
export const MaterialShaderTypeNames: Record<number, string> = {
  [MaterialShaderType.RGDU]: 'RGDU (Static Props)',
  [MaterialShaderType.RGDP]: 'RGDP (Static Props Packed)',
  [MaterialShaderType.RGDC]: 'RGDC (Static Props Packed)',
  [MaterialShaderType.SKNU]: 'SKNU (Skinned)',
  [MaterialShaderType.SKNP]: 'SKNP (Skinned Packed)',
  [MaterialShaderType.SKNC]: 'SKNC (Skinned Packed)',
  [MaterialShaderType.WLDU]: 'WLDU (World)',
  [MaterialShaderType.WLDC]: 'WLDC (World Packed)',
  [MaterialShaderType.PTCU]: 'PTCU (Particles)',
  [MaterialShaderType.PTCS]: 'PTCS (Particles)',
  [MaterialShaderType.RGBS]: 'RGBS',
  [MaterialShaderType.SKN]: 'SKN (Legacy Skinned)',
  [MaterialShaderType.FIX]: 'FIX (Legacy Fixup)',
  [MaterialShaderType.WLD]: 'WLD (Legacy World)',
  [MaterialShaderType.GEN]: 'GEN (Legacy General)',
  [MaterialShaderType.RGD]: 'RGD (Legacy)',
  [MaterialShaderType.LEGACY]: 'Legacy',
  [MaterialShaderType.UNKNOWN]: 'Unknown',
};

// DX state for materials (0x30 bytes aligned)
export interface MaterialDXState {
  blendStates: number[];      // 8 uint32s (D3D11_SIMULTANEOUS_RENDER_TARGET_COUNT)
  blendStateMask: number;     // uint32
  depthStencilFlags: number;  // uint16
  rasterizerFlags: number;    // uint16
}

// Material asset header (unified)
export interface MaterialAssetHeader {
  version: number;
  guid: bigint;
  namePtr: PagePtr;
  surfaceNamePtr: PagePtr;
  surfaceName2Ptr: PagePtr;
  depthShadowMaterial: bigint;
  depthPrepassMaterial: bigint;
  depthVSMMaterial: bigint;
  depthShadowTightMaterial: bigint;
  colpassMaterial: bigint;
  shaderSetGuid: bigint;
  textureHandlesPtr: PagePtr;
  streamingTextureHandlesPtr: PagePtr;
  numStreamingTextureHandles: number;
  width: number;
  height: number;
  depth: number;
  samplers: number[];
  dxStates: MaterialDXState[];  // 2 DX states
  glueFlags: number;
  glueFlags2: number;
  numAnimationFrames: number;
  materialType: MaterialShaderType;
  uberBufferFlags: number;
  textureAnimation: bigint;
}

// Texture entry for a material
export interface MaterialTextureEntry {
  index: number;
  guid: bigint;
  guidHex: string;
  name: string | null;
  resourceBindingName: string;
  isLoaded: boolean;
  width?: number;
  height?: number;
}

// Full parsed material data
export interface ParsedMaterialData {
  header: MaterialAssetHeader;
  name: string;
  surfaceName: string;
  surfaceName2: string;
  shaderSetName: string | null;
  textures: MaterialTextureEntry[];
  cpuData: Uint8Array | null;
  cpuDataSize: number;
}

// Material asset header
export interface MaterialAssetHeaderLegacy {
  namePtr: PagePtr;
  surfaceNamePtr: PagePtr;
  shaderSetGuid: bigint;
  textureGUIDs: bigint[];
  textureCount: number;
  samplerCount: number;
  width: number;
  height: number;
  flags: number;
  materialType: MaterialType;
}

// Material types (legacy enum for backward compatibility)
export enum MaterialType {
  UNKNOWN = 0,
  UNLIT = 1,
  LIT = 2,
  UNLITTS = 3,  // Unlit Two-Sided
  SKIN = 4,
  WORLD = 5,
  SKY = 6,
  CABLE = 7,
  DECAL = 8,
  EFFECT = 9,
  WATER = 10,
}

// Material type names
export const MaterialTypeNames: Record<MaterialType, string> = {
  [MaterialType.UNKNOWN]: 'Unknown',
  [MaterialType.UNLIT]: 'Unlit',
  [MaterialType.LIT]: 'Lit',
  [MaterialType.UNLITTS]: 'Unlit Two-Sided',
  [MaterialType.SKIN]: 'Skin',
  [MaterialType.WORLD]: 'World',
  [MaterialType.SKY]: 'Sky',
  [MaterialType.CABLE]: 'Cable',
  [MaterialType.DECAL]: 'Decal',
  [MaterialType.EFFECT]: 'Effect',
  [MaterialType.WATER]: 'Water',
};

// Known texture binding names from RSX shader analysis - matches C++ export format
export const TextureBindingNames: Record<number, string> = {
  0: 'albedoTexture',
  1: 'normalTexture',
  2: 'glossTexture',
  3: 'specTexture',
  4: 'emissiveTexture',
  5: 'aoTexture',
  6: 'cavityTexture',
  7: 'detailTexture',
  8: 'detailNormalTexture',
  9: 'opacityMultiplyTexture',
  10: 'scatterThicknessTexture',
  11: 'anisoSpecDirTexture',
};

/**
 * Parse material header for v15 (Apex Legends Season 0-2)
 * Has dxStates[2] - array of 2 DX states
 */
function parseMaterialHeader_v15(reader: BinaryReader, version: number): MaterialAssetHeader {
  const vftableReserved = reader.readUint64();
  const gap8 = reader.readUint64();
  const guid = reader.readUint64();
  
  const namePtr: PagePtr = { index: reader.readUint32(), offset: reader.readUint32() };
  const surfaceNamePtr: PagePtr = { index: reader.readUint32(), offset: reader.readUint32() };
  const surfaceName2Ptr: PagePtr = { index: reader.readUint32(), offset: reader.readUint32() };
  
  const depthShadowMaterial = reader.readUint64();
  const depthPrepassMaterial = reader.readUint64();
  const depthVSMMaterial = reader.readUint64();
  const depthShadowTightMaterial = reader.readUint64();
  const colpassMaterial = reader.readUint64();
  
  const shaderSetGuid = reader.readUint64();
  
  const textureHandlesPtr: PagePtr = { index: reader.readUint32(), offset: reader.readUint32() };
  const streamingTextureHandlesPtr: PagePtr = { index: reader.readUint32(), offset: reader.readUint32() };
  
  const numStreamingTextureHandles = reader.readUint16();
  const width = reader.readUint16();
  const height = reader.readUint16();
  const depth = reader.readUint16();
  
  const samplers = [reader.readUint8(), reader.readUint8(), reader.readUint8(), reader.readUint8()];
  
  const unk_7C = reader.readUint32();
  const unk_80 = reader.readUint32();
  const unk_84 = reader.readUint32();
  
  const glueFlags = reader.readUint32();
  const glueFlags2 = reader.readUint32();
  
  // v15 has dxStates[2] - array of 2 DX states (2 * 0x30 = 96 bytes)
  // Each MaterialDXState_t is: blendStates[8] (32 bytes) + blendStateMask (4) + depthStencilFlags (2) + rasterizerFlags (2) + unk_28 (8)
  const dxStates: MaterialDXState[] = [];
  for (let i = 0; i < 2; i++) {
    const blendStates: number[] = [];
    for (let j = 0; j < 8; j++) {
      blendStates.push(reader.readUint32());
    }
    const blendStateMask = reader.readUint32();
    const depthStencilFlags = reader.readUint16();
    const rasterizerFlags = reader.readUint16();
    reader.skip(8); // unk_28
    
    dxStates.push({
      blendStates,
      blendStateMask,
      depthStencilFlags,
      rasterizerFlags,
    });
  }
  
  const numAnimationFrames = reader.readUint16();
  const materialType = reader.readUint8() as MaterialShaderType;
  const uberBufferFlags = reader.readUint8();
  
  reader.skip(4); // padding
  
  const textureAnimation = reader.readUint64();
  
  return {
    version,
    guid,
    namePtr,
    surfaceNamePtr,
    surfaceName2Ptr,
    depthShadowMaterial,
    depthPrepassMaterial,
    depthVSMMaterial,
    depthShadowTightMaterial,
    colpassMaterial,
    shaderSetGuid,
    textureHandlesPtr,
    streamingTextureHandlesPtr,
    numStreamingTextureHandles,
    width,
    height,
    depth,
    samplers,
    dxStates,
    glueFlags,
    glueFlags2,
    numAnimationFrames,
    materialType,
    uberBufferFlags,
    textureAnimation,
  };
}

/**
 * Parse material header for v16-v21 (Apex Legends later seasons)
 * Has single dxStates (not array)
 */
function parseMaterialHeader_v16(reader: BinaryReader, version: number): MaterialAssetHeader {
  const vftableReserved = reader.readUint64();
  const gap8 = reader.readUint64();
  const guid = reader.readUint64();
  
  const namePtr: PagePtr = { index: reader.readUint32(), offset: reader.readUint32() };
  const surfaceNamePtr: PagePtr = { index: reader.readUint32(), offset: reader.readUint32() };
  const surfaceName2Ptr: PagePtr = { index: reader.readUint32(), offset: reader.readUint32() };
  
  const depthShadowMaterial = reader.readUint64();
  const depthPrepassMaterial = reader.readUint64();
  const depthVSMMaterial = reader.readUint64();
  const depthShadowTightMaterial = reader.readUint64();
  const colpassMaterial = reader.readUint64();
  
  const shaderSetGuid = reader.readUint64();
  
  const textureHandlesPtr: PagePtr = { index: reader.readUint32(), offset: reader.readUint32() };
  const streamingTextureHandlesPtr: PagePtr = { index: reader.readUint32(), offset: reader.readUint32() };
  
  const numStreamingTextureHandles = reader.readUint16();
  const width = reader.readUint16();
  const height = reader.readUint16();
  const depth = reader.readUint16();
  
  const samplers = [reader.readUint8(), reader.readUint8(), reader.readUint8(), reader.readUint8()];
  
  const unk_7C = reader.readUint32();
  const unk_80 = reader.readUint32();
  const unk_84 = reader.readUint32();
  
  const glueFlags = reader.readUint32();
  const glueFlags2 = reader.readUint32();
  
  // v16-21 has single dxStates (0x30 = 48 bytes)
  const blendStates: number[] = [];
  for (let j = 0; j < 8; j++) {
    blendStates.push(reader.readUint32());
  }
  const blendStateMask = reader.readUint32();
  const depthStencilFlags = reader.readUint16();
  const rasterizerFlags = reader.readUint16();
  reader.skip(8); // unk_28
  
  const dxStates: MaterialDXState[] = [{
    blendStates,
    blendStateMask,
    depthStencilFlags,
    rasterizerFlags,
  }];
  
  // v16 has extra fields: unk_C0[2] (8 bytes)
  reader.skip(8);
  
  const numAnimationFrames = reader.readUint16();
  const materialType = reader.readUint8() as MaterialShaderType;
  const uberBufferFlags = reader.readUint8();
  
  reader.skip(4); // unk_CC
  
  const textureAnimation = reader.readUint64();
  
  return {
    version,
    guid,
    namePtr,
    surfaceNamePtr,
    surfaceName2Ptr,
    depthShadowMaterial,
    depthPrepassMaterial,
    depthVSMMaterial,
    depthShadowTightMaterial,
    colpassMaterial,
    shaderSetGuid,
    textureHandlesPtr,
    streamingTextureHandlesPtr,
    numStreamingTextureHandles,
    width,
    height,
    depth,
    samplers,
    dxStates,
    glueFlags,
    glueFlags2,
    numAnimationFrames,
    materialType,
    uberBufferFlags,
    textureAnimation,
  };
}

/**
 * Parse material header for v12 (Titanfall 2)
 */
function parseMaterialHeader_v12(reader: BinaryReader, version: number): MaterialAssetHeader {
  const vftableReserved = reader.readUint64();
  const gap8 = reader.readUint64();
  const guid = reader.readUint64();
  
  const namePtr: PagePtr = { index: reader.readUint32(), offset: reader.readUint32() };
  const surfaceNamePtr: PagePtr = { index: reader.readUint32(), offset: reader.readUint32() };
  const surfaceName2Ptr: PagePtr = { index: reader.readUint32(), offset: reader.readUint32() };
  
  const depthShadowMaterial = reader.readUint64();
  const depthPrepassMaterial = reader.readUint64();
  const depthVSMMaterial = reader.readUint64();
  const colpassMaterial = reader.readUint64();
  
  // v12 has dxStates here (2 * 0x20 = 64 bytes)
  // MaterialDXState_v12_t: blendStates[4] (16 bytes) + blendStateMask (4) + depthStencilFlags (2) + rasterizerFlags (2) = 0x18 + padding = 0x20
  const dxStates: MaterialDXState[] = [];
  for (let i = 0; i < 2; i++) {
    const blendStates: number[] = [];
    // v12 has only 4 blendStates, pad to 8 for consistency
    for (let j = 0; j < 4; j++) {
      blendStates.push(reader.readUint32());
    }
    // Pad with zeros to match v15's 8 blend states
    for (let j = 4; j < 8; j++) {
      blendStates.push(0);
    }
    const blendStateMask = reader.readUint32();
    const depthStencilFlags = reader.readUint16();
    const rasterizerFlags = reader.readUint16();
    // v12 dxState is 0x20 bytes total, we read 24 bytes so skip 8 for alignment
    reader.skip(8);
    
    dxStates.push({
      blendStates,
      blendStateMask,
      depthStencilFlags,
      rasterizerFlags,
    });
  }
  
  const shaderSetGuid = reader.readUint64();
  
  const textureHandlesPtr: PagePtr = { index: reader.readUint32(), offset: reader.readUint32() };
  const streamingTextureHandlesPtr: PagePtr = { index: reader.readUint32(), offset: reader.readUint32() };
  
  const numStreamingTextureHandles = reader.readUint16();
  
  const samplers = [reader.readUint8(), reader.readUint8(), reader.readUint8(), reader.readUint8()];
  
  const unk_AE = reader.readUint16();
  const unk_B0 = reader.readUint64();
  const unk_B8 = reader.readUint32();
  const unk_BC = reader.readUint32();
  
  const glueFlags = reader.readUint32();
  const glueFlags2 = reader.readUint32();
  
  const width = reader.readUint16();
  const height = reader.readUint16();
  const depth = reader.readUint16();
  
  return {
    version,
    guid,
    namePtr,
    surfaceNamePtr,
    surfaceName2Ptr,
    depthShadowMaterial,
    depthPrepassMaterial,
    depthVSMMaterial,
    depthShadowTightMaterial: 0n,
    colpassMaterial,
    shaderSetGuid,
    textureHandlesPtr,
    streamingTextureHandlesPtr,
    numStreamingTextureHandles,
    width,
    height,
    depth,
    samplers,
    dxStates,
    glueFlags,
    glueFlags2,
    numAnimationFrames: 0,
    materialType: MaterialShaderType.LEGACY,
    uberBufferFlags: 0,
    textureAnimation: 0n,
  };
}

/**
 * Parse material header for v22+ (Apex Legends Season 18+)
 * Similar to v16 but with some fields moved/removed
 */
function parseMaterialHeader_v22(reader: BinaryReader, version: number, headerSize: number): MaterialAssetHeader {
  // v22 is 256 bytes, v23 is 192 or 200 bytes
  // Both have: unk_0 (8) + snapshotMaterial (8, only v23+) + guid (8) + name (8) + surfaceProp (8) + surfaceProp2 (8)
  //           + depthShadowMaterial (8) + depthPrepassMaterial (8) + depthVSMMaterial (8) + depthShadowTightMaterial (8)
  //           + colpassMaterial (8) + shaderSet (8) + textureHandles (8) + streamingTextureHandles (8)
  //           + numStreamingTextureHandles (2) + width (2) + height (2) + depth (2)
  //           + samplers (4) + unk_7C (4) + unk_80 (4)
  
  // For v23+, there's no dxStates block - it's replaced with simpler fields
  const isV23 = version >= 23 || headerSize <= 200;
  
  if (isV23) {
    // v23 structure (192/200 bytes)
    const unk_0 = reader.readUint64();
    const snapshotMaterial = reader.readUint64();
    const guid = reader.readUint64();
    
    const namePtr: PagePtr = { index: reader.readUint32(), offset: reader.readUint32() };
    const surfaceNamePtr: PagePtr = { index: reader.readUint32(), offset: reader.readUint32() };
    const surfaceName2Ptr: PagePtr = { index: reader.readUint32(), offset: reader.readUint32() };
    
    const depthShadowMaterial = reader.readUint64();
    const depthPrepassMaterial = reader.readUint64();
    const depthVSMMaterial = reader.readUint64();
    const depthShadowTightMaterial = reader.readUint64();
    const colpassMaterial = reader.readUint64();
    
    const shaderSetGuid = reader.readUint64();
    
    const textureHandlesPtr: PagePtr = { index: reader.readUint32(), offset: reader.readUint32() };
    const streamingTextureHandlesPtr: PagePtr = { index: reader.readUint32(), offset: reader.readUint32() };
    
    const numStreamingTextureHandles = reader.readUint16();
    const width = reader.readUint16();
    const height = reader.readUint16();
    const depth = reader.readUint16();
    
    const samplers = [reader.readUint8(), reader.readUint8(), reader.readUint8(), reader.readUint8()];
    
    const unk_7C = reader.readUint32();
    const unk_80 = reader.readUint32();
    
    const glueFlags = reader.readUint32();
    const glueFlags2 = reader.readUint32();
    
    // v23 has unk_8C[16] instead of dxStates
    reader.skip(16);
    
    const numAnimationFrames = reader.readUint16();
    const materialType = reader.readUint8() as MaterialShaderType;
    const uberBufferFlags = reader.readUint8();
    
    return {
      version,
      guid,
      namePtr,
      surfaceNamePtr,
      surfaceName2Ptr,
      depthShadowMaterial,
      depthPrepassMaterial,
      depthVSMMaterial,
      depthShadowTightMaterial,
      colpassMaterial,
      shaderSetGuid,
      textureHandlesPtr,
      streamingTextureHandlesPtr,
      numStreamingTextureHandles,
      width,
      height,
      depth,
      samplers,
      dxStates: [],
      glueFlags,
      glueFlags2,
      numAnimationFrames,
      materialType,
      uberBufferFlags,
      textureAnimation: 0n,
    };
  } else {
    // v22 structure (256 bytes) - similar to v16 but with extra fields at end
    return parseMaterialHeader_v16(reader, version);
  }
}

/**
 * Parse full material asset including texture GUIDs
 * @param asset The parsed asset
 * @param getPageData Function to get page data by index
 * @param shaderTextureBindings Optional map of texture bindings from shader DXBC parsing
 */
export function parseMaterialAsset(
  asset: ParsedAsset,
  getPageData: (pageIndex: number) => Uint8Array | null,
  shaderTextureBindings?: Map<number, string>
): ParsedMaterialData | null {
  if (!asset.headerData || asset.headerData.length < 48) {
    return null;
  }

  const reader = new BinaryReader(asset.headerData);
  const version = asset.version || 15;
  const headerSize = asset.headerSize || asset.headerData.length;
  
  let header: MaterialAssetHeader;
  
  try {
    // Use header size as hint for version detection
    // v12: 208 bytes, v15: 256 bytes, v16-v21: 240 bytes, v22: 256 bytes, v23: 192-200 bytes
    if (version <= 12) {
      if (headerSize < 208) {
        console.warn(`[MaterialParser] v12 material header too small: ${headerSize} < 208`);
        return null;
      }
      header = parseMaterialHeader_v12(reader, version);
    } else if (version <= 15) {
      if (headerSize < 256) {
        console.warn(`[MaterialParser] v15 material header too small: ${headerSize} < 256`);
        return null;
      }
      header = parseMaterialHeader_v15(reader, version);
    } else if (version >= 22) {
      // v22+ has different structure
      if (headerSize < 192) {
        console.warn(`[MaterialParser] v22+ material header too small: ${headerSize} < 192`);
        return null;
      }
      header = parseMaterialHeader_v22(reader, version, headerSize);
    } else {
      // v16-v21 use single dxStates
      if (headerSize < 240) {
        console.warn(`[MaterialParser] v16 material header too small: ${headerSize} < 240`);
        return null;
      }
      header = parseMaterialHeader_v16(reader, version);
    }
  } catch (e) {
    console.error('[MaterialParser] Failed to parse header:', e, { version, headerSize, dataLength: asset.headerData.length });
    return null;
  }

  // Read name from page data
  let name = '';
  if (header.namePtr.index >= 0) {
    const page = getPageData(header.namePtr.index);
    if (page) {
      name = readNullTerminatedString(page, header.namePtr.offset);
    }
  }

  // Read surface name
  let surfaceName = '';
  // Check for valid (non-null) pointer - index 0 offset 0 is typically NULL
  if (header.surfaceNamePtr.index !== 0 || header.surfaceNamePtr.offset !== 0) {
    const page = getPageData(header.surfaceNamePtr.index);
    if (page && header.surfaceNamePtr.offset < page.length) {
      surfaceName = readNullTerminatedString(page, header.surfaceNamePtr.offset);
    }
  }

  // Read surface name 2
  let surfaceName2 = '';
  // Check for valid (non-null) pointer - index 0 offset 0 is typically NULL
  if (header.surfaceName2Ptr.index !== 0 || header.surfaceName2Ptr.offset !== 0) {
    const page = getPageData(header.surfaceName2Ptr.index);
    if (page && header.surfaceName2Ptr.offset < page.length) {
      surfaceName2 = readNullTerminatedString(page, header.surfaceName2Ptr.offset);
    }
  }

  // Read texture GUIDs from textureHandles page
  const textures: MaterialTextureEntry[] = [];
  if (header.textureHandlesPtr.index >= 0 && header.streamingTextureHandlesPtr.index >= 0) {
    const txtrPage = getPageData(header.textureHandlesPtr.index);
    const streamPage = getPageData(header.streamingTextureHandlesPtr.index);
    
    if (txtrPage && streamPage) {
      // Calculate texture count from the difference between textureHandles and streamingTextureHandles
      let textureCount: number;
      if (header.textureHandlesPtr.index === header.streamingTextureHandlesPtr.index) {
        // Same page - calculate from offset difference
        textureCount = (header.streamingTextureHandlesPtr.offset - header.textureHandlesPtr.offset) / 8;
      } else {
        // Different pages - estimate from remaining page data
        textureCount = Math.floor((txtrPage.length - header.textureHandlesPtr.offset) / 8);
      }
      
      // Clamp to reasonable value
      textureCount = Math.min(textureCount, 32);
      
      const txtrReader = new BinaryReader(txtrPage);
      txtrReader.seek(header.textureHandlesPtr.offset);
      
      for (let i = 0; i < textureCount; i++) {
        if (txtrReader.position + 8 > txtrPage.length) break;
        
        const guid = txtrReader.readUint64();
        if (guid === 0n) continue; // Skip empty slots
        
        // Use shader texture bindings if available, otherwise fall back to static names
        const bindingName = shaderTextureBindings?.get(i) || TextureBindingNames[i] || `Texture ${i}`;
        
        textures.push({
          index: i,
          guid,
          guidHex: `0x${guid.toString(16).toUpperCase().padStart(16, '0')}`,
          name: null, // Will be resolved later if texture is loaded
          resourceBindingName: bindingName,
          isLoaded: false,
        });
      }
    }
  }

  return {
    header,
    name: name || asset.name,
    surfaceName,
    surfaceName2,
    shaderSetName: null,
    textures,
    cpuData: null, // TODO: Read CPU data for uber buffer
    cpuDataSize: 0,
  };
}

/**
 * Check if a string contains only valid printable ASCII characters
 */
function isValidPrintableString(str: string): boolean {
  if (str.length === 0) return false;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // Allow printable ASCII (32-126) and common path characters
    if (code < 32 || code > 126) {
      return false;
    }
  }
  return true;
}

/**
 * Read null-terminated string from buffer, returns empty string if invalid
 */
function readNullTerminatedString(buffer: Uint8Array, offset: number): string {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) {
    end++;
  }
  const decoder = new TextDecoder('utf-8');
  const str = decoder.decode(buffer.slice(offset, end));
  
  // Validate the string contains only printable ASCII
  if (!isValidPrintableString(str)) {
    return '';
  }
  return str;
}

// Material texture slot types
export enum TextureSlot {
  DIFFUSE = 0,
  NORMAL = 1,
  GLOSS = 2,
  SPECULAR = 3,
  EMISSION = 4,
  TRANSMISSION = 5,
  AMBIENT_OCCLUSION = 6,
  CAVITY = 7,
  DETAIL = 8,
  DETAIL_NORMAL = 9,
  OPACITY = 10,
  CUSTOM = 11,
}

// Texture slot names
export const TextureSlotNames: Record<TextureSlot, string> = {
  [TextureSlot.DIFFUSE]: 'Diffuse',
  [TextureSlot.NORMAL]: 'Normal',
  [TextureSlot.GLOSS]: 'Gloss',
  [TextureSlot.SPECULAR]: 'Specular',
  [TextureSlot.EMISSION]: 'Emission',
  [TextureSlot.TRANSMISSION]: 'Transmission',
  [TextureSlot.AMBIENT_OCCLUSION]: 'Ambient Occlusion',
  [TextureSlot.CAVITY]: 'Cavity',
  [TextureSlot.DETAIL]: 'Detail',
  [TextureSlot.DETAIL_NORMAL]: 'Detail Normal',
  [TextureSlot.OPACITY]: 'Opacity',
  [TextureSlot.CUSTOM]: 'Custom',
};

// Material texture reference
export interface MaterialTexture {
  slot: TextureSlot;
  slotName: string;
  textureGuid: string;
}

// Parsed material info
export interface ParsedMaterial {
  name: string;
  surfaceName: string;
  shaderSetGuid: string;
  materialType: MaterialType;
  materialTypeName: string;
  width: number;
  height: number;
  flags: number;
  textures: MaterialTexture[];
}

/**
 * Parse a material asset header
 */
export function parseMaterialHeader(asset: ParsedAsset): Partial<MaterialAssetHeader> | null {
  if (!asset.headerData || asset.headerData.length < 48) {
    return null;
  }

  const reader = new BinaryReader(asset.headerData);

  // Name pointer (8 bytes)
  const namePtr: PagePtr = {
    index: reader.readUint32(),
    offset: reader.readUint32(),
  };

  // Surface name pointer (8 bytes)
  const surfaceNamePtr: PagePtr = {
    index: reader.readUint32(),
    offset: reader.readUint32(),
  };

  // Shader set GUID (8 bytes)
  const shaderSetGuid = reader.readUint64();

  // Skip to texture count section (varies by version)
  // For now, read what we can
  
  return {
    namePtr,
    surfaceNamePtr,
    shaderSetGuid,
  };
}

/**
 * Guess texture slot from texture name
 */
export function guessTextureSlot(textureName: string): TextureSlot {
  const lowerName = textureName.toLowerCase();
  
  if (lowerName.includes('_col') || lowerName.includes('_diff') || lowerName.includes('_albedo')) {
    return TextureSlot.DIFFUSE;
  }
  if (lowerName.includes('_nml') || lowerName.includes('_normal') || lowerName.includes('_nor')) {
    return TextureSlot.NORMAL;
  }
  if (lowerName.includes('_gls') || lowerName.includes('_gloss') || lowerName.includes('_rough')) {
    return TextureSlot.GLOSS;
  }
  if (lowerName.includes('_spc') || lowerName.includes('_spec') || lowerName.includes('_metal')) {
    return TextureSlot.SPECULAR;
  }
  if (lowerName.includes('_ilm') || lowerName.includes('_emis') || lowerName.includes('_emit')) {
    return TextureSlot.EMISSION;
  }
  if (lowerName.includes('_ao') || lowerName.includes('_occlusion')) {
    return TextureSlot.AMBIENT_OCCLUSION;
  }
  if (lowerName.includes('_cav') || lowerName.includes('_cavity')) {
    return TextureSlot.CAVITY;
  }
  if (lowerName.includes('_dtl') || lowerName.includes('_detail')) {
    if (lowerName.includes('nml') || lowerName.includes('normal')) {
      return TextureSlot.DETAIL_NORMAL;
    }
    return TextureSlot.DETAIL;
  }
  if (lowerName.includes('_opa') || lowerName.includes('_alpha') || lowerName.includes('_mask')) {
    return TextureSlot.OPACITY;
  }
  
  return TextureSlot.CUSTOM;
}

/**
 * Export material to a simple JSON format
 */
export function exportMaterialToJSON(material: ParsedMaterial): string {
  return JSON.stringify({
    name: material.name,
    surfaceName: material.surfaceName,
    shaderSet: material.shaderSetGuid,
    type: material.materialTypeName,
    dimensions: {
      width: material.width,
      height: material.height,
    },
    textures: material.textures.map(tex => ({
      slot: tex.slotName,
      texture: tex.textureGuid,
    })),
  }, null, 2);
}

/**
 * Export material to VMT (Valve Material Type) format for Source engine compatibility
 */
export function exportMaterialToVMT(material: ParsedMaterial): string {
  let vmt = `// Material: ${material.name}\n`;
  vmt += `// Exported from RSX Electron\n\n`;
  
  // Determine shader type
  let shaderType = 'VertexLitGeneric';
  switch (material.materialType) {
    case MaterialType.UNLIT:
    case MaterialType.UNLITTS:
      shaderType = 'UnlitGeneric';
      break;
    case MaterialType.SKIN:
      shaderType = 'Skin_DX9';
      break;
    case MaterialType.WORLD:
      shaderType = 'WorldVertexTransition';
      break;
    case MaterialType.SKY:
      shaderType = 'Sky';
      break;
    case MaterialType.WATER:
      shaderType = 'Water';
      break;
  }
  
  vmt += `"${shaderType}"\n{\n`;
  
  // Add texture references
  for (const tex of material.textures) {
    let paramName = '$basetexture';
    switch (tex.slot) {
      case TextureSlot.DIFFUSE:
        paramName = '$basetexture';
        break;
      case TextureSlot.NORMAL:
        paramName = '$bumpmap';
        break;
      case TextureSlot.SPECULAR:
        paramName = '$envmapmask';
        break;
      case TextureSlot.EMISSION:
        paramName = '$selfillummask';
        break;
      case TextureSlot.DETAIL:
        paramName = '$detail';
        break;
      default:
        paramName = `$texture_${tex.slot}`;
    }
    
    vmt += `\t"${paramName}" "${tex.textureGuid}"\n`;
  }
  
  // Add common parameters
  vmt += `\n\t// Surface: ${material.surfaceName}\n`;
  
  if (material.materialType === MaterialType.UNLITTS) {
    vmt += `\t"$nocull" "1"\n`;
  }
  
  vmt += `}\n`;
  
  return vmt;
}
