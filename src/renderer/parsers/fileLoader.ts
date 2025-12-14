/**
 * File loading and parsing coordinator
 */

import { Asset } from '../types/asset';
import { getFileExtension } from '../utils/assetUtils';
import { parseRPak, ParsedRPak, ParsedAsset, CompressionType, RpakParser } from './rpakParser';
import { BinaryReader } from '../utils/binaryUtils';
import { starpakManager } from './starpakLoader';
import { parseMaterialAsset, ParsedMaterialData } from './materialParser';
import { parseShaderSetHeader, parseShaderHeader } from './shaderParser';
import { extractTextureBindings } from './dxbcParser';

export type FileType = 'rpak' | 'starpak' | 'mbnk' | 'bsp' | 'mdl' | 'bpk' | 'unknown';

export function detectFileType(filename: string): FileType {
  const ext = getFileExtension(filename);
  
  switch (ext) {
    case 'rpak':
      return 'rpak';
    case 'starpak':
      return 'starpak';
    case 'mbnk':
      return 'mbnk';
    case 'bsp':
      return 'bsp';
    case 'mdl':
      return 'mdl';
    case 'bpk':
      return 'bpk';
    default:
      return 'unknown';
  }
}

export interface LoadResult {
  success: boolean;
  assets: Asset[];
  parsedRPak?: ParsedRPak;
  rpakParser?: RpakParser;
  error?: string;
  warnings?: string[];
}

/**
 * Get shader texture bindings for a material by parsing its shader set's pixel shader
 */
function getShaderBindingsForMaterial(
  materialHeaderData: Uint8Array,
  materialVersion: number,
  parser: RpakParser,
  assetsByGuid: Map<string, ParsedAsset>,
  shaderBindingsCache: Map<string, Map<number, string>>
): Map<number, string> | undefined {
  try {
    const reader = new BinaryReader(materialHeaderData);
    
    // Read shaderSetGuid from material header
    // v15 layout: vftable(8) + gap(8) + guid(8) + namePtr(8) + surfacePtr(8) + surface2Ptr(8) + 
    //             depthShadow(8) + depthPrepass(8) + depthVSM(8) + depthShadowTight(8) + colpass(8) + shaderSet(8)
    // Skip to offset 88 for shaderSetGuid in v15
    if (materialVersion <= 12) {
      // v12: vftable(8) + gap(8) + guid(8) + namePtr(8) + surfacePtr(8) + surface2Ptr(8) + 
      //      depthShadow(8) + depthPrepass(8) + depthVSM(8) + colpass(8) + dxStates(96) + shaderSet(8)
      // shaderSet is at offset 168
      if (materialHeaderData.length < 176) return undefined;
      reader.seek(168);
    } else {
      // v15+: shaderSet is at offset 88
      if (materialHeaderData.length < 96) return undefined;
      reader.seek(88);
    }
    
    const shaderSetGuid = reader.readUint64();
    if (shaderSetGuid === 0n) return undefined;
    
    const shaderSetGuidHex = `0x${shaderSetGuid.toString(16).toUpperCase()}`;
    
    // Check cache first
    if (shaderBindingsCache.has(shaderSetGuidHex)) {
      return shaderBindingsCache.get(shaderSetGuidHex);
    }
    
    // Find shader set asset
    const shaderSetAsset = assetsByGuid.get(shaderSetGuidHex);
    if (!shaderSetAsset || shaderSetAsset.typeFourCC !== 'shds') {
      return undefined;
    }
    
    // Parse shader set header to get pixel shader GUID
    const shaderSet = parseShaderSetHeader(
      shaderSetAsset.headerData,
      shaderSetAsset.version || 11,
      (pageIndex: number) => parser.getPageData(pageIndex)
    );
    if (!shaderSet || shaderSet.pixelShaderGuid === 0n) {
      return undefined;
    }
    
    const pixelShaderGuidHex = `0x${shaderSet.pixelShaderGuid.toString(16).toUpperCase()}`;
    
    // Find pixel shader asset
    const pixelShaderAsset = assetsByGuid.get(pixelShaderGuidHex);
    if (!pixelShaderAsset || pixelShaderAsset.typeFourCC !== 'shdr') {
      return undefined;
    }
    
    // Parse pixel shader header to get data pointer
    const shaderHeader = parseShaderHeader(
      pixelShaderAsset.headerData,
      pixelShaderAsset.version || 8
    );
    if (!shaderHeader) {
      return undefined;
    }
    
    // Get shader bytecode data
    const shaderPage = parser.getPageData(shaderHeader.dataPtr.index);
    if (!shaderPage || shaderHeader.dataPtr.offset >= shaderPage.length) {
      return undefined;
    }
    
    const shaderDataSize = Math.min(
      shaderHeader.dataSize,
      shaderPage.length - shaderHeader.dataPtr.offset
    );
    const shaderData = shaderPage.slice(
      shaderHeader.dataPtr.offset,
      shaderHeader.dataPtr.offset + shaderDataSize
    );
    
    // Extract texture bindings from DXBC bytecode
    const bindings = extractTextureBindings(shaderData);
    
    // Cache the result
    shaderBindingsCache.set(shaderSetGuidHex, bindings);
    
    return bindings;
  } catch (e) {
    console.warn('[FileLoader] Failed to get shader bindings for material:', e);
    return undefined;
  }
}

/**
 * Convert ParsedAsset to the Asset format used by the UI
 * @param parsed The parsed asset from RPak
 * @param containerFile The container file name
 * @param parser The RPak parser instance for page data access
 * @param assetsByGuid Map of all assets by GUID for shader lookups
 * @param shaderBindingsCache Cache of shader texture bindings by shader GUID
 */
function convertParsedAsset(
  parsed: ParsedAsset,
  containerFile: string,
  parser?: RpakParser,
  assetsByGuid?: Map<string, ParsedAsset>,
  shaderBindingsCache?: Map<string, Map<number, string>>
): Asset {
  // For model assets, read the data pointed to by the first pointer in the header
  // ModelAssetHeader.data points to the studiohdr
  let dataPageData: Uint8Array | undefined;
  let vertexComponentData: Uint8Array | undefined;
  let parsedMaterial: ParsedMaterialData | null = null;
  
  if (parsed.headerData && parsed.headerData.length >= 8 && parser) {
    const typeCode = parsed.typeFourCC;
    
    // For model assets (mdl_), read studiohdr and vertex data
    if (typeCode === 'mdl_') {
      const headerReader = new BinaryReader(parsed.headerData);

      // First pointer: data (studiohdr)
      const dataPageIndex = headerReader.readUint32();
      const dataPageOffset = headerReader.readUint32();

      // Read the studiohdr data from the page - page 0 and offset 0 CAN be valid
      const pageData = parser.getPageData(dataPageIndex);

      if (pageData && pageData.length > 0 && dataPageOffset < pageData.length) {
        // Read all remaining data from the page - studiohdr can be very large (contains material GUIDs at high offsets)
        // Complex models can have material arrays at offsets like 60000+
        const size = pageData.length - dataPageOffset;
        dataPageData = pageData.slice(dataPageOffset, dataPageOffset + size);
      }
      
      // vertexComponentData pointer location depends on version:
      // v8: data (0), name (8), unk_10 (16), physics (24), vertexComponentData (32)
      // v9+: data (0), info (8), name (16), gap_18 (24), physics (32), vertexComponentData (40)
      let vertexDataPtrOffset = parsed.version >= 9 ? 40 : 32;
      
      if (parsed.headerData.length >= vertexDataPtrOffset + 8) {
        headerReader.seek(vertexDataPtrOffset);
        const vertexPageIndex = headerReader.readUint32();
        const vertexPageOffset = headerReader.readUint32();
        
        // Read vertex component data - only if pointer is non-zero
        // Page index 0, offset 0 typically means NULL pointer (no embedded vertex data, uses streaming)
        if (vertexPageIndex === 0 && vertexPageOffset === 0) {

        } else if (vertexPageIndex < 1000 && vertexPageOffset < 0x1000000) {
          const vertexPage = parser.getPageData(vertexPageIndex);
          if (vertexPage && vertexPageOffset < vertexPage.length) {
            // Read all remaining data in the page from this offset
            const vertexSize = vertexPage.length - vertexPageOffset;
            vertexComponentData = vertexPage.slice(vertexPageOffset, vertexPageOffset + Math.min(vertexSize, 16 * 1024 * 1024));
          }
        }
      }
    }
    // For material assets (matl), parse the full material data including textures
    else if (typeCode === 'matl') {
      // Try to get texture bindings from shader
      let shaderTextureBindings: Map<number, string> | undefined;
      
      if (assetsByGuid && shaderBindingsCache && parsed.headerData.length >= 80) {
        shaderTextureBindings = getShaderBindingsForMaterial(
          parsed.headerData,
          parsed.version || 15,
          parser,
          assetsByGuid,
          shaderBindingsCache
        );
      }
      
      parsedMaterial = parseMaterialAsset(
        parsed,
        (pageIndex: number) => parser.getPageData(pageIndex),
        shaderTextureBindings
      );
    }
    // For settings layout (stlt), read the full header page containing fields and strings
    // stlt doesn't use a separate data page - all data is in the header page
    else if (typeCode === 'stlt') {
      // Get the full header page - offsets in header are relative to page start
      const fullPage = parser.getPageData(parsed.headPagePtr.index);
      console.log('[fileLoader] stlt headPagePtr:', parsed.headPagePtr, 'fullPage:', fullPage?.length || 0);
      if (fullPage) {
        // Use the FULL page - offsets in header point to absolute positions within the page
        dataPageData = fullPage;
        console.log('[fileLoader] stlt using full page as dataPageData:', dataPageData.length);
      }
    }
    // For settings (stgs), read the full header page containing values
    // stgs doesn't use a separate data page - all data is in the header page
    else if (typeCode === 'stgs') {
      // Get the full header page - offsets in header are relative to page start
      const fullPage = parser.getPageData(parsed.headPagePtr.index);
      console.log('[fileLoader] stgs headPagePtr:', parsed.headPagePtr, 'fullPage:', fullPage?.length || 0);
      if (fullPage) {
        // Use the FULL page - offsets in header point to absolute positions within the page
        dataPageData = fullPage;
        console.log('[fileLoader] stgs using full page as dataPageData:', dataPageData.length);
      }
    }
  }
  
  return {
    guid: parsed.guid,
    name: parsed.name,
    type: parsed.typeFourCC as any,
    containerFile,
    containerType: 'pak',
    offset: parsed.headPagePtr.offset,
    size: parsed.headerSize,
    version: parsed.version, // Asset version (8, 9, 10, etc.)
    metadata: {
      version: parsed.version, // Include in metadata too for easy access
      typeName: parsed.typeName,
      headerSize: parsed.headerSize,
      headPagePtr: parsed.headPagePtr,
      dataPagePtr: parsed.dataPagePtr,
      starpakOffset: parsed.starpakOffset,
      optStarpakOffset: parsed.optStarpakOffset,
      pageEnd: parsed.pageEnd,
      dependentsIndex: parsed.dependentsIndex,
      dependenciesIndex: parsed.dependenciesIndex,
      dependentsCount: parsed.dependentsCount,
      dependenciesCount: parsed.dependenciesCount,
      // Include raw header data for preview parsing
      headerData: parsed.headerData,
      // For model assets, include the data pointed to by the header
      dataPageData,
      // For model assets, include vertex component data (VTX, VVD, etc.)
      vertexComponentData,
      // For material assets, include the parsed material data
      parsedMaterial,
    },
  };
}

/**
 * Load and parse a file, returning its assets
 */
export async function loadFile(filePath: string): Promise<LoadResult> {
  const fileName = filePath.split(/[/\\]/).pop() || 'unknown';
  const fileType = detectFileType(fileName);

  console.log(`[FileLoader] Loading file: ${fileName}, type: ${fileType}`);

  try {
    // Read the file
    const result = await window.electron.readFile(filePath);
    
    console.log(`[FileLoader] Read file result: success=${result.success}, dataType=${typeof result.data}, dataLength=${result.data?.length || 0}`);
    
    if (!result.success || !result.data) {
      return {
        success: false,
        assets: [],
        error: result.error || 'Failed to read file',
      };
    }

    // Convert the data to Uint8Array
    // IPC serializes Buffer as an object with numbered properties or as a Uint8Array
    let uint8Array: Uint8Array;
    
    if (result.data instanceof Uint8Array) {
      uint8Array = result.data;
    } else if (result.data instanceof ArrayBuffer) {
      uint8Array = new Uint8Array(result.data);
    } else if (typeof result.data === 'object' && result.data !== null) {
      // Buffer serialized through IPC becomes { type: 'Buffer', data: [...] } or just numbered properties
      if ('data' in result.data && Array.isArray((result.data as any).data)) {
        uint8Array = new Uint8Array((result.data as any).data);
      } else {
        // Try to convert object with numbered properties to array
        const values = Object.values(result.data) as number[];
        uint8Array = new Uint8Array(values);
      }
    } else {
      return {
        success: false,
        assets: [],
        error: 'Invalid data format received from file read',
      };
    }

    const buffer = uint8Array.buffer.slice(uint8Array.byteOffset, uint8Array.byteOffset + uint8Array.byteLength);

    console.log(`[FileLoader] Buffer size: ${buffer.byteLength}`);

    // Parse based on file type
    let assets: Asset[] = [];
    let parsedRPak: ParsedRPak | undefined;
    let rpakParser: RpakParser | undefined;
    let warnings: string[] = [];

    switch (fileType) {
      case 'rpak':
        console.log(`[FileLoader] Parsing RPak...`);
        const rpakResult = await parseRPak(buffer, filePath);
        parsedRPak = rpakResult.parsed;
        rpakParser = rpakResult.parser;
        
        console.log(`[FileLoader] RPak parsed:`, {
          version: parsedRPak.header.version,
          numAssets: parsedRPak.header.numAssets,
          isCompressed: parsedRPak.isCompressed,
          compressionType: parsedRPak.compressionType,
          assetsFound: parsedRPak.assets.length,
        });
        
        // Initialize starpak manager with streaming file paths
        // Extract base directory from file path (handle both / and \ separators)
        const separatorIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
        const basePath = separatorIndex >= 0 ? filePath.substring(0, separatorIndex) : filePath;
        await starpakManager.initialize(
          basePath,
          parsedRPak.streamingFiles,
          parsedRPak.optStreamingFiles
        );
        
        if (parsedRPak.streamingFiles.length > 0) {
          console.log(`[FileLoader] Starpak files available:`, parsedRPak.streamingFiles);
        }
        
        // Report compression status
        if (parsedRPak.isCompressed) {
          switch (parsedRPak.compressionType) {
            case CompressionType.ZSTD:
              // ZSTD was successfully decompressed
              warnings.push('ZSTD-compressed RPak file was successfully decompressed.');
              break;
            case CompressionType.OODLE:
              warnings.push('This RPak file uses Oodle compression which is not supported in the browser.');
              break;
            case CompressionType.RTECH:
              warnings.push('This RPak file uses RTech compression which is not supported in the browser.');
              break;
          }
        }
        
        if (parsedRPak.isPatched) {
          warnings.push('This is a patch RPak file. Some assets may require the base file to be loaded.');
        }
        
        // Build asset map by GUID for shader lookups
        const assetsByGuid = new Map<string, ParsedAsset>();
        for (const asset of parsedRPak.assets) {
          const guidHex = `0x${BigInt('0x' + asset.guid.replace(/^0x/i, '')).toString(16).toUpperCase()}`;
          assetsByGuid.set(guidHex, asset);
        }
        
        // Cache for shader texture bindings
        const shaderBindingsCache = new Map<string, Map<number, string>>();
        
        // Convert parsed assets to UI format (with shader bindings for materials)
        assets = parsedRPak.assets.map(a => 
          convertParsedAsset(a, fileName, rpakParser, assetsByGuid, shaderBindingsCache)
        );
        console.log(`[FileLoader] Converted ${assets.length} assets`);
        break;
      
      case 'starpak':
        // StarPak files are streaming data, they don't contain asset headers
        return {
          success: true,
          assets: [],
          warnings: ['StarPak files are streaming data containers and don\'t contain asset definitions'],
        };
      
      case 'mbnk':
        assets = await parseMBNK(buffer, fileName);
        break;
      
      case 'mdl':
        assets = await parseMDL(buffer, fileName);
        break;
      
      case 'bsp':
        assets = await parseBSP(buffer, fileName);
        break;
      
      case 'bpk':
        assets = await parseBPK(buffer, fileName);
        break;
      
      default:
        return {
          success: false,
          assets: [],
          error: `Unsupported file type: ${fileType}`,
        };
    }

    return {
      success: true,
      assets,
      parsedRPak,
      rpakParser,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    return {
      success: false,
      assets: [],
      error: `Failed to parse file: ${(error as Error).message}`,
    };
  }
}

// Placeholder parsers - to be implemented
async function parseMBNK(buffer: ArrayBuffer, fileName: string): Promise<Asset[]> {
  // TODO: Implement MBNK (Miles Audio Bank) parser
  return [{
    guid: `mbnk-${Date.now()}`,
    name: fileName.replace('.mbnk', ''),
    type: 'asrc',
    containerFile: fileName,
    containerType: 'audio',
  }];
}

async function parseMDL(buffer: ArrayBuffer, fileName: string): Promise<Asset[]> {
  // TODO: Implement Source MDL parser
  return [{
    guid: `mdl-${Date.now()}`,
    name: fileName.replace('.mdl', ''),
    type: 'mdl',
    containerFile: fileName,
    containerType: 'mdl',
  }];
}

async function parseBSP(buffer: ArrayBuffer, fileName: string): Promise<Asset[]> {
  // TODO: Implement BSP parser
  return [{
    guid: `bsp-${Date.now()}`,
    name: fileName.replace('.bsp', ''),
    type: 'rmap',
    containerFile: fileName,
    containerType: 'bsp',
  }];
}

async function parseBPK(buffer: ArrayBuffer, fileName: string): Promise<Asset[]> {
  // TODO: Implement Bluepoint Pak parser
  return [{
    guid: `bpk-${Date.now()}`,
    name: fileName.replace('.bpk', ''),
    type: 'bpwf',
    containerFile: fileName,
    containerType: 'bp_pak',
  }];
}

/**
 * Load multiple files in parallel
 */
export async function loadFiles(filePaths: string[]): Promise<Map<string, LoadResult>> {
  const results = new Map<string, LoadResult>();
  
  // Load files in batches to avoid overwhelming the system
  const batchSize = 4;
  
  for (let i = 0; i < filePaths.length; i += batchSize) {
    const batch = filePaths.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (filePath) => ({
        path: filePath,
        result: await loadFile(filePath),
      }))
    );
    
    for (const { path, result } of batchResults) {
      results.set(path, result);
    }
  }
  
  return results;
}

/**
 * Load streaming data for a model asset from starpak
 */
export async function loadModelStreamingData(starpakOffset: bigint): Promise<Uint8Array | null> {
  return starpakManager.readStreamingData(starpakOffset, false);
}

/**
 * Export the starpak manager for direct access
 */
export { starpakManager };
