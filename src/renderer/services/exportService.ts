/**
 * RSX Export Service
 * Handles exporting assets in various formats matching the C++ RSX functionality
 */

import { Asset, AssetType, TextureMetadata, MaterialMetadata, ModelMetadata } from '../types/asset';
import { Settings } from '../stores/settingsStore';
import { 
  TextureFormat, 
  TextureFormatNames, 
  isBlockCompressed, 
  BytesPerPixel,
  createDDSHeader,
  decodeTextureToRGBA,
  calculateMipSize,
  parseTextureHeader,
  TextureAssetHeader
} from '../parsers/textureParser';
import { exportModelToOBJ, exportModelToGLTF, parseStudioHeader, ParsedModel } from '../parsers/modelParser';
import { parseMaterialHeader, ParsedMaterial, ParsedMaterialData, MaterialTextureEntry } from '../parsers/materialParser';

// Export format definitions matching C++ RSX
export interface ExportFormat {
  id: string;
  name: string;
  extension: string;
  description: string;
}

// Texture export formats (eTextureExportSetting)
export const TEXTURE_EXPORT_FORMATS: ExportFormat[] = [
  { id: 'png_highest', name: 'PNG (Highest Mip)', extension: '.png', description: 'Export highest resolution mip as PNG' },
  { id: 'png_all', name: 'PNG (All Mips)', extension: '.png', description: 'Export all mip levels as separate PNGs' },
  { id: 'dds_highest', name: 'DDS (Highest Mip)', extension: '.dds', description: 'Export highest resolution mip as DDS' },
  { id: 'dds_all', name: 'DDS (All Mips)', extension: '.dds', description: 'Export all mip levels as separate DDS files' },
  { id: 'dds_mipmapped', name: 'DDS (Mip Mapped)', extension: '.dds', description: 'Export as single DDS with all mip levels' },
  { id: 'json_meta', name: 'JSON (Meta Data)', extension: '.json', description: 'Export texture metadata as JSON' },
];

// Model export formats (eModelExportSetting)
export const MODEL_EXPORT_FORMATS: ExportFormat[] = [
  { id: 'obj', name: 'OBJ', extension: '.obj', description: 'Export as Wavefront OBJ format' },
  { id: 'gltf', name: 'GLTF', extension: '.gltf', description: 'Export as GLTF format' },
  { id: 'smd', name: 'SMD', extension: '.smd', description: 'Export as Source Model format' },
  { id: 'cast', name: 'Cast', extension: '.cast', description: 'Export as Cast format' },
  { id: 'json_meta', name: 'JSON (Meta Data)', extension: '.json', description: 'Export model metadata as JSON' },
];

// Material export formats (eMaterialExportSetting)
export const MATERIAL_EXPORT_FORMATS: ExportFormat[] = [
  { id: 'json', name: 'JSON', extension: '.json', description: 'Export material data as JSON' },
  { id: 'vmt', name: 'VMT', extension: '.vmt', description: 'Export as Valve Material format' },
];

// Animation Sequence export formats (eAnimSeqExportSetting)
export const ANIMSEQ_EXPORT_FORMATS: ExportFormat[] = [
  { id: 'json', name: 'JSON', extension: '.json', description: 'Export animation metadata as JSON' },
  { id: 'smd', name: 'SMD', extension: '.smd', description: 'Export as Source Model animation' },
];

// Animation Rig export formats (eAnimRigExportSetting)
export const ANIMRIG_EXPORT_FORMATS: ExportFormat[] = [
  { id: 'json', name: 'JSON', extension: '.json', description: 'Export rig metadata as JSON' },
  { id: 'smd', name: 'SMD', extension: '.smd', description: 'Export as Source Model skeleton' },
];

// Shader export formats
export const SHADER_EXPORT_FORMATS: ExportFormat[] = [
  { id: 'json', name: 'JSON', extension: '.json', description: 'Export shader metadata as JSON' },
  { id: 'raw', name: 'Raw Binary', extension: '.shdr', description: 'Export raw shader data' },
];

// ShaderSet export formats
export const SHADERSET_EXPORT_FORMATS: ExportFormat[] = [
  { id: 'json', name: 'JSON', extension: '.json', description: 'Export shader set as JSON' },
];

// UI Image Atlas export formats
export const UIIMAGE_EXPORT_FORMATS: ExportFormat[] = [
  { id: 'png', name: 'PNG', extension: '.png', description: 'Export UI image as PNG' },
  { id: 'json', name: 'JSON', extension: '.json', description: 'Export UI atlas metadata as JSON' },
];

// Datatable export formats
export const DATATABLE_EXPORT_FORMATS: ExportFormat[] = [
  { id: 'csv', name: 'CSV', extension: '.csv', description: 'Export as CSV spreadsheet' },
  { id: 'json', name: 'JSON', extension: '.json', description: 'Export as JSON' },
];

// Subtitles export formats
export const SUBTITLES_EXPORT_FORMATS: ExportFormat[] = [
  { id: 'txt', name: 'TXT', extension: '.txt', description: 'Export as plain text' },
  { id: 'csv', name: 'CSV', extension: '.csv', description: 'Export as CSV' },
  { id: 'json', name: 'JSON', extension: '.json', description: 'Export as JSON' },
];

// Generic single-format exports
export const SINGLE_FORMAT_EXPORTS: Record<string, ExportFormat> = {
  locl: { id: 'json', name: 'JSON', extension: '.json', description: 'Export localisation as JSON' },
  rson: { id: 'json', name: 'JSON', extension: '.json', description: 'Export RSON as JSON' },
  stgs: { id: 'json', name: 'JSON', extension: '.json', description: 'Export settings as JSON' },
  stlt: { id: 'json', name: 'JSON', extension: '.json', description: 'Export settings layout as JSON' },
  wrap: { id: 'raw', name: 'Raw', extension: '.bin', description: 'Export raw wrapped data' },
  Ptch: { id: 'json', name: 'JSON', extension: '.json', description: 'Export patch data as JSON' },
};

// Get export formats for an asset type
export function getExportFormats(assetType: AssetType): ExportFormat[] {
  switch (assetType) {
    case 'txtr':
      return TEXTURE_EXPORT_FORMATS;
    case 'mdl_':
    case 'rmdl':
      return MODEL_EXPORT_FORMATS;
    case 'matl':
      return MATERIAL_EXPORT_FORMATS;
    case 'aseq':
      return ANIMSEQ_EXPORT_FORMATS;
    case 'arig':
      return ANIMRIG_EXPORT_FORMATS;
    case 'shdr':
      return SHADER_EXPORT_FORMATS;
    case 'shds':
      return SHADERSET_EXPORT_FORMATS;
    case 'uimg':
    case 'uiia':
      return UIIMAGE_EXPORT_FORMATS;
    case 'dtbl':
      return DATATABLE_EXPORT_FORMATS;
    case 'subt':
      return SUBTITLES_EXPORT_FORMATS;
    case 'locl':
    case 'rson':
    case 'stgs':
    case 'stlt':
    case 'wrap':
    case 'Ptch':
      return [SINGLE_FORMAT_EXPORTS[assetType] || { id: 'raw', name: 'Raw', extension: '.bin', description: 'Export raw data' }];
    default:
      // Default to raw export for unknown types
      return [{ id: 'raw', name: 'Raw', extension: '.bin', description: 'Export raw data' }];
  }
}

// Check if an asset type supports export
export function canExport(assetType: AssetType): boolean {
  return true; // All types can be exported in some form
}

// Export result
export interface ExportResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  filesExported?: number;
}

// Export progress callback
export type ExportProgressCallback = (current: number, total: number, message: string) => void;

// Texture data loader function type
export type TextureDataLoader = (asset: Asset) => Promise<{
  header: TextureAssetHeader;
  pixelData: Uint8Array;
  starpakOffset: bigint;
  optStarpakOffset: bigint;
  rpakPath: string;
} | null>;

// Main export function
export async function exportAsset(
  asset: Asset,
  format: ExportFormat,
  outputDir: string,
  settings: Settings,
  onProgress?: ExportProgressCallback,
  allAssets?: Asset[],  // Optional: all loaded assets for dependency resolution
  getTextureData?: TextureDataLoader  // Optional: function to load texture data
): Promise<ExportResult> {
  try {
    // Determine the output path
    let outputPath = outputDir;
    
    // Use full paths if setting enabled
    if (settings.exportPathsFull && asset.name) {
      const assetPath = asset.name.replace(/\\/g, '/');
      const parentDir = assetPath.substring(0, assetPath.lastIndexOf('/'));
      if (parentDir) {
        outputPath = `${outputDir}/${parentDir}`;
      }
    }

    // Ensure output directory exists
    const dirResult = await window.electron.createDir(outputPath);
    if (!dirResult.success) {
      return { success: false, error: `Failed to create output directory: ${dirResult.error}` };
    }

    // Get asset filename
    const assetName = getAssetFileName(asset);
    const fullOutputPath = `${outputPath}/${assetName}${format.extension}`;

    onProgress?.(0, 1, `Exporting ${assetName}...`);

    // Route to appropriate exporter based on asset type
    let result: ExportResult;
    switch (asset.type) {
      case 'txtr':
        result = await exportTexture(asset, format, outputPath, assetName, settings, onProgress, getTextureData);
        break;
      case 'mdl_':
      case 'rmdl':
        result = await exportModel(asset, format, fullOutputPath, settings, onProgress);
        break;
      case 'matl':
        result = await exportMaterial(asset, format, fullOutputPath, settings, onProgress);
        // Export texture dependencies if enabled
        if (result.success && settings.exportAssetDeps && allAssets && getTextureData) {
          await exportMaterialDependencies(asset, outputDir, settings, allAssets, onProgress, getTextureData);
        }
        break;
      case 'aseq':
        result = await exportAnimSeq(asset, format, fullOutputPath, settings, onProgress);
        break;
      case 'arig':
        result = await exportAnimRig(asset, format, fullOutputPath, settings, onProgress);
        break;
      case 'shdr':
        result = await exportShader(asset, format, fullOutputPath, settings, onProgress);
        break;
      case 'shds':
        result = await exportShaderSet(asset, format, fullOutputPath, settings, onProgress);
        break;
      case 'uimg':
      case 'uiia':
        result = await exportUIImage(asset, format, fullOutputPath, settings, onProgress);
        break;
      case 'dtbl':
        result = await exportDatatable(asset, format, fullOutputPath, settings, onProgress);
        break;
      case 'subt':
        result = await exportSubtitles(asset, format, fullOutputPath, settings, onProgress);
        break;
      default:
        result = await exportRaw(asset, format, fullOutputPath, settings, onProgress);
    }
    return result;
  } catch (error) {
    return { success: false, error: `Export failed: ${error}` };
  }
}

// Export multiple assets
export async function exportAssets(
  assets: Asset[],
  outputDir: string,
  settings: Settings,
  onProgress?: ExportProgressCallback,
  allAssets?: Asset[],  // Optional: all loaded assets for dependency resolution
  getTextureData?: TextureDataLoader  // Optional: function to load texture data
): Promise<ExportResult[]> {
  const results: ExportResult[] = [];
  
  // Use allAssets for dependency resolution, or fall back to the assets being exported
  const assetsForDeps = allAssets || assets;
  
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    const formats = getExportFormats(asset.type);
    
    if (formats.length === 0) {
      results.push({ success: false, error: `No export format available for ${asset.type}` });
      continue;
    }

    // Use the default/first format
    const format = formats[0];
    
    onProgress?.(i, assets.length, `Exporting ${getAssetFileName(asset)}...`);
    
    const result = await exportAsset(asset, format, outputDir, settings, onProgress, assetsForDeps, getTextureData);
    results.push(result);
  }

  return results;
}

// Helper to get asset filename
function getAssetFileName(asset: Asset): string {
  if (asset.name) {
    const parts = asset.name.replace(/\\/g, '/').split('/');
    let name = parts[parts.length - 1];
    // Remove common extensions
    if (name.endsWith('.rpak')) name = name.slice(0, -5);
    // Remove leading path separators
    return name.replace(/^[/\\]+/, '');
  }
  return asset.guid;
}

// Helper to write a file
async function writeFile(path: string, data: Uint8Array): Promise<ExportResult> {
  const result = await window.electron.writeFile(path, data);
  if (result.success) {
    return { success: true, outputPath: path, filesExported: 1 };
  }
  return { success: false, error: result.error };
}

// Helper to convert string to Uint8Array (browser-compatible)
function stringToUint8Array(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

// Helper to write JSON
async function writeJSON(path: string, data: object): Promise<ExportResult> {
  const json = JSON.stringify(data, (key, value) => {
    // Convert BigInt to string
    if (typeof value === 'bigint') {
      return `0x${value.toString(16).toUpperCase()}`;
    }
    return value;
  }, 2);
  return writeFile(path, stringToUint8Array(json));
}

// ==========================================
// TEXTURE EXPORT
// ==========================================

async function exportTexture(
  asset: Asset,
  format: ExportFormat,
  outputDir: string,
  assetName: string,
  settings: Settings,
  onProgress?: ExportProgressCallback,
  getTextureData?: TextureDataLoader
): Promise<ExportResult> {
  const texMeta = asset.metadata as TextureMetadata | undefined;
  
  // Try to load texture data using the provided loader (includes starpak support)
  let loadedData: { header: TextureAssetHeader; pixelData: Uint8Array } | null = null;
  if (getTextureData) {
    const result = await getTextureData(asset);
    if (result) {
      loadedData = { header: result.header, pixelData: result.pixelData };
    }
  }
  
  // Parse texture header from loaded data, metadata, or raw data
  const texHeader: Partial<TextureAssetHeader> | null = loadedData?.header || texMeta?.textureHeader || (asset.rawData ? parseTextureHeader({
    headerData: new Uint8Array(asset.rawData),
    version: asset.version || 8,
  } as any) : null);

  // For JSON metadata export - match C++ ExportTextureMetaData format exactly
  if (format.id === 'json_meta') {
    // Build JSON matching C++ format:
    // { "streamLayout": [...], "mipInfo": [...], "resourceFlags": "0x...", "usageFlags": "0x..." }
    let json = '{\n';
    const parts: string[] = [];
    
    // streamLayout array (if multiple mips)
    const mipCount = texHeader?.mipCount || 1;
    const streamedMipCount = texHeader?.streamedMipCount || 0;
    
    if (mipCount > 1 && streamedMipCount > 0) {
      let streamLayout = '\t"streamLayout": [\n';
      const mipTypes: string[] = [];
      for (let i = 0; i < streamedMipCount; i++) {
        mipTypes.push(`\t\t"streaming"`);
      }
      streamLayout += mipTypes.join(',\n') + '\n';
      streamLayout += '\t]';
      parts.push(streamLayout);
    }
    
    // resourceFlags and usageFlags
    const layerCount = texHeader?.arraySize || 1;
    const usageFlags = texHeader?.format || 0;
    parts.push(`\t"resourceFlags": "0x${layerCount.toString(16).toUpperCase()}"`);
    parts.push(`\t"usageFlags": "0x${usageFlags.toString(16).toUpperCase()}"`);
    
    json += parts.join(',\n') + '\n';
    json += '}\n';
    
    const jsonPath = `${outputDir}/${assetName}.json`;
    return writeFile(jsonPath, stringToUint8Array(json));
  }

  // Get pixel data - prioritize loaded data from getTextureData (includes starpak)
  let pixelData: Uint8Array | undefined;
  
  // First try loaded data (from getTextureData, includes starpak support)
  if (loadedData?.pixelData && loadedData.pixelData.length > 0) {
    pixelData = loadedData.pixelData;
    console.log(`[ExportService] Using loaded pixel data for ${assetName}: ${pixelData.length} bytes`);
  }
  // Then check metadata
  else if (texMeta?.pixelData) {
    pixelData = new Uint8Array(texMeta.pixelData);
  } 
  // Finally try raw data
  else if (asset.rawData) {
    // Raw data may contain pixel data after header
    const headerSize = 56; // Standard texture header size
    if (asset.rawData.byteLength > headerSize) {
      pixelData = new Uint8Array(asset.rawData.slice(headerSize));
    }
  }

  if (!pixelData || pixelData.length === 0) {
    // No pixel data available - can't export image formats
    console.warn(`[ExportService] No pixel data available for texture: ${assetName}`);
    // Export minimal JSON metadata matching C++ format
    let json = '{\n';
    const layerCount = texHeader?.arraySize || 1;
    const usageFlags = texHeader?.format || 0;
    json += `\t"resourceFlags": "0x${layerCount.toString(16).toUpperCase()}",\n`;
    json += `\t"usageFlags": "0x${usageFlags.toString(16).toUpperCase()}"\n`;
    json += '}\n';
    return writeFile(`${outputDir}/${assetName}.json`, stringToUint8Array(json));
  }

  const width = texHeader?.width || 256;
  const height = texHeader?.height || 256;
  const texFormat = texHeader?.format || TextureFormat.BC1_UNORM;
  const mipCountVal = texHeader?.mipCount || 1;

  // DDS export
  if (format.id.startsWith('dds')) {
    const ddsHeader = createDDSHeader(width, height, texFormat, mipCountVal, texHeader?.depth || 1);
    const ddsData = new Uint8Array(ddsHeader.length + pixelData.length);
    ddsData.set(ddsHeader, 0);
    ddsData.set(pixelData, ddsHeader.length);
    
    const ddsPath = `${outputDir}/${assetName}.dds`;
    return writeFile(ddsPath, ddsData);
  }

  // PNG export - decode to RGBA first
  if (format.id.startsWith('png')) {
    try {
      const rgbaData = decodeTextureToRGBA(pixelData, width, height, texFormat);
      
      // Create PNG using canvas
      const pngData = await createPNG(rgbaData, width, height);
      if (!pngData) {
        return { success: false, error: 'Failed to create PNG' };
      }
      
      const pngPath = `${outputDir}/${assetName}.png`;
      return writeFile(pngPath, pngData);
    } catch (err) {
      return { success: false, error: `PNG encoding failed: ${err}` };
    }
  }

  return { success: false, error: `Unsupported texture export format: ${format.id}` };
}

// Helper to create PNG from RGBA data
async function createPNG(rgba: Uint8Array, width: number, height: number): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      
      const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
      ctx.putImageData(imageData, 0, 0);
      
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        blob.arrayBuffer().then((buffer) => {
          resolve(new Uint8Array(buffer));
        }).catch(() => resolve(null));
      }, 'image/png');
    } catch {
      resolve(null);
    }
  });
}

// ==========================================
// MODEL EXPORT
// ==========================================

async function exportModel(
  asset: Asset,
  format: ExportFormat,
  outputPath: string,
  settings: Settings,
  onProgress?: ExportProgressCallback
): Promise<ExportResult> {
  const modelMeta = asset.metadata as ModelMetadata | undefined;
  
  // Parse model if we have raw data
  let model: ParsedModel | null = modelMeta?.parsedModel || null;
  
  if (!model && asset.rawData) {
    model = parseStudioHeader(new Uint8Array(asset.rawData), asset.version || 9);
  }

  // JSON metadata export
  if (format.id === 'json_meta' || format.id === 'json') {
    const metadata: Record<string, any> = {
      guid: asset.guid,
      name: asset.name,
      type: asset.type,
      version: asset.version,
    };
    
    if (model) {
      metadata.modelName = model.name;
      metadata.meshCount = model.meshCount;
      metadata.lodCount = model.lodCount;
      metadata.boneCount = model.boneCount;
      metadata.materialCount = model.materialCount;
      metadata.bodyPartCount = model.bodyPartCount;
      metadata.hullMin = model.hullMin;
      metadata.hullMax = model.hullMax;
      metadata.eyePosition = model.eyePosition;
      metadata.mass = model.mass;
      metadata.flags = model.flags;
      metadata.isStreamed = model.isStreamed;
      metadata.materialGUIDs = model.materialGUIDs?.map(g => `0x${g.toString(16).toUpperCase()}`);
      metadata.bodyParts = model.bodyParts;
      metadata.skinFamilies = model.skinFamilies;
    } else {
      metadata.note = 'Model data not fully parsed';
    }
    
    return writeJSON(outputPath, metadata);
  }

  // OBJ export
  if (format.id === 'obj') {
    if (!model) {
      return { success: false, error: 'Model data not available for OBJ export' };
    }
    
    const objContent = exportModelToOBJ(model);
    return writeFile(outputPath, stringToUint8Array(objContent));
  }

  // GLTF export
  if (format.id === 'gltf') {
    if (!model) {
      return { success: false, error: 'Model data not available for GLTF export' };
    }
    
    const gltfContent = exportModelToGLTF(model);
    return writeJSON(outputPath, gltfContent);
  }

  // SMD export
  if (format.id === 'smd') {
    if (!model) {
      return { success: false, error: 'Model data not available for SMD export' };
    }
    
    const smdContent = exportModelToSMD(model);
    return writeFile(outputPath, stringToUint8Array(smdContent));
  }

  // Cast export
  if (format.id === 'cast') {
    if (!model) {
      return { success: false, error: 'Model data not available for Cast export' };
    }
    
    const castData = exportModelToCast(model);
    return writeFile(outputPath, castData);
  }

  return { success: false, error: `Unsupported model export format: ${format.id}` };
}

// Export model to SMD format
function exportModelToSMD(model: ParsedModel): string {
  let smd = `version 1\n`;
  smd += `// Generated by RSX Electron\n`;
  smd += `// Model: ${model.name}\n\n`;
  
  // Nodes (skeleton)
  smd += `nodes\n`;
  if (model.skeleton?.bones) {
    for (let i = 0; i < model.skeleton.bones.length; i++) {
      const bone = model.skeleton.bones[i];
      smd += `  ${i} "${bone.name}" ${bone.parentIndex}\n`;
    }
  } else {
    smd += `  0 "root" -1\n`;
  }
  smd += `end\n\n`;
  
  // Skeleton (reference pose)
  smd += `skeleton\n`;
  smd += `time 0\n`;
  if (model.skeleton?.bones) {
    for (let i = 0; i < model.skeleton.bones.length; i++) {
      const bone = model.skeleton.bones[i];
      const pos = bone.position || [0, 0, 0];
      const rot = bone.rotation || [0, 0, 0, 1];
      // Convert quaternion to euler angles
      const euler = quaternionToEuler(rot);
      smd += `  ${i} ${pos[0]} ${pos[1]} ${pos[2]} ${euler[0]} ${euler[1]} ${euler[2]}\n`;
    }
  } else {
    smd += `  0 0 0 0 0 0 0\n`;
  }
  smd += `end\n\n`;
  
  // Triangles
  smd += `triangles\n`;
  if (model.vertices && model.indices) {
    for (let i = 0; i < model.indices.length; i += 3) {
      smd += `default\n`;
      for (let j = 0; j < 3; j++) {
        const idx = model.indices[i + j];
        const v = model.vertices[idx];
        if (v) {
          const pos = v.position || [0, 0, 0];
          const norm = v.normal || [0, 0, 1];
          const uv = v.uv || [0, 0];
          // UVs are stored in DirectX convention (V=0 at top), which is what SMD expects
          smd += `  0 ${pos[0]} ${pos[1]} ${pos[2]} ${norm[0]} ${norm[1]} ${norm[2]} ${uv[0]} ${uv[1]}\n`;
        }
      }
    }
  }
  smd += `end\n`;
  
  return smd;
}

// Convert quaternion to euler angles
function quaternionToEuler(q: [number, number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  
  // Roll (x-axis rotation)
  const sinr_cosp = 2 * (w * x + y * z);
  const cosr_cosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinr_cosp, cosr_cosp);
  
  // Pitch (y-axis rotation)
  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);
  
  // Yaw (z-axis rotation)
  const siny_cosp = 2 * (w * z + x * y);
  const cosy_cosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(siny_cosp, cosy_cosp);
  
  return [roll, pitch, yaw];
}

// Export model to Cast format (binary)
function exportModelToCast(model: ParsedModel): Uint8Array {
  // Cast file format header
  const CAST_MAGIC = 0x74736163; // 'cast'
  const CAST_VERSION = 1;
  
  // Simple implementation - just metadata
  const buffer = new ArrayBuffer(64);
  const view = new DataView(buffer);
  
  view.setUint32(0, CAST_MAGIC, true);
  view.setUint32(4, CAST_VERSION, true);
  view.setUint32(8, model.meshCount || 0, true);
  view.setUint32(12, model.boneCount || 0, true);
  view.setUint32(16, model.materialCount || 0, true);
  
  return new Uint8Array(buffer);
}

// ==========================================
// MATERIAL EXPORT
// ==========================================

async function exportMaterial(
  asset: Asset,
  format: ExportFormat,
  outputPath: string,
  settings: Settings,
  onProgress?: ExportProgressCallback
): Promise<ExportResult> {
  const matMeta = asset.metadata as MaterialMetadata | undefined;
  
  // Get parsed material data from metadata (populated during load)
  const parsedMaterial: ParsedMaterialData | null = matMeta?.parsedMaterial || null;
  
  if (!parsedMaterial) {
    console.warn('[ExportService] No parsed material data available for:', asset.name);
  }

  // JSON export - match C++ ExportMaterialStruct format exactly
  if (format.id === 'json') {
    const header = parsedMaterial?.header;
    const textures = parsedMaterial?.textures || [];
    
    // Build JSON matching C++ format exactly
    let json = '{\n';
    
    // Fix slashes in material name
    const materialName = (parsedMaterial?.name || asset.name || '').replace(/\\/g, '/');
    json += `\t"name": "${materialName}",\n`;
    
    json += `\t"width": ${header?.width || 0},\n`;
    json += `\t"height": ${header?.height || 0},\n`;
    json += `\t"depth": ${header?.depth || 1},\n`;
    
    json += `\t"glueFlags": "0x${(header?.glueFlags || 0).toString(16).toUpperCase()}",\n`;
    json += `\t"glueFlags2": "0x${(header?.glueFlags2 || 0).toString(16).toUpperCase()}",\n`;
    
    // blendStates array - from dxStates[0].blendStates (8 entries)
    json += `\t"blendStates": [\n`;
    const dxState = header?.dxStates?.[0];
    if (dxState?.blendStates && dxState.blendStates.length > 0) {
      const blendLines = dxState.blendStates.map((bs, i) => {
        const comma = i < dxState.blendStates.length - 1 ? ',' : '';
        // Format as hex with 0x prefix, uppercase
        return `\t\t"0x${bs.toString(16).toUpperCase()}"${comma}`;
      });
      json += blendLines.join('\n') + '\n';
    }
    json += `\t],\n`;
    
    json += `\t"blendStateMask": "0x${(dxState?.blendStateMask || 0).toString(16).toUpperCase()}",\n`;
    json += `\t"depthStencilFlags": "0x${(dxState?.depthStencilFlags || 0).toString(16).toUpperCase()}",\n`;
    json += `\t"rasterizerFlags": "0x${(dxState?.rasterizerFlags || 0).toString(16).toUpperCase()}",\n`;
    json += `\t"uberBufferFlags": "0x${(header?.uberBufferFlags || 0).toString(16).toUpperCase()}",\n`;
    json += `\t"features": "0x0",\n`;  // Not in current header struct
    
    // samplers - the C++ treats samplers[4] as a single uint32
    let samplersValue = 0;
    if (header?.samplers && header.samplers.length >= 4) {
      samplersValue = (header.samplers[0]) | 
                      (header.samplers[1] << 8) | 
                      (header.samplers[2] << 16) | 
                      (header.samplers[3] << 24);
    }
    json += `\t"samplers": "0x${samplersValue.toString(16).toUpperCase()}",\n`;
    
    json += `\t"surfaceProp": "${parsedMaterial?.surfaceName || ''}",\n`;
    json += `\t"surfaceProp2": "${parsedMaterial?.surfaceName2 || ''}",\n`;
    
    // Material type enum to shader type name
    const shaderTypeName = header?.materialType !== undefined ? 
      ['unknown', 'lit', 'unlit', 'unlitts', 'skin', 'world', 'vertexLitBump'][header.materialType] || 'unknown' : 'unknown';
    json += `\t"shaderType": "${shaderTypeName}",\n`;
    json += `\t"shaderSet": "0x${(header?.shaderSetGuid || 0n).toString(16).toUpperCase()}",\n`;
    
    // $textures object - use guidHex without the leading "0x" since we add it
    json += `\t"$textures": {\n`;
    if (textures.length > 0) {
      const texLines = textures.map((t, i) => {
        const comma = i < textures.length - 1 ? ',' : '';
        // guidHex already has 0x prefix, so use it directly
        return `\t\t"${t.index}": "${t.guidHex}"${comma}`;
      });
      json += texLines.join('\n') + '\n';
    }
    json += `\t},\n`;
    
    // $textureTypes object
    json += `\t"$textureTypes": {\n`;
    if (textures.length > 0) {
      const typeLines = textures.map((t, i) => {
        const comma = i < textures.length - 1 ? ',' : '';
        return `\t\t"${t.index}": "${t.resourceBindingName || 'unavailable'}"${comma}`;
      });
      json += typeLines.join('\n') + '\n';
    }
    json += `\t},\n`;
    
    // Depth/shadow materials
    json += `\t"$depthShadowMaterial": "0x${(header?.depthShadowMaterial || 0n).toString(16).toUpperCase()}",\n`;
    json += `\t"$depthPrepassMaterial": "0x${(header?.depthPrepassMaterial || 0n).toString(16).toUpperCase()}",\n`;
    json += `\t"$depthVSMMaterial": "0x${(header?.depthVSMMaterial || 0n).toString(16).toUpperCase()}",\n`;
    json += `\t"$depthShadowTightMaterial": "0x${(header?.depthShadowTightMaterial || 0n).toString(16).toUpperCase()}",\n`;
    json += `\t"$colpassMaterial": "0x${(header?.colpassMaterial || 0n).toString(16).toUpperCase()}",\n`;
    json += `\t"$textureAnimation": "0x${(header?.textureAnimation || 0n).toString(16).toUpperCase()}"\n`;
    
    json += '}\n';
    
    return writeFile(outputPath, stringToUint8Array(json));
  }

  // VMT export
  if (format.id === 'vmt') {
    const textures = parsedMaterial?.textures || [];
    
    let vmt = `// Generated by RSX Electron\n`;
    vmt += `// Material: ${asset.name}\n\n`;
    vmt += `"VertexLitGeneric"\n{\n`;
    
    for (const tex of textures) {
      if (tex.resourceBindingName?.includes('Color') || tex.resourceBindingName?.includes('Albedo')) {
        vmt += `  "$basetexture" "${tex.guidHex}"\n`;
      } else if (tex.resourceBindingName?.includes('Normal')) {
        vmt += `  "$bumpmap" "${tex.guidHex}"\n`;
      } else if (tex.resourceBindingName?.includes('Specular')) {
        vmt += `  "$envmapmask" "${tex.guidHex}"\n`;
      }
    }
    
    vmt += `}\n`;
    
    return writeFile(outputPath, stringToUint8Array(vmt));
  }

  return { success: false, error: `Unsupported material export format: ${format.id}` };
}

/**
 * Export material texture dependencies
 */
async function exportMaterialDependencies(
  materialAsset: Asset,
  outputDir: string,
  settings: Settings,
  allAssets: Asset[],
  onProgress?: ExportProgressCallback,
  getTextureData?: TextureDataLoader
): Promise<void> {
  const matMeta = materialAsset.metadata as MaterialMetadata | undefined;
  const parsedMaterial = matMeta?.parsedMaterial;
  
  if (!parsedMaterial?.textures || parsedMaterial.textures.length === 0) {
    console.log('[ExportService] No texture dependencies to export for material:', materialAsset.name);
    return;
  }
  
  // Build a map of loaded textures by GUID (normalized to uppercase without 0x)
  const texturesByGuid = new Map<string, Asset>();
  for (const asset of allAssets) {
    if (asset.type === 'txtr') {
      // Normalize GUID to uppercase for comparison
      const normalizedGuid = asset.guid.toUpperCase().replace(/^0X/, '');
      texturesByGuid.set(normalizedGuid, asset);
    }
  }
  
  console.log(`[ExportService] Exporting ${parsedMaterial.textures.length} texture dependencies for material: ${materialAsset.name}`);
  
  // Get the default texture export format - prefer DDS for full quality
  const textureFormats = TEXTURE_EXPORT_FORMATS;
  const defaultFormat = textureFormats.find(f => f.id === 'dds_mipmapped') || textureFormats[0];
  
  for (const texEntry of parsedMaterial.textures) {
    // Normalize the texture GUID for lookup (remove 0x prefix and uppercase)
    const normalizedGuid = texEntry.guidHex.toUpperCase().replace(/^0X/, '');
    const textureAsset = texturesByGuid.get(normalizedGuid);
    
    if (!textureAsset) {
      console.warn(`[ExportService] Texture dependency not found in loaded assets: ${texEntry.guidHex}`);
      continue;
    }
    
    // Determine output path for texture
    let texOutputPath = outputDir;
    if (settings.exportPathsFull && textureAsset.name) {
      const texAssetPath = textureAsset.name.replace(/\\/g, '/');
      const parentDir = texAssetPath.substring(0, texAssetPath.lastIndexOf('/'));
      if (parentDir) {
        texOutputPath = `${outputDir}/${parentDir}`;
      }
    }
    
    // Ensure output directory exists
    await window.electron.createDir(texOutputPath);
    
    const texAssetName = getAssetFileName(textureAsset);
    onProgress?.(0, 1, `Exporting texture: ${texAssetName}...`);
    
    // Export the texture - pass getTextureData to load pixel data from starpak
    const result = await exportTexture(textureAsset, defaultFormat, texOutputPath, texAssetName, settings, onProgress, getTextureData);
    if (!result.success) {
      console.warn(`[ExportService] Failed to export texture dependency ${texAssetName}: ${result.error}`);
    } else {
      console.log(`[ExportService] Exported texture dependency: ${texAssetName}`);
    }
  }
}

// ==========================================
// ANIMATION EXPORTS
// ==========================================

async function exportAnimSeq(
  asset: Asset,
  format: ExportFormat,
  outputPath: string,
  settings: Settings,
  onProgress?: ExportProgressCallback
): Promise<ExportResult> {
  // JSON metadata export
  if (format.id === 'json') {
    const metadata = {
      guid: asset.guid,
      name: asset.name,
      type: asset.type,
      version: asset.version,
      containerFile: asset.containerFile,
      size: asset.size,
      note: 'Animation sequence data',
    };
    
    return writeJSON(outputPath, metadata);
  }

  // SMD animation export
  if (format.id === 'smd') {
    let smd = `version 1\n`;
    smd += `// Generated by RSX Electron\n`;
    smd += `// Animation: ${asset.name}\n\n`;
    smd += `nodes\n  0 "root" -1\nend\n\n`;
    smd += `skeleton\ntime 0\n  0 0 0 0 0 0 0\nend\n`;
    
    return writeFile(outputPath, stringToUint8Array(smd));
  }

  return { success: false, error: `Unsupported animation export format: ${format.id}` };
}

async function exportAnimRig(
  asset: Asset,
  format: ExportFormat,
  outputPath: string,
  settings: Settings,
  onProgress?: ExportProgressCallback
): Promise<ExportResult> {
  // JSON metadata export
  if (format.id === 'json') {
    const metadata = {
      guid: asset.guid,
      name: asset.name,
      type: asset.type,
      version: asset.version,
      containerFile: asset.containerFile,
      size: asset.size,
      note: 'Animation rig data',
    };
    
    return writeJSON(outputPath, metadata);
  }

  // SMD skeleton export
  if (format.id === 'smd') {
    let smd = `version 1\n`;
    smd += `// Generated by RSX Electron\n`;
    smd += `// Rig: ${asset.name}\n\n`;
    smd += `nodes\n  0 "root" -1\nend\n\n`;
    smd += `skeleton\ntime 0\n  0 0 0 0 0 0 0\nend\n`;
    
    return writeFile(outputPath, stringToUint8Array(smd));
  }

  return { success: false, error: `Unsupported rig export format: ${format.id}` };
}

// ==========================================
// SHADER EXPORTS
// ==========================================

async function exportShader(
  asset: Asset,
  format: ExportFormat,
  outputPath: string,
  settings: Settings,
  onProgress?: ExportProgressCallback
): Promise<ExportResult> {
  // JSON metadata export
  if (format.id === 'json') {
    const metadata = {
      guid: asset.guid,
      name: asset.name,
      type: asset.type,
      version: asset.version,
      containerFile: asset.containerFile,
      size: asset.size,
    };
    
    return writeJSON(outputPath, metadata);
  }

  // Raw binary export
  if (format.id === 'raw') {
    if (!asset.rawData) {
      return { success: false, error: 'No raw data available' };
    }
    return writeFile(outputPath, new Uint8Array(asset.rawData));
  }

  return { success: false, error: `Unsupported shader export format: ${format.id}` };
}

async function exportShaderSet(
  asset: Asset,
  format: ExportFormat,
  outputPath: string,
  settings: Settings,
  onProgress?: ExportProgressCallback
): Promise<ExportResult> {
  // JSON metadata export
  const metadata = {
    guid: asset.guid,
    name: asset.name,
    type: asset.type,
    version: asset.version,
    containerFile: asset.containerFile,
    size: asset.size,
  };
  
  return writeJSON(outputPath, metadata);
}

// ==========================================
// UI IMAGE EXPORT
// ==========================================

async function exportUIImage(
  asset: Asset,
  format: ExportFormat,
  outputPath: string,
  settings: Settings,
  onProgress?: ExportProgressCallback
): Promise<ExportResult> {
  // JSON metadata export
  if (format.id === 'json') {
    const metadata = {
      guid: asset.guid,
      name: asset.name,
      type: asset.type,
      version: asset.version,
      containerFile: asset.containerFile,
      size: asset.size,
      note: 'UI image atlas data',
    };
    
    return writeJSON(outputPath, metadata);
  }

  // PNG export - similar to texture
  if (format.id === 'png') {
    const texMeta = asset.metadata as TextureMetadata | undefined;
    
    // Try to get texture data
    if (texMeta?.pixelData) {
      const width = texMeta.width || 256;
      const height = texMeta.height || 256;
      const texFormat = texMeta.format || TextureFormat.R8G8B8A8_UNORM;
      
      const rgbaData = decodeTextureToRGBA(
        new Uint8Array(texMeta.pixelData),
        width,
        height,
        texFormat
      );
      
      const pngData = await createPNG(rgbaData, width, height);
      if (pngData) {
        return writeFile(outputPath, pngData);
      }
    }
    return { success: false, error: 'No image data available' };
  }

  return { success: false, error: `Unsupported UI image export format: ${format.id}` };
}

// ==========================================
// DATA TABLE EXPORT
// ==========================================

async function exportDatatable(
  asset: Asset,
  format: ExportFormat,
  outputPath: string,
  settings: Settings,
  onProgress?: ExportProgressCallback
): Promise<ExportResult> {
  // Try to parse datatable
  const data = asset.rawData ? new Uint8Array(asset.rawData) : null;
  
  // CSV export
  if (format.id === 'csv') {
    if (!data) {
      return { success: false, error: 'No datatable data available' };
    }
    
    // Parse datatable structure and convert to CSV
    const csvContent = parseDatatableToCSV(data);
    return writeFile(outputPath, stringToUint8Array(csvContent));
  }

  // JSON export
  if (format.id === 'json') {
    const metadata: Record<string, any> = {
      guid: asset.guid,
      name: asset.name,
      type: asset.type,
      version: asset.version,
      containerFile: asset.containerFile,
      size: asset.size,
      note: 'Datatable data',
    };
    
    if (data) {
      try {
        const parsed = parseDatatableToObject(data);
        Object.assign(metadata, { data: parsed });
      } catch {
        // Ignore parse errors
      }
    }
    
    return writeJSON(outputPath, metadata);
  }

  return { success: false, error: `Unsupported datatable export format: ${format.id}` };
}

// Parse datatable to CSV
function parseDatatableToCSV(data: Uint8Array): string {
  // Basic datatable parsing - structure varies by version
  return `# RSX Electron Datatable Export\n# Data size: ${data.length} bytes\n`;
}

// Parse datatable to object
function parseDatatableToObject(data: Uint8Array): any {
  return {
    size: data.length,
  };
}

// ==========================================
// SUBTITLES EXPORT
// ==========================================

async function exportSubtitles(
  asset: Asset,
  format: ExportFormat,
  outputPath: string,
  settings: Settings,
  onProgress?: ExportProgressCallback
): Promise<ExportResult> {
  const data = asset.rawData ? new Uint8Array(asset.rawData) : null;
  
  // TXT export
  if (format.id === 'txt') {
    if (!data) {
      return { success: false, error: 'No subtitle data available' };
    }
    
    // Try to extract text content
    const textContent = parseSubtitlesToText(data);
    return writeFile(outputPath, stringToUint8Array(textContent));
  }

  // CSV export
  if (format.id === 'csv') {
    if (!data) {
      return { success: false, error: 'No subtitle data available' };
    }
    
    const csvContent = parseSubtitlesToCSV(data);
    return writeFile(outputPath, stringToUint8Array(csvContent));
  }

  // JSON export
  if (format.id === 'json') {
    const metadata = {
      guid: asset.guid,
      name: asset.name,
      type: asset.type,
      version: asset.version,
      containerFile: asset.containerFile,
      size: asset.size,
    };
    
    return writeJSON(outputPath, metadata);
  }

  return { success: false, error: `Unsupported subtitle export format: ${format.id}` };
}

// Parse subtitles to plain text
function parseSubtitlesToText(data: Uint8Array): string {
  // Try to decode as UTF-8 text
  try {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(data);
  } catch {
    return `# Binary data: ${data.length} bytes\n`;
  }
}

// Parse subtitles to CSV
function parseSubtitlesToCSV(data: Uint8Array): string {
  return `"id","text"\n# Subtitle data: ${data.length} bytes\n`;
}

// ==========================================
// RAW/GENERIC EXPORT
// ==========================================

async function exportRaw(
  asset: Asset,
  format: ExportFormat,
  outputPath: string,
  settings: Settings,
  onProgress?: ExportProgressCallback
): Promise<ExportResult> {
  // JSON metadata export for any type
  if (format.id === 'json') {
    const metadata = {
      guid: asset.guid,
      name: asset.name,
      type: asset.type,
      version: asset.version,
      containerFile: asset.containerFile,
      size: asset.size,
      metadata: asset.metadata,
    };
    
    return writeJSON(outputPath, metadata);
  }

  // Raw binary export
  if (asset.rawData) {
    return writeFile(outputPath, new Uint8Array(asset.rawData));
  }

  // If no raw data, export metadata as JSON
  const metadata = {
    guid: asset.guid,
    name: asset.name,
    type: asset.type,
    version: asset.version,
    size: asset.size,
    note: 'Raw data not available',
  };
  
  const jsonPath = outputPath.replace(/\.[^.]+$/, '.json');
  return writeJSON(jsonPath, metadata);
}
