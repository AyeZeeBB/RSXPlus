import { AssetType, AssetCategory, ASSET_TYPE_CATEGORIES } from '../types/asset';

// Get category for an asset type
export function getAssetCategory(type: AssetType): AssetCategory {
  return ASSET_TYPE_CATEGORIES[type] || 'data';
}

// Get badge class for asset type
export function getAssetTypeBadgeClass(type: AssetType): string {
  const category = getAssetCategory(type);
  return `badge-${category}`;
}

// Get color for asset type (matching C++ colors)
export function getAssetTypeColor(type: AssetType): string {
  const colors: Partial<Record<AssetType, string>> = {
    // Model (reds)
    'mdl_': '#f03c32',
    'arig': '#dc4b0a',
    'aseq': '#dc4b6d',
    'asqd': '#c85a96',
    'anir': '#c86482',
    'mdl': '#f03c32',
    'seq': '#dc4b6d',
    // Texture (greens)
    'txtr': '#22c55e',
    'txan': '#16a34a',
    'txls': '#15803d',
    'uimg': '#10b981',
    'uiia': '#059669',
    // Material (blues)
    'matl': '#3b82f6',
    'msnp': '#2563eb',
    // Audio (oranges)
    'asrc': '#f59e0b',
    'aevt': '#d97706',
    // Shader (purples)
    'shdr': '#8b5cf6',
    'shds': '#7c3aed',
    // UI (cyans)
    'ui': '#06b6d4',
    'hsys': '#0891b2',
    'rlcd': '#0e7490',
    'rtk': '#155e75',
    // Map (pinks)
    'rmap': '#ec4899',
    'llyr': '#db2777',
    // Data (grays)
    'dtbl': '#64748b',
    'stgs': '#64748b',
    'rson': '#64748b',
  };

  return colors[type] || '#64748b';
}

// Format file size
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// Format GUID for display
export function formatGUID(guid: string): string {
  if (guid.length <= 16) return guid;
  return `${guid.slice(0, 8)}...${guid.slice(-4)}`;
}

// Get file extension
export function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

// Determine container type from file extension
export function getContainerType(filename: string): 'pak' | 'audio' | 'mdl' | 'bp_pak' | 'bsp' {
  const ext = getFileExtension(filename);
  
  switch (ext) {
    case 'rpak':
    case 'starpak':
      return 'pak';
    case 'mbnk':
      return 'audio';
    case 'mdl':
      return 'mdl';
    case 'bpk':
      return 'bp_pak';
    case 'bsp':
      return 'bsp';
    default:
      return 'pak';
  }
}

// Generate a unique ID
export function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}
