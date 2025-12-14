// Asset types matching the C++ AssetType_t enum
export type AssetType = 
  // Model
  | 'mdl_' | 'arig' | 'aseq' | 'asqd' | 'anir' | 'mdl' | 'seq'
  // Texture/Material
  | 'matl' | 'msnp' | 'mt4a' | 'txtr' | 'txan' | 'txls' | 'txtx' | 'uimg' | 'uiia' | 'font'
  // Particle
  | 'efct' | 'rpsk'
  // Shader
  | 'shdr' | 'shds'
  // UI
  | 'ui' | 'hsys' | 'rlcd' | 'rtk'
  // Pak
  | 'ptch' | 'vers'
  // Data
  | 'dtbl' | 'stgs' | 'stlt' | 'rson' | 'subt' | 'locl'
  // VPK
  | 'wrap' | 'wepn' | 'impa'
  // Map
  | 'rmap' | 'llyr'
  // Audio
  | 'asrc' | 'aevt'
  // Bluepoint
  | 'bpwf'
  // Unknown
  | 'unknown'
  | string;

// Convert FourCC number to string
export function fourCCToString(value: number): string {
  return String.fromCharCode(
    value & 0xFF,
    (value >> 8) & 0xFF,
    (value >> 16) & 0xFF,
    (value >> 24) & 0xFF
  );
}

// Convert string to FourCC number
export function stringToFourCC(str: string): number {
  if (str.length !== 4) {
    throw new Error('FourCC must be 4 characters');
  }
  return str.charCodeAt(0) |
         (str.charCodeAt(1) << 8) |
         (str.charCodeAt(2) << 16) |
         (str.charCodeAt(3) << 24);
}

export type AssetCategory = 
  | 'model' 
  | 'texture' 
  | 'material' 
  | 'audio' 
  | 'animation' 
  | 'shader' 
  | 'ui' 
  | 'map' 
  | 'data';

export interface AssetDependency {
  guid: string;
  type: AssetType;
  name?: string;
  status: 'loaded' | 'missing' | 'external';
}

// Extended metadata types for specific asset types
export interface TextureMetadata {
  width?: number;
  height?: number;
  depth?: number;
  format?: number;
  mipCount?: number;
  arraySize?: number;
  streamedMipCount?: number;
  pixelData?: ArrayBuffer;
  textureHeader?: {
    width: number;
    height: number;
    depth: number;
    format: number;
    mipCount: number;
    arraySize: number;
    streamedMipCount: number;
  };
}

export interface ModelMetadata {
  parsedModel?: import('../parsers/modelParser').ParsedModel;
}

export interface MaterialMetadata {
  parsedMaterial?: import('../parsers/materialParser').ParsedMaterialData | null;
}

export type AssetMetadata = TextureMetadata & ModelMetadata & MaterialMetadata & Record<string, unknown>;

export interface Asset {
  guid: string;
  name: string;
  type: AssetType;
  version?: number; // Asset version (8, 9, 10, etc.)
  containerFile: string;
  containerType: 'pak' | 'audio' | 'mdl' | 'bp_pak' | 'bsp';
  offset?: number;
  size?: number;
  dependencies?: AssetDependency[];
  metadata?: AssetMetadata;
  // Raw asset data for export
  rawData?: ArrayBuffer;
  // Preview data
  previewData?: ArrayBuffer;
  thumbnailUrl?: string;
}

export interface LoadedFile {
  path: string;
  name: string;
  type: string;
  size: number;
  assets: Asset[];
  loadedAt: Date;
}

// Asset type categories for filtering and display
export const ASSET_TYPE_CATEGORIES: Record<AssetType, AssetCategory> = {
  // Model
  'mdl_': 'model',
  'arig': 'animation',
  'aseq': 'animation',
  'asqd': 'animation',
  'anir': 'animation',
  'mdl': 'model',
  'seq': 'animation',
  // Texture/Material
  'matl': 'material',
  'msnp': 'material',
  'mt4a': 'texture',
  'txtr': 'texture',
  'txan': 'texture',
  'txls': 'texture',
  'txtx': 'texture',
  'uimg': 'texture',
  'uiia': 'texture',
  'font': 'ui',
  // Particle
  'efct': 'texture',
  'rpsk': 'data',
  // Shader
  'shdr': 'shader',
  'shds': 'shader',
  // UI
  'ui': 'ui',
  'hsys': 'ui',
  'rlcd': 'ui',
  'rtk': 'ui',
  // Pak
  'ptch': 'data',
  'vers': 'data',
  // Data
  'dtbl': 'data',
  'stgs': 'data',
  'stlt': 'data',
  'rson': 'data',
  'subt': 'data',
  'locl': 'data',
  // VPK
  'wrap': 'data',
  'wepn': 'data',
  'impa': 'data',
  // Map
  'rmap': 'map',
  'llyr': 'map',
  // Audio
  'asrc': 'audio',
  'aevt': 'audio',
  // Bluepoint
  'bpwf': 'data',
  // Unknown
  'unknown': 'data',
};

// FourCC helper
export function makeFourCC(a: string, b: string, c: string, d: string): number {
  return (
    (a.charCodeAt(0)) |
    (b.charCodeAt(0) << 8) |
    (c.charCodeAt(0) << 16) |
    (d.charCodeAt(0) << 24)
  );
}
