/**
 * Asset type definitions
 * Ported from the C++ RSX implementation
 */

// Asset type enum - uses FourCC codes
export const AssetType = {
  // Titanfall/Apex
  TEXTURE: fourCC('txtr'),
  SHADER: fourCC('shdr'),
  SHADER_SET: fourCC('shds'),
  MATERIAL: fourCC('matl'),
  RIG: fourCC('arig'),
  ANIM_SEQ: fourCC('aseq'),
  UIMG: fourCC('uimg'),
  PATCH_MASTER: fourCC('Ptch'),
  STLT: fourCC('stlt'),
  STGS: fourCC('stgs'),
  RSON: fourCC('rson'),
  RPAK: fourCC('rpak'),
  DATA_TABLE: fourCC('dtbl'),
  PARTICLE_SCRIPT: fourCC('pcsc'),
  EFFECT: fourCC('efct'),
  WRAP: fourCC('wrap'),
  UI_ATLAS: fourCC('uia_'),
  UI_FONT: fourCC('uifd'),
  ASR: fourCC('asr_'),
  MODEL: fourCC('mdl_'),
  MAP: fourCC('rmap'),
  SETTINGS_LAYOUT: fourCC('stlt'),
  SETTINGS: fourCC('stgs'),
  ANIM_REC: fourCC('anir'),
  SOURCE_FILE: fourCC('asrc'),
  COLLISION_MODEL: fourCC('pcmd'),
  
  // BluepointRTech
  BP_PAK: fourCC('bpak'),
  
  // Generic
  UNKNOWN: 0,
} as const;

// Helper function to create FourCC from string
function fourCC(str: string): number {
  return str.charCodeAt(0) |
         (str.charCodeAt(1) << 8) |
         (str.charCodeAt(2) << 16) |
         (str.charCodeAt(3) << 24);
}

// Reverse FourCC to string
export function fourCCToString(value: number): string {
  return String.fromCharCode(
    value & 0xFF,
    (value >> 8) & 0xFF,
    (value >> 16) & 0xFF,
    (value >> 24) & 0xFF
  );
}

// Asset type colors for UI
export const AssetTypeColors: Record<number, [number, number, number]> = {
  [AssetType.TEXTURE]:        [255, 170, 0],    // Orange
  [AssetType.SHADER]:         [0, 190, 140],    // Teal
  [AssetType.SHADER_SET]:     [0, 190, 140],    // Teal
  [AssetType.MATERIAL]:       [200, 180, 0],    // Yellow
  [AssetType.RIG]:            [100, 130, 230],  // Blue
  [AssetType.ANIM_SEQ]:       [80, 200, 120],   // Green
  [AssetType.UIMG]:           [75, 0, 130],     // Indigo
  [AssetType.PATCH_MASTER]:   [220, 20, 60],    // Crimson
  [AssetType.STLT]:           [125, 100, 200],  // Purple
  [AssetType.STGS]:           [125, 100, 200],  // Purple
  [AssetType.RSON]:           [139, 90, 43],    // Brown
  [AssetType.RPAK]:           [255, 20, 147],   // Deep Pink
  [AssetType.DATA_TABLE]:     [135, 206, 235],  // Sky Blue
  [AssetType.PARTICLE_SCRIPT]:[80, 200, 120],   // Green
  [AssetType.EFFECT]:         [255, 165, 0],    // Orange
  [AssetType.WRAP]:           [255, 192, 203],  // Pink
  [AssetType.UI_ATLAS]:       [0, 128, 128],    // Teal
  [AssetType.UI_FONT]:        [0, 128, 128],    // Teal
  [AssetType.ASR]:            [255, 255, 224],  // Light Yellow
  [AssetType.MODEL]:          [0, 191, 255],    // Deep Sky Blue
  [AssetType.MAP]:            [144, 238, 144],  // Light Green
  [AssetType.ANIM_REC]:       [80, 200, 120],   // Green
  [AssetType.SOURCE_FILE]:    [192, 192, 192],  // Silver
  [AssetType.COLLISION_MODEL]:[255, 105, 180],  // Hot Pink
  [AssetType.BP_PAK]:         [255, 20, 147],   // Deep Pink
  [AssetType.UNKNOWN]:        [128, 128, 128],  // Gray
};

// Asset type extensions
export const AssetTypeExtensions: Record<number, string> = {
  [AssetType.TEXTURE]:        '.dds',
  [AssetType.SHADER]:         '.shdr',
  [AssetType.SHADER_SET]:     '.shds',
  [AssetType.MATERIAL]:       '.matl',
  [AssetType.RIG]:            '.rrig',
  [AssetType.ANIM_SEQ]:       '.rseq',
  [AssetType.UIMG]:           '.uimg',
  [AssetType.PATCH_MASTER]:   '.Ptch',
  [AssetType.STLT]:           '.stlt',
  [AssetType.STGS]:           '.stgs',
  [AssetType.RSON]:           '.rson',
  [AssetType.RPAK]:           '.rpak',
  [AssetType.DATA_TABLE]:     '.csv',
  [AssetType.PARTICLE_SCRIPT]:'.vpcf',
  [AssetType.EFFECT]:         '.efct',
  [AssetType.WRAP]:           '.wrap',
  [AssetType.UI_ATLAS]:       '.uia',
  [AssetType.UI_FONT]:        '.uifd',
  [AssetType.ASR]:            '.asr',
  [AssetType.MODEL]:          '.mdl',
  [AssetType.MAP]:            '.rmap',
  [AssetType.ANIM_REC]:       '.anir',
  [AssetType.SOURCE_FILE]:    '.asrc',
  [AssetType.COLLISION_MODEL]:'.rpcm',
  [AssetType.BP_PAK]:         '.bpak',
  [AssetType.UNKNOWN]:        '.bin',
};

// Asset type display names
export const AssetTypeNames: Record<number, string> = {
  [AssetType.TEXTURE]:        'Texture',
  [AssetType.SHADER]:         'Shader',
  [AssetType.SHADER_SET]:     'Shader Set',
  [AssetType.MATERIAL]:       'Material',
  [AssetType.RIG]:            'Anim Rig',
  [AssetType.ANIM_SEQ]:       'Anim Sequence',
  [AssetType.UIMG]:           'UI Image',
  [AssetType.PATCH_MASTER]:   'Patch Master',
  [AssetType.STLT]:           'Settings Layout',
  [AssetType.STGS]:           'Settings',
  [AssetType.RSON]:           'RSON',
  [AssetType.RPAK]:           'RPak',
  [AssetType.DATA_TABLE]:     'Data Table',
  [AssetType.PARTICLE_SCRIPT]:'Particle Script',
  [AssetType.EFFECT]:         'Effect',
  [AssetType.WRAP]:           'Wrap',
  [AssetType.UI_ATLAS]:       'UI Atlas',
  [AssetType.UI_FONT]:        'UI Font',
  [AssetType.ASR]:            'ASR',
  [AssetType.MODEL]:          'Model',
  [AssetType.MAP]:            'Map',
  [AssetType.ANIM_REC]:       'Anim Recording',
  [AssetType.SOURCE_FILE]:    'Source File',
  [AssetType.COLLISION_MODEL]:'Collision Model',
  [AssetType.BP_PAK]:         'Bluepoint Pak',
  [AssetType.UNKNOWN]:        'Unknown',
};

// Get asset type color as hex string
export function getAssetTypeColorHex(type: number): string {
  const color = AssetTypeColors[type] || AssetTypeColors[AssetType.UNKNOWN];
  return `#${color.map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

// Get asset type name
export function getAssetTypeName(type: number): string {
  return AssetTypeNames[type] || fourCCToString(type);
}

// Get asset type extension
export function getAssetTypeExtension(type: number): string {
  return AssetTypeExtensions[type] || '.bin';
}

// Check if asset type is known
export function isKnownAssetType(type: number): boolean {
  return type in AssetTypeNames;
}

// List all asset types
export function getAllAssetTypes(): Array<{ type: number; name: string; fourCC: string }> {
  return Object.entries(AssetType).map(([name, type]) => ({
    type: type as number,
    name,
    fourCC: fourCCToString(type as number),
  }));
}
