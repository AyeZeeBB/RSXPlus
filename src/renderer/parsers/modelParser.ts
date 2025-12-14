/**
 * Model asset parser
 * Ported from the C++ RSX implementation
 */

import { BinaryReader } from '../utils/binaryUtils';
import { ParsedAsset } from './rpakParser';
import { PagePtr } from './rpakTypes';

// Magic numbers
const IDST_MAGIC = 0x54534449; // "IDST" - studiohdr
const IDSV_MAGIC = 0x56534449; // "IDSV" - VVD vertex file
const VTX_VERSION = 7; // OptimizedModel version
const VG_MAGIC = 0x47567430; // "0tVG" - VertexGroup header

// Model asset header (v13+)
export interface ModelAssetHeader {
  namePtr: PagePtr;
  skeletonPtr: PagePtr;
  physicsLODPtr: PagePtr;
  animRigPtr: bigint;
  sequenceGroupsPtr: PagePtr;
  sequenceGroupCount: number;
  meshesPtr: PagePtr;
  meshCount: number;
  lodCount: number;
  permutedMeshCount: number;
  lodMeshCountsPtr: PagePtr;
  materialGUIDs: bigint[];
  materialCount: number;
  streamingTextureHandlesPtr: PagePtr;
  starpakDataOffset: bigint;
  optStarpakDataOffset: bigint;
}

// Model skeleton data
export interface ModelSkeleton {
  boneCount: number;
  bones: ModelBone[];
}

export interface ModelBone {
  name: string;
  parentIndex: number;
  position: [number, number, number];
  rotation: [number, number, number, number]; // Quaternion
  scale: [number, number, number];
}

// Model mesh data
export interface ModelMesh {
  materialIndex: number;
  vertexCount: number;
  triangleCount: number;
  flags: number;
  lodLevel: number;
  vertexOffset: bigint;
  indexOffset: bigint;
}

// Vertex data structure
export interface ModelVertex {
  position: [number, number, number];
  normal: [number, number, number];
  uv: [number, number];
  boneIndices?: [number, number, number, number];
  boneWeights?: [number, number, number, number];
  color?: [number, number, number, number];
}

// Body part info
export interface BodyPart {
  name: string;
  numModels: number;
  meshStartIndex: number;  // Which mesh index this body part starts at
  meshCount: number;       // How many meshes in this body part
}

// Skin info - maps material slots to different materials per skin
export interface SkinFamily {
  name: string;           // Skin name (e.g., "default", "skin1", etc.)
  materialRemap: number[]; // For each material slot, which material index to use
}

// Parsed model info
export interface ParsedModel {
  name: string;
  version: number;
  checksum: number;
  meshCount: number;
  lodCount: number;
  boneCount: number;
  materialCount: number;
  bodyPartCount: number;
  attachmentCount: number;
  hitboxSetCount: number;
  
  // Bounding box
  hullMin: [number, number, number];
  hullMax: [number, number, number];
  viewBBMin: [number, number, number];
  viewBBMax: [number, number, number];
  eyePosition: [number, number, number];
  
  // Physical properties
  mass: number;
  flags: number;
  
  isStreamed: boolean;
  starpakOffset: number;
  
  // Material GUIDs (references to matl assets)
  materialGUIDs: bigint[];
  
  // Body parts with names
  bodyParts?: BodyPart[];
  
  // Skin families (for skin selection)
  skinFamilies?: SkinFamily[];
  numSkinRef?: number;  // Number of material slots per skin
  
  // Skeleton data (if available)
  skeleton?: ModelSkeleton;
  
  // Mesh data (if available)
  meshes?: ModelMesh[];
  
  // Vertex/index data (if available - non-streamed or after loading starpak)
  vertices?: ModelVertex[];
  indices?: number[];
}

/**
 * Read a Vector3 from binary reader
 */
function readVector3(reader: BinaryReader): [number, number, number] {
  return [
    reader.readFloat32(),
    reader.readFloat32(),
    reader.readFloat32(),
  ];
}

/**
 * Parse studio header from raw data
 * This is the studiohdr_v8_t structure (used for all versions including v54)
 * Note: The "version" field (e.g. 54) is the MDL format version, not the struct layout version
 * 
 * @param data - Raw studiohdr data
 * @param assetVersion - The RPak asset version (8, 9, 12, 13, 16, etc.) - determines mstudiotexture format
 */
export function parseStudioHeader(data: Uint8Array, assetVersion: number = 9): ParsedModel | null {
  if (!data || data.length < 200) {
    console.log('[parseStudioHeader] Data too small:', data?.length);
    return null;
  }

  const reader = new BinaryReader(data);

  // Check magic
  const id = reader.readUint32();
  if (id !== IDST_MAGIC) {
    console.log('[parseStudioHeader] Invalid magic:', id.toString(16), 'expected IDST');
    return null;
  }

  const version = reader.readInt32();
  const checksum = reader.readInt32();
  const sznameindex = reader.readInt32();

  // The name is stored inline at offset 16 (after id, version, checksum, sznameindex)
  // Read the 64-byte inline name field
  const nameBytes = data.slice(16, 16 + 64);
  const nullIndex = nameBytes.indexOf(0);
  const name = new TextDecoder('utf-8').decode(nameBytes.slice(0, nullIndex > 0 ? nullIndex : 64));

  // Skip past inline name (64 bytes at offset 16) to offset 80
  reader.seek(80);

  const length = reader.readInt32();
  
  const eyePosition = readVector3(reader);
  const illumPosition = readVector3(reader); // Skip, but read
  const hullMin = readVector3(reader);
  const hullMax = readVector3(reader);
  const viewBBMin = readVector3(reader);
  const viewBBMax = readVector3(reader);

  const flags = reader.readInt32();

  const numbones = reader.readInt32();
  const boneindex = reader.readInt32();

  const numbonecontrollers = reader.readInt32();
  reader.skip(4); // bonecontrollerindex

  const numhitboxsets = reader.readInt32();
  reader.skip(4); // hitboxsetindex

  const numlocalanim = reader.readInt32();
  reader.skip(4); // localanimindex

  const numlocalseq = reader.readInt32();
  reader.skip(4); // localseqindex

  reader.skip(4); // activitylistversion
  reader.skip(4); // materialtypesindex

  const numtextures = reader.readInt32();
  const textureindex = reader.readInt32();

  reader.skip(4); // numcdtextures
  reader.skip(4); // cdtextureindex

  const numskinref = reader.readInt32();
  const numskinfamilies = reader.readInt32();
  const skinindex = reader.readInt32();

  const numbodyparts = reader.readInt32();
  const bodypartindex = reader.readInt32();

  const numlocalattachments = reader.readInt32();
  reader.skip(4); // localattachmentindex

  // Skip node data
  reader.skip(20); // numlocalnodes, localnodeindex, localnodenameindex, localNodeUnk, localNodeDataOffset

  const meshOffset = reader.readInt32();

  // Skip flex data (deprecated)
  reader.skip(16);

  const numikchains = reader.readInt32();
  reader.skip(4); // ikchainindex

  reader.skip(8); // uiPanelCount, uiPanelOffset

  const numlocalposeparameters = reader.readInt32();
  reader.skip(4); // localposeparamindex

  reader.skip(4); // surfacepropindex
  reader.skip(8); // keyvalueindex, keyvaluesize

  reader.skip(8); // numlocalikautoplaylocks, localikautoplaylockindex

  const mass = reader.readFloat32();

  // Parse material GUIDs from texture array
  const materialGUIDs: bigint[] = [];
  console.log('[parseStudioHeader] Texture info:', {
    numtextures,
    textureindex,
    dataLength: data.length,
    version,
    assetVersion,
  });
  
  if (numtextures > 0 && textureindex > 0) {
    // textureindex is relative to start of studiohdr, not absolute
    // Check if it fits within our data buffer
    if (textureindex >= data.length) {
      console.warn('[parseStudioHeader] textureindex is beyond data buffer, material GUIDs may be in external data');
    } else {
      reader.seek(textureindex);
    
      // The texture entry format depends on the RPak ASSET version, not the MDL version:
      // - Asset v8-v12: mstudiotexture_v8_t (12 bytes: 4 byte sznameindex + 8 byte GUID)
      // - Asset v13+: mstudiotexture_v16_t (8 bytes: just the GUID)
      const useV16TextureFormat = assetVersion >= 13;
      const structSize = useV16TextureFormat ? 8 : 12;
      
      console.log('[parseStudioHeader] Reading textures:', {
        useV16TextureFormat,
        structSize,
        startOffset: textureindex,
        assetVersion,
      });
    
      for (let i = 0; i < numtextures; i++) {
        try {
          if (useV16TextureFormat) {
            // v13+: Just raw 64-bit GUIDs
            const guid = reader.readUint64();
            materialGUIDs.push(guid);
          } else {
            // v8: mstudiotexture_v8_t structure (12 bytes)
            // int sznameindex (4 bytes) - offset from this struct to name string
            // uint64 texture (8 bytes) - material GUID
            reader.skip(4); // sznameindex
            const guid = reader.readUint64();
            materialGUIDs.push(guid);
          }
        } catch (e) {
          console.warn('[parseStudioHeader] Failed to read material GUID:', e);
          break;
        }
      }
    
      console.log('[parseStudioHeader] Parsed', materialGUIDs.length, 'material GUIDs:', 
        materialGUIDs.map(g => '0x' + g.toString(16).toUpperCase().padStart(16, '0')));
    }
  }

  // Parse body parts to get names and mesh mappings
  const bodyParts: BodyPart[] = [];
  if (numbodyparts > 0 && bodypartindex > 0 && bodypartindex < data.length) {
    let currentMeshIndex = 0;
    
    for (let bodyIdx = 0; bodyIdx < numbodyparts; bodyIdx++) {
      // mstudiobodyparts_t structure (16 bytes):
      // int sznameindex (4) - offset from this struct to name
      // int nummodels (4)
      // int base (4)
      // int modelindex (4)
      const bodypartOffset = bodypartindex + bodyIdx * 16;
      if (bodypartOffset + 16 > data.length) break;
      
      reader.seek(bodypartOffset);
      const sznameindex = reader.readInt32();
      const nummodels = reader.readInt32();
      reader.skip(4); // base
      const modelindex = reader.readInt32();
      
      // Read body part name
      let bodyPartName = `Body Part ${bodyIdx}`;
      if (sznameindex > 0) {
        const nameOffset = bodypartOffset + sznameindex;
        if (nameOffset < data.length) {
          // Read null-terminated string
          const nameBytes: number[] = [];
          for (let i = 0; i < 64 && nameOffset + i < data.length; i++) {
            const byte = data[nameOffset + i];
            if (byte === 0) break;
            nameBytes.push(byte);
          }
          if (nameBytes.length > 0) {
            bodyPartName = new TextDecoder('utf-8').decode(new Uint8Array(nameBytes));
          }
        }
      }
      
      // Count meshes in this body part by iterating through models
      let totalMeshesInBodyPart = 0;
      const modelBaseOffset = bodypartOffset + modelindex;
      
      for (let modelIdx = 0; modelIdx < nummodels; modelIdx++) {
        const modelStructSize = 148; // mstudiomodel_v8_t approximate size
        const modelOffset = modelBaseOffset + modelIdx * modelStructSize;
        
        if (modelOffset + 80 > data.length) break;
        
        reader.seek(modelOffset + 64); // Skip model name
        reader.skip(4); // unkStringOffset
        reader.skip(4); // type
        reader.skip(4); // boundingradius
        
        const nummeshes = reader.readInt32();
        // Sanity check - mesh count should be reasonable (struct layout may vary by version)
        if (nummeshes > 0 && nummeshes < 100) {
          totalMeshesInBodyPart += nummeshes;
        } else {
          // Fallback: assume 1 mesh per model if we can't parse correctly
          totalMeshesInBodyPart += 1;
        }
      }
      
      // If we couldn't count any meshes, default to 1
      if (totalMeshesInBodyPart === 0) {
        totalMeshesInBodyPart = 1;
      }
      
      bodyParts.push({
        name: bodyPartName,
        numModels: nummodels,
        meshStartIndex: currentMeshIndex,
        meshCount: totalMeshesInBodyPart,
      });
      
      currentMeshIndex += totalMeshesInBodyPart;
      
      console.log(`[parseStudioHeader] Body part ${bodyIdx}: "${bodyPartName}", models: ${nummodels}, meshes: ${totalMeshesInBodyPart}`);
    }
  }

  // Parse skin families
  const skinFamilies: SkinFamily[] = [];
  if (numskinfamilies > 0 && numskinref > 0 && skinindex > 0 && skinindex < data.length) {
    console.log(`[parseStudioHeader] Parsing ${numskinfamilies} skin families with ${numskinref} material refs each, at offset ${skinindex}`);
    
    // Skin table is a 2D array of shorts: [numskinfamilies][numskinref]
    // Each row is a skin, each column is a material slot remapping
    for (let skinIdx = 0; skinIdx < numskinfamilies; skinIdx++) {
      const skinOffset = skinindex + skinIdx * numskinref * 2; // 2 bytes per entry (short)
      
      if (skinOffset + numskinref * 2 > data.length) {
        console.warn(`[parseStudioHeader] Skin ${skinIdx} offset out of bounds`);
        break;
      }
      
      reader.seek(skinOffset);
      const materialRemap: number[] = [];
      
      for (let refIdx = 0; refIdx < numskinref; refIdx++) {
        const matIdx = reader.readInt16();
        materialRemap.push(matIdx);
      }
      
      // Generate skin name
      const skinName = skinIdx === 0 ? 'default' : `skin_${skinIdx}`;
      
      skinFamilies.push({
        name: skinName,
        materialRemap,
      });
      
      console.log(`[parseStudioHeader] Skin ${skinIdx} "${skinName}": [${materialRemap.join(', ')}]`);
    }
  }

  return {
    name,
    version,
    checksum,
    meshCount: meshOffset > 0 ? numbodyparts : 0, // Approximation
    lodCount: 1, // Will be updated from VTX if available
    boneCount: numbones,
    materialCount: numtextures,
    bodyPartCount: numbodyparts,
    attachmentCount: numlocalattachments,
    hitboxSetCount: numhitboxsets,
    hullMin,
    hullMax,
    viewBBMin,
    viewBBMax,
    eyePosition,
    mass,
    flags,
    isStreamed: false,
    starpakOffset: 0,
    materialGUIDs,
    bodyParts: bodyParts.length > 0 ? bodyParts : undefined,
    skinFamilies: skinFamilies.length > 1 ? skinFamilies : undefined, // Only include if more than default skin
    numSkinRef: numskinref,
  };
}

/**
 * Extract mesh-to-material mapping from studiohdr
 * Returns a Map where key is meshid (from VG) and value is materialIndex
 * This maps VG mesh IDs to material indices in the texture/material array
 */
export function extractMeshMaterialMapping(studioData: Uint8Array): Map<number, number> {
  const mapping = new Map<number, number>();
  
  if (!studioData || studioData.length < 200) return mapping;
  
  const reader = new BinaryReader(studioData);
  
  // Check magic
  const id = reader.readUint32();
  if (id !== IDST_MAGIC) return mapping;
  
  const version = reader.readInt32();
  
  // Skip to bodypartindex (offset varies but we read the fields)
  reader.seek(80 + 4); // Skip past name (64 bytes) + length (4 bytes)
  reader.skip(72); // Skip vectors (6 * 12 bytes)
  reader.skip(4);  // flags
  reader.skip(8);  // numbones, boneindex
  reader.skip(8);  // numbonecontrollers, bonecontrollerindex
  reader.skip(8);  // numhitboxsets, hitboxsetindex
  reader.skip(8);  // numlocalanim, localanimindex
  reader.skip(8);  // numlocalseq, localseqindex
  reader.skip(8);  // activitylistversion, materialtypesindex
  reader.skip(8);  // numtextures, textureindex
  reader.skip(8);  // numcdtextures, cdtextureindex
  reader.skip(12); // numskinref, numskinfamilies, skinindex
  
  const numbodyparts = reader.readInt32();
  const bodypartindex = reader.readInt32();
  
  console.log('[extractMeshMaterialMapping] bodyparts:', numbodyparts, 'at offset:', bodypartindex);
  
  if (numbodyparts <= 0 || bodypartindex <= 0 || bodypartindex >= studioData.length) {
    return mapping;
  }
  
  // Parse each bodypart to find meshes and their material indices
  for (let bodyIdx = 0; bodyIdx < numbodyparts; bodyIdx++) {
    // mstudiobodyparts_t structure (v8+):
    // int sznameindex (4)
    // int nummodels (4)
    // int base (4)
    // int modelindex (4)
    const bodypartOffset = bodypartindex + bodyIdx * 16;
    if (bodypartOffset + 16 > studioData.length) break;
    
    reader.seek(bodypartOffset);
    reader.skip(4); // sznameindex
    const nummodels = reader.readInt32();
    reader.skip(4); // base
    const modelindex = reader.readInt32();
    
    console.log(`[extractMeshMaterialMapping] Bodypart ${bodyIdx}: ${nummodels} models, modelindex: ${modelindex}`);
    
    // modelindex is relative to bodypart
    const modelBaseOffset = bodypartOffset + modelindex;
    
    for (let modelIdx = 0; modelIdx < nummodels; modelIdx++) {
      // mstudiomodel_v8_t structure:
      // char name[64]
      // int unkStringOffset (4)
      // int type (4)
      // float boundingradius (4)
      // int nummeshes (4)
      // int meshindex (4)
      // ... more fields
      const modelStructSize = 148; // Approximate size of mstudiomodel_v8_t
      const modelOffset = modelBaseOffset + modelIdx * modelStructSize;
      
      if (modelOffset + 84 > studioData.length) break;
      
      reader.seek(modelOffset + 64); // Skip name
      reader.skip(4); // unkStringOffset
      reader.skip(4); // type
      reader.skip(4); // boundingradius
      
      const nummeshes = reader.readInt32();
      const meshindex = reader.readInt32();
      
      console.log(`[extractMeshMaterialMapping]   Model ${modelIdx}: ${nummeshes} meshes, meshindex: ${meshindex}`);
      
      // meshindex is relative to model
      const meshBaseOffset = modelOffset + meshindex;
      
      for (let meshIdx = 0; meshIdx < nummeshes; meshIdx++) {
        // mstudiomesh_v8_t structure:
        // int material (4) - first field!
        // int modelindex (4)
        // int numvertices (4)
        // int vertexoffset (4)
        // ... more fields including meshid at offset 0x1C
        const meshStructSize = 0x5C; // 92 bytes
        const meshOffset = meshBaseOffset + meshIdx * meshStructSize;
        
        if (meshOffset + 0x20 > studioData.length) break;
        
        reader.seek(meshOffset);
        const materialIndex = reader.readInt32();
        reader.skip(12); // modelindex, numvertices, vertexoffset
        reader.skip(8);  // deprecated_numflexes, deprecated_flexindex
        reader.skip(8);  // deprecated_materialtype, deprecated_materialparam
        const meshid = reader.readInt32(); // at offset 0x1C
        
        console.log(`[extractMeshMaterialMapping]     Mesh ${meshIdx}: meshid=${meshid}, material=${materialIndex}`);
        
        mapping.set(meshid, materialIndex);
      }
    }
  }
  
  console.log('[extractMeshMaterialMapping] Final mapping:', Array.from(mapping.entries()));
  return mapping;
}

/**
 * Parse a model asset header
 * Handles multiple versions based on header size:
 * - v8: 80 bytes (ModelAssetHeader_v8_t)
 * - v9: 120 bytes (ModelAssetHeader_v9_t)
 * - v12_1: 104 bytes (ModelAssetHeader_v12_1_t)
 * - v13: 128 bytes (ModelAssetHeader_v13_t)
 * - v16+: 96 bytes (ModelAssetHeader_v16_t)
 */
export function parseModelHeader(asset: ParsedAsset): Partial<ModelAssetHeader> | null {
  if (!asset.headerData || asset.headerData.length < 64) {
    return null;
  }

  const headerSize = asset.headerData.length;
  const reader = new BinaryReader(asset.headerData);

  // v16+ uses a simplified structure (96 bytes)
  if (headerSize === 96 || asset.version >= 16) {
    return parseModelHeader_v16(reader);
  }
  
  // v13 has bbox fields (128 bytes)
  if (headerSize === 128 || asset.version === 13) {
    return parseModelHeader_v13(reader);
  }
  
  // v12_1 (104 bytes)
  if (headerSize === 104 || asset.version === 12) {
    return parseModelHeader_v12_1(reader);
  }
  
  // v9 (120 bytes)
  if (headerSize === 120 || asset.version === 9) {
    return parseModelHeader_v9(reader);
  }
  
  // v8 (80 bytes) or fallback
  return parseModelHeader_v8(reader);
}

/**
 * Parse v8 model header (oldest format)
 */
function parseModelHeader_v8(reader: BinaryReader): Partial<ModelAssetHeader> {
  // void* data (8 bytes)
  const skeletonPtr: PagePtr = {
    index: reader.readUint32(),
    offset: reader.readUint32(),
  };
  
  // char* name (8 bytes)
  const namePtr: PagePtr = {
    index: reader.readUint32(),
    offset: reader.readUint32(),
  };
  
  reader.skip(8); // unk_10
  
  // void* physics (8 bytes)
  const physicsLODPtr: PagePtr = {
    index: reader.readUint32(),
    offset: reader.readUint32(),
  };
  
  reader.skip(8); // vertexComponentData
  
  // AssetGuid_t* animRigs (8 bytes)
  const animRigPtr = reader.readUint64();
  
  // uint32_t numAnimRigs
  const sequenceGroupCount = reader.readUint32();
  
  reader.skip(8); // componentDataSize + unk_38
  
  // uint32_t numAnimSeqs
  const meshCount = reader.readUint32();
  
  return {
    namePtr,
    skeletonPtr,
    physicsLODPtr,
    animRigPtr,
    sequenceGroupCount,
    meshCount,
    meshesPtr: { index: 0, offset: 0 },
    lodCount: 1,
    permutedMeshCount: 0,
  };
}

/**
 * Parse v9 model header (120 bytes)
 */
function parseModelHeader_v9(reader: BinaryReader): Partial<ModelAssetHeader> {
  // void* data (8 bytes)
  const skeletonPtr: PagePtr = {
    index: reader.readUint32(),
    offset: reader.readUint32(),
  };
  
  reader.skip(8); // void* info
  
  // char* name (8 bytes)
  const namePtr: PagePtr = {
    index: reader.readUint32(),
    offset: reader.readUint32(),
  };
  
  reader.skip(8); // gap_18
  
  // void* physics (8 bytes)
  const physicsLODPtr: PagePtr = {
    index: reader.readUint32(),
    offset: reader.readUint32(),
  };
  
  reader.skip(16); // vertexComponentData + staticStreamingData
  
  // AssetGuid_t* animRigs (8 bytes)
  const animRigPtr = reader.readUint64();
  
  // uint32_t numAnimRigs
  const sequenceGroupCount = reader.readUint32();
  
  reader.skip(24); // componentDataSize + streamingDataSize + unk_4C + unk_54 + unk_5C
  
  // uint32_t numAnimSeqs
  const meshCount = reader.readUint32();
  
  return {
    namePtr,
    skeletonPtr,
    physicsLODPtr,
    animRigPtr,
    sequenceGroupCount,
    meshCount,
    meshesPtr: { index: 0, offset: 0 },
    lodCount: 1,
    permutedMeshCount: 0,
  };
}

/**
 * Parse v12_1 model header (104 bytes)
 */
function parseModelHeader_v12_1(reader: BinaryReader): Partial<ModelAssetHeader> {
  // void* data (8 bytes)
  const skeletonPtr: PagePtr = {
    index: reader.readUint32(),
    offset: reader.readUint32(),
  };
  
  reader.skip(8); // void* info
  
  // char* name (8 bytes)
  const namePtr: PagePtr = {
    index: reader.readUint32(),
    offset: reader.readUint32(),
  };
  
  reader.skip(8); // gap_18
  
  // void* physics (8 bytes)
  const physicsLODPtr: PagePtr = {
    index: reader.readUint32(),
    offset: reader.readUint32(),
  };
  
  reader.skip(16); // vertexComponentData + staticStreamingData
  
  // AssetGuid_t* animRigs (8 bytes)
  const animRigPtr = reader.readUint64();
  
  // uint32_t numAnimRigs
  const sequenceGroupCount = reader.readUint32();
  
  reader.skip(16); // componentDataSize + streamingDataSize + gap_4C
  
  // uint32_t numAnimSeqs
  const meshCount = reader.readUint32();
  
  return {
    namePtr,
    skeletonPtr,
    physicsLODPtr,
    animRigPtr,
    sequenceGroupCount,
    meshCount,
    meshesPtr: { index: 0, offset: 0 },
    lodCount: 1,
    permutedMeshCount: 0,
  };
}

/**
 * Parse v13 model header (128 bytes, adds bbox)
 */
function parseModelHeader_v13(reader: BinaryReader): Partial<ModelAssetHeader> {
  // void* data (8 bytes)
  const skeletonPtr: PagePtr = {
    index: reader.readUint32(),
    offset: reader.readUint32(),
  };
  
  reader.skip(8); // void* info
  
  // char* name (8 bytes)
  const namePtr: PagePtr = {
    index: reader.readUint32(),
    offset: reader.readUint32(),
  };
  
  reader.skip(8); // gap_18
  
  // void* physics (8 bytes)
  const physicsLODPtr: PagePtr = {
    index: reader.readUint32(),
    offset: reader.readUint32(),
  };
  
  reader.skip(16); // vertexComponentData + staticStreamingData
  
  // AssetGuid_t* animRigs (8 bytes)
  const animRigPtr = reader.readUint64();
  
  // uint32_t numAnimRigs
  const sequenceGroupCount = reader.readUint32();
  
  reader.skip(8); // componentDataSize + streamingDataSize
  
  // Skip bbox_min and bbox_max (6 floats = 24 bytes)
  reader.skip(24);
  
  reader.skip(8); // gap_64
  
  // uint32_t numAnimSeqs
  const meshCount = reader.readUint32();
  
  return {
    namePtr,
    skeletonPtr,
    physicsLODPtr,
    animRigPtr,
    sequenceGroupCount,
    meshCount,
    meshesPtr: { index: 0, offset: 0 },
    lodCount: 1,
    permutedMeshCount: 0,
  };
}

/**
 * Parse v16+ model header (96 bytes, simplified)
 */
function parseModelHeader_v16(reader: BinaryReader): Partial<ModelAssetHeader> {
  // void* data (8 bytes)
  const skeletonPtr: PagePtr = {
    index: reader.readUint32(),
    offset: reader.readUint32(),
  };
  
  // char* name (8 bytes)
  const namePtr: PagePtr = {
    index: reader.readUint32(),
    offset: reader.readUint32(),
  };
  
  reader.skip(8); // gap_10
  
  reader.skip(8); // staticStreamingData
  
  // AssetGuid_t* animRigs (8 bytes)
  const animRigPtr = reader.readUint64();
  
  // uint32_t numAnimRigs
  const sequenceGroupCount = reader.readUint32();
  
  reader.skip(4); // streamingDataSize
  
  // Skip bbox_min and bbox_max (6 floats = 24 bytes)
  reader.skip(24);
  
  // uint16_t gap_48, uint16_t numAnimSeqs
  reader.skip(2);
  const meshCount = reader.readUint16();
  
  return {
    namePtr,
    skeletonPtr,
    physicsLODPtr: { index: 0, offset: 0 }, // v16 physics is in CPU data
    animRigPtr,
    sequenceGroupCount,
    meshCount,
    meshesPtr: { index: 0, offset: 0 },
    lodCount: 1,
    permutedMeshCount: 0,
  };
}

/**
 * Compress vertex normal from 3 floats to a packed format
 */
export function packNormal(x: number, y: number, z: number): number {
  // Convert to -1 to 1 range and pack into 10-10-10-2 format
  const nx = Math.round((x * 0.5 + 0.5) * 1023);
  const ny = Math.round((y * 0.5 + 0.5) * 1023);
  const nz = Math.round((z * 0.5 + 0.5) * 1023);
  
  return (nx & 0x3FF) | ((ny & 0x3FF) << 10) | ((nz & 0x3FF) << 20);
}

/**
 * Unpack vertex normal from packed format to 3 floats
 */
export function unpackNormal(packed: number): [number, number, number] {
  const x = ((packed & 0x3FF) / 1023) * 2 - 1;
  const y = (((packed >> 10) & 0x3FF) / 1023) * 2 - 1;
  const z = (((packed >> 20) & 0x3FF) / 1023) * 2 - 1;
  
  return [x, y, z];
}

/**
 * Unpack UV from half-float format
 */
export function unpackHalfFloat(value: number): number {
  const sign = (value & 0x8000) ? -1 : 1;
  const exponent = (value >> 10) & 0x1F;
  const fraction = value & 0x3FF;

  if (exponent === 0) {
    return sign * (fraction / 1024) * Math.pow(2, -14);
  } else if (exponent === 31) {
    return fraction === 0 ? sign * Infinity : NaN;
  }

  return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
}

/**
 * Pack float to half-float format
 */
export function packHalfFloat(value: number): number {
  const floatView = new Float32Array(1);
  floatView[0] = value;
  const intView = new Uint32Array(floatView.buffer);
  const bits = intView[0];

  const sign = (bits >> 31) & 0x1;
  const exponent = (bits >> 23) & 0xFF;
  const mantissa = bits & 0x7FFFFF;

  if (exponent === 0) {
    return sign << 15;
  } else if (exponent === 255) {
    return (sign << 15) | 0x7C00 | (mantissa ? 0x200 : 0);
  }

  const newExponent = exponent - 127 + 15;
  
  if (newExponent <= 0) {
    return sign << 15;
  } else if (newExponent >= 31) {
    return (sign << 15) | 0x7C00;
  }

  return (sign << 15) | (newExponent << 10) | (mantissa >> 13);
}

/**
 * Create a simple OBJ file from model data
 */
export function exportModelToOBJ(model: ParsedModel): string {
  if (!model.vertices || !model.indices) {
    return '# No mesh data available\n';
  }

  let obj = `# RSX Electron Model Export\n`;
  obj += `# Model: ${model.name}\n`;
  obj += `# Meshes: ${model.meshCount}, LODs: ${model.lodCount}\n\n`;

  // Write vertices
  for (const vertex of model.vertices) {
    obj += `v ${vertex.position[0]} ${vertex.position[1]} ${vertex.position[2]}\n`;
  }

  obj += '\n';

  // Write normals
  for (const vertex of model.vertices) {
    obj += `vn ${vertex.normal[0]} ${vertex.normal[1]} ${vertex.normal[2]}\n`;
  }

  obj += '\n';

  // Write UVs - flip V for OBJ format (expects OpenGL convention)
  for (const vertex of model.vertices) {
    obj += `vt ${vertex.uv[0]} ${1 - vertex.uv[1]}\n`;
  }

  obj += '\n';

  // Write faces (triangles, 1-indexed)
  for (let i = 0; i < model.indices.length; i += 3) {
    const i0 = model.indices[i] + 1;
    const i1 = model.indices[i + 1] + 1;
    const i2 = model.indices[i + 2] + 1;
    obj += `f ${i0}/${i0}/${i0} ${i1}/${i1}/${i1} ${i2}/${i2}/${i2}\n`;
  }

  return obj;
}

/**
 * Create a GLTF file from model data
 */
export function exportModelToGLTF(model: ParsedModel): object {
  if (!model.vertices || !model.indices) {
    return { error: 'No mesh data available' };
  }

  // Build GLTF structure
  const gltf: any = {
    asset: {
      version: '2.0',
      generator: 'RSX Electron',
    },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{
      name: model.name,
      mesh: 0,
    }],
    meshes: [{
      name: model.name,
      primitives: [{
        attributes: {
          POSITION: 0,
          NORMAL: 1,
          TEXCOORD_0: 2,
        },
        indices: 3,
        mode: 4, // TRIANGLES
      }],
    }],
    accessors: [],
    bufferViews: [],
    buffers: [],
  };

  // Build binary buffer
  const vertexCount = model.vertices.length;
  const indexCount = model.indices.length;
  
  const positionSize = vertexCount * 12; // 3 floats * 4 bytes
  const normalSize = vertexCount * 12;
  const uvSize = vertexCount * 8; // 2 floats * 4 bytes
  const indexSize = indexCount * 4; // uint32
  
  const totalSize = positionSize + normalSize + uvSize + indexSize;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  
  let offset = 0;

  // Write positions
  const posMin = [Infinity, Infinity, Infinity];
  const posMax = [-Infinity, -Infinity, -Infinity];
  
  for (const vertex of model.vertices) {
    view.setFloat32(offset, vertex.position[0], true); offset += 4;
    view.setFloat32(offset, vertex.position[1], true); offset += 4;
    view.setFloat32(offset, vertex.position[2], true); offset += 4;
    
    posMin[0] = Math.min(posMin[0], vertex.position[0]);
    posMin[1] = Math.min(posMin[1], vertex.position[1]);
    posMin[2] = Math.min(posMin[2], vertex.position[2]);
    posMax[0] = Math.max(posMax[0], vertex.position[0]);
    posMax[1] = Math.max(posMax[1], vertex.position[1]);
    posMax[2] = Math.max(posMax[2], vertex.position[2]);
  }

  // Write normals
  for (const vertex of model.vertices) {
    view.setFloat32(offset, vertex.normal[0], true); offset += 4;
    view.setFloat32(offset, vertex.normal[1], true); offset += 4;
    view.setFloat32(offset, vertex.normal[2], true); offset += 4;
  }

  // Write UVs
  for (const vertex of model.vertices) {
    view.setFloat32(offset, vertex.uv[0], true); offset += 4;
    view.setFloat32(offset, vertex.uv[1], true); offset += 4;
  }

  // Write indices
  for (const index of model.indices) {
    view.setUint32(offset, index, true); offset += 4;
  }

  // Add buffer views
  let viewOffset = 0;
  
  gltf.bufferViews.push({
    buffer: 0,
    byteOffset: viewOffset,
    byteLength: positionSize,
    target: 34962, // ARRAY_BUFFER
  });
  viewOffset += positionSize;

  gltf.bufferViews.push({
    buffer: 0,
    byteOffset: viewOffset,
    byteLength: normalSize,
    target: 34962,
  });
  viewOffset += normalSize;

  gltf.bufferViews.push({
    buffer: 0,
    byteOffset: viewOffset,
    byteLength: uvSize,
    target: 34962,
  });
  viewOffset += uvSize;

  gltf.bufferViews.push({
    buffer: 0,
    byteOffset: viewOffset,
    byteLength: indexSize,
    target: 34963, // ELEMENT_ARRAY_BUFFER
  });

  // Add accessors
  gltf.accessors = [
    {
      bufferView: 0,
      componentType: 5126, // FLOAT
      count: vertexCount,
      type: 'VEC3',
      min: posMin,
      max: posMax,
    },
    {
      bufferView: 1,
      componentType: 5126,
      count: vertexCount,
      type: 'VEC3',
    },
    {
      bufferView: 2,
      componentType: 5126,
      count: vertexCount,
      type: 'VEC2',
    },
    {
      bufferView: 3,
      componentType: 5125, // UNSIGNED_INT
      count: indexCount,
      type: 'SCALAR',
    },
  ];

  // Add buffer (base64 encoded)
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  gltf.buffers = [{
    byteLength: totalSize,
    uri: `data:application/octet-stream;base64,${base64}`,
  }];

  return gltf;
}

// ============================================================================
// MESH PARSING - VTX & VVD Data
// ============================================================================

/**
 * VVD Vertex structure (48 bytes)
 */
interface VVDVertex {
  boneWeights: number[];  // 3 floats
  boneIndices: number[];  // 3 bytes
  numBones: number;
  position: [number, number, number];
  normal: [number, number, number];
  uv: [number, number];
}

/**
 * Submesh data - represents a portion of the mesh with a specific material
 */
export interface SubMesh {
  materialIndex: number;  // Index into ParsedModel.materialGUIDs
  indexStart: number;     // Start index in the indices array
  indexCount: number;     // Number of indices for this submesh
  bodyPartIndex?: number; // Optional body part index for visibility toggling
}

/**
 * Parsed mesh data ready for rendering
 */
export interface MeshGeometry {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  indexCount: number;
  submeshes?: SubMesh[];  // Optional submesh info for multi-material models
}

/**
 * Extended model info with mesh data
 */
export interface ParsedModelWithMesh extends ParsedModel {
  geometry?: MeshGeometry;
  vtxOffset?: number;
  vvdOffset?: number;
  vtxSize?: number;
  vvdSize?: number;
}

/**
 * Parse studiohdr to get VTX/VVD offsets
 * These offsets point into the vertexComponentData buffer
 * The offset location varies by studiohdr version:
 * - v8 (studiohdr version ~8): offset 0x3C0
 * - v12.1+ (studiohdr version ~12): different layout
 * - v54+ (studiohdr version 54): uses streaming, no embedded offsets
 */
export function parseStudioHeaderExtended(data: Uint8Array): ParsedModelWithMesh | null {
  const baseModel = parseStudioHeader(data);
  if (!baseModel) return null;

  const reader = new BinaryReader(data);
  const result: ParsedModelWithMesh = { ...baseModel };

  // studiohdr version is at offset 4 (after magic)
  // Different versions have different layouts for vtxOffset/vvdOffset
  const studioVersion = baseModel.version;
  
  // For newer models (v54+), vertex data is typically streamed from starpak
  // The vtxOffset/vvdOffset fields may not be present or valid
  if (studioVersion >= 54) {
    console.log('[parseStudioHeaderExtended] v54+ model - likely uses streaming vertex data');
    // These models typically don't have embedded VTX/VVD
    return result;
  }
  
  // Try different known offsets based on version
  // v8 models: offset 0x3C0
  // v12+ models: offset varies
  const offsetCandidates = [
    0x3C0,  // v8
    0x3B0,  // v12.1
    0x3A0,  // alternative
  ];
  
  for (const offset of offsetCandidates) {
    if (data.length <= offset + 32) continue;
    
    reader.seek(offset);
    const vtxOffset = reader.readInt32();
    const vvdOffset = reader.readInt32();
    reader.skip(8); // vvcOffset, phyOffset
    const vtxSize = reader.readInt32();
    const vvdSize = reader.readInt32();
    
    // Validate the offsets make sense:
    // - vtxSize and vvdSize should be positive and reasonable
    // - offsets should be non-negative
    if (vtxOffset >= 0 && vvdOffset >= 0 && 
        vtxSize > 0 && vtxSize < 10000000 && 
        vvdSize > 0 && vvdSize < 100000000) {
      result.vtxOffset = vtxOffset;
      result.vvdOffset = vvdOffset;
      result.vtxSize = vtxSize;
      result.vvdSize = vvdSize;
      
      console.log(`[parseStudioHeaderExtended] Found valid offsets at 0x${offset.toString(16)}:`, {
        vtxOffset,
        vvdOffset,
        vtxSize,
        vvdSize,
      });
      break;
    }
  }

  return result;
}

/**
 * Find VVD (IDSV) magic in data buffer
 * Returns the offset where VVD data starts, or -1 if not found
 */
function findVVDMagic(data: Uint8Array): number {
  // IDSV = 0x56534449 in little-endian (bytes: 49 44 53 56)
  const magic = [0x49, 0x44, 0x53, 0x56];
  for (let i = 0; i < data.length - 4; i += 4) { // Aligned search
    if (data[i] === magic[0] && data[i+1] === magic[1] && 
        data[i+2] === magic[2] && data[i+3] === magic[3]) {
      return i;
    }
  }
  return -1;
}

/**
 * Find VTX (OptimizedModel v7) in data buffer
 * VTX starts with version number 7 (0x07 0x00 0x00 0x00)
 * Returns the offset where VTX data starts, or -1 if not found
 */
function findVTXStart(data: Uint8Array): number {
  // VTX version 7 = 0x00000007 in little-endian
  // But just "7" isn't unique enough - VTX header structure:
  // version (4), vertCacheSize (4), maxBonesPerStrip (2), maxBonesPerFace (2), maxBonesPerVert (4)
  // Looking for version=7 followed by reasonable values
  
  for (let i = 0; i < data.length - 36; i += 4) {
    const reader = new BinaryReader(data);
    reader.seek(i);
    
    const version = reader.readInt32();
    if (version !== 7) continue;
    
    const vertCacheSize = reader.readInt32();
    const maxBonesPerStrip = reader.readUint16();
    const maxBonesPerFace = reader.readUint16();
    const maxBonesPerVert = reader.readInt32();
    const checkSum = reader.readInt32();
    const numLODs = reader.readInt32();
    
    // Validate these make sense for a VTX header
    if (vertCacheSize >= 0 && vertCacheSize <= 1000 &&
        maxBonesPerStrip >= 0 && maxBonesPerStrip <= 255 &&
        maxBonesPerFace >= 0 && maxBonesPerFace <= 255 &&
        maxBonesPerVert >= 0 && maxBonesPerVert <= 255 &&
        numLODs >= 1 && numLODs <= 8) {
      return i;
    }
  }
  return -1;
}

/**
 * Parse VVD (Vertex Data) file
 */
function parseVVD(data: Uint8Array, offset: number, size: number): VVDVertex[] | null {
  if (offset < 0 || offset + 36 > data.length) {
    console.log('[parseVVD] Invalid offset:', offset);
    return null;
  }

  const reader = new BinaryReader(data);
  reader.seek(offset);

  const id = reader.readUint32();
  if (id !== IDSV_MAGIC) {
    console.log('[parseVVD] Invalid VVD magic:', id.toString(16));
    return null;
  }

  const version = reader.readInt32();
  const checksum = reader.readInt32();
  const numLODs = reader.readInt32();

  // numLODVertexes array (8 entries)
  const numLODVertexes: number[] = [];
  for (let i = 0; i < 8; i++) {
    numLODVertexes.push(reader.readInt32());
  }

  const numFixups = reader.readInt32();
  const fixupTableStart = reader.readInt32();
  const vertexDataStart = reader.readInt32();
  const tangentDataStart = reader.readInt32();

  console.log('[parseVVD] Header:', {
    version,
    numLODs,
    numLODVertexes: numLODVertexes[0],
    vertexDataStart,
  });

  // Read vertices for LOD 0
  const vertexCount = numLODVertexes[0];
  if (vertexCount <= 0 || vertexCount > 100000) {
    console.log('[parseVVD] Invalid vertex count:', vertexCount);
    return null;
  }

  const vertices: VVDVertex[] = [];
  const vertexStart = offset + vertexDataStart;

  // mstudiovertex_t is 48 bytes:
  // - mstudioboneweight_t (16 bytes): weight[3] (12 bytes as floats) + bone[3] (3 bytes) + numbones (1 byte)
  // - position (12 bytes): Vector
  // - normal (12 bytes): Vector  
  // - texcoord (8 bytes): Vector2D
  const VERTEX_SIZE = 48;

  for (let i = 0; i < vertexCount; i++) {
    const vertOffset = vertexStart + i * VERTEX_SIZE;
    if (vertOffset + VERTEX_SIZE > data.length) break;

    reader.seek(vertOffset);

    // Bone weights (3 floats)
    const boneWeights = [
      reader.readFloat32(),
      reader.readFloat32(),
      reader.readFloat32(),
    ];

    // Bone indices (3 bytes) + numBones (1 byte)
    const boneIndices = [
      reader.readUint8(),
      reader.readUint8(),
      reader.readUint8(),
    ];
    const numBones = reader.readUint8();

    // Position
    const position: [number, number, number] = [
      reader.readFloat32(),
      reader.readFloat32(),
      reader.readFloat32(),
    ];

    // Normal
    const normal: [number, number, number] = [
      reader.readFloat32(),
      reader.readFloat32(),
      reader.readFloat32(),
    ];

    // UV
    const uv: [number, number] = [
      reader.readFloat32(),
      reader.readFloat32(),
    ];

    vertices.push({
      boneWeights,
      boneIndices,
      numBones,
      position,
      normal,
      uv,
    });
  }

  console.log('[parseVVD] Parsed', vertices.length, 'vertices');
  return vertices;
}

/**
 * Parse VTX (OptimizedModel) to get indices
 */
function parseVTX(data: Uint8Array, offset: number, size: number): number[] | null {
  if (offset < 0 || offset + 36 > data.length) {
    console.log('[parseVTX] Invalid offset:', offset);
    return null;
  }

  const reader = new BinaryReader(data);
  reader.seek(offset);

  const version = reader.readInt32();
  if (version !== VTX_VERSION) {
    console.log('[parseVTX] Invalid VTX version:', version);
    return null;
  }

  const vertCacheSize = reader.readInt32();
  const maxBonesPerStrip = reader.readUint16();
  const maxBonesPerFace = reader.readUint16();
  const maxBonesPerVert = reader.readInt32();
  const checkSum = reader.readInt32();
  const numLODs = reader.readInt32();
  const materialReplacementListOffset = reader.readInt32();
  const numBodyParts = reader.readInt32();
  const bodyPartOffset = reader.readInt32();

  console.log('[parseVTX] Header:', {
    version,
    numLODs,
    numBodyParts,
    bodyPartOffset,
  });

  if (numBodyParts <= 0 || numBodyParts > 100) {
    console.log('[parseVTX] Invalid body part count');
    return null;
  }

  const allIndices: number[] = [];

  // Parse body parts -> models -> LODs -> meshes -> strip groups -> strips -> indices
  for (let bpIdx = 0; bpIdx < numBodyParts; bpIdx++) {
    const bodyPartStart = offset + bodyPartOffset + bpIdx * 8;
    reader.seek(bodyPartStart);

    const numModels = reader.readInt32();
    const modelOffset = reader.readInt32();

    for (let modelIdx = 0; modelIdx < numModels; modelIdx++) {
      const modelStart = bodyPartStart + modelOffset + modelIdx * 8;
      reader.seek(modelStart);

      const numModelLODs = reader.readInt32();
      const lodOffset = reader.readInt32();

      // Only parse LOD 0 for preview
      if (numModelLODs > 0) {
        const lodStart = modelStart + lodOffset;
        reader.seek(lodStart);

        const numMeshes = reader.readInt32();
        const meshOffset = reader.readInt32();
        const switchPoint = reader.readFloat32();

        for (let meshIdx = 0; meshIdx < numMeshes; meshIdx++) {
          const meshStart = lodStart + meshOffset + meshIdx * 9;
          reader.seek(meshStart);

          const numStripGroups = reader.readInt32();
          const stripGroupHeaderOffset = reader.readInt32();
          const meshFlags = reader.readUint8();

          for (let sgIdx = 0; sgIdx < numStripGroups; sgIdx++) {
            // StripGroupHeader_t is 0x21 bytes
            const sgStart = meshStart + stripGroupHeaderOffset + sgIdx * 0x21;
            reader.seek(sgStart);

            const numVerts = reader.readInt32();
            const vertOffset = reader.readInt32();
            const numIndices = reader.readInt32();
            const indexOffset = reader.readInt32();
            const numStrips = reader.readInt32();
            const stripOffset = reader.readInt32();
            const sgFlags = reader.readUint8();

            // Read indices
            const indexStart = sgStart + indexOffset;
            for (let i = 0; i < numIndices; i++) {
              reader.seek(indexStart + i * 2);
              const localIndex = reader.readUint16();

              // Get the original vertex ID from the VTX vertex
              // Vertex_t is 9 bytes
              const vtxVertOffset = sgStart + vertOffset + localIndex * 9;
              reader.seek(vtxVertOffset + 4); // Skip boneWeightIndex[3] + numBones
              const origMeshVertID = reader.readUint16();

              allIndices.push(origMeshVertID);
            }
          }
        }
      }
    }
  }

  console.log('[parseVTX] Parsed', allIndices.length, 'indices');
  return allIndices;
}

// VG (VertexGroup) format structures for streamed data
interface VGMeshHeader {
  flags: bigint;
  vertOffset: number;
  vertCacheSize: number;
  vertCount: number;
  indexOffset: number;
  indexCount: number;
}

interface VGLODHeader {
  meshIndex: number;
  meshCount: number;
  switchPoint: number;
}

interface VGHeader {
  id: number;
  version: number;
  dataSize: number;
  meshOffset: bigint;
  meshCount: bigint;
  indexOffset: bigint;
  indexCount: bigint;
  vertOffset: bigint;
  vertCount: bigint;
  lodOffset: bigint;
  lodCount: bigint;
}

/**
 * Parse VG (VertexGroup) format data from starpak
 * This is used for models v9+ that stream their vertex data
 */
/**
 * Unpack Vector64 format used in VG models
 * x: 21 bits, y: 21 bits, z: 22 bits
 * Formula: value = (packed * 0.0009765625) - offset
 * where offset is 1024 for x/y and 2048 for z
 */
function unpackVector64(packed: bigint): [number, number, number] {
  const SCALE = 0.0009765625; // 1/1024
  const x = Number(packed & 0x1FFFFFn) * SCALE - 1024.0;
  const y = Number((packed >> 21n) & 0x1FFFFFn) * SCALE - 1024.0;
  const z = Number((packed >> 42n) & 0x3FFFFFn) * SCALE - 2048.0;
  return [x, y, z];
}

/**
 * Calculate vertex component offsets based on mesh flags
 * Returns the offset to each component within a vertex
 * Based on C++ ParseVertexFromVG in modeldata.cpp
 */
function getVertexLayout(flags: bigint): { positionSize: number; colorOffset: number; normalOffset: number; uvOffset: number } {
  const posType = Number(flags & 0x3n);
  let offset = 0;
  
  // Position size based on type (0=none, 1=unpacked 12bytes, 2=packed64 8bytes, 3=packed48 6bytes)
  let positionSize = 0;
  if (posType === 1) positionSize = 12; // Unpacked float32 x3
  else if (posType === 2) positionSize = 8; // Packed Vector64
  else if (posType === 3) positionSize = 6; // Packed 48-bit
  offset += positionSize;
  
  // Blend weights + indices together (8 bytes when present)
  // VERT_BLENDINDICES = 0x1000, VERT_BLENDWEIGHTS_PACKED = 0x4000
  if (flags & (0x1000n | 0x4000n)) {
    offset += 8; // BlendWeightsPacked_s (4) + BlendWeightIndices_s (4)
  }
  
  // Normal is ALWAYS present and ALWAYS 4 bytes (packed Normal32)
  // The C++ code unconditionally reads the normal at this offset
  const normalOffset = offset;
  offset += 4; // Normal32
  
  // Color - flag 0x10
  const colorOffset = (flags & 0x10n) ? offset : -1;
  if (flags & 0x10n) offset += 4;
  
  // UV is after normal + color
  const uvOffset = offset;
  
  return { positionSize, colorOffset, normalOffset, uvOffset };
}

/**
 * Parse VG format mesh data
 * @param vgData The VG data buffer
 * @param meshMaterialMapping Optional mapping from meshid to material index (from studiohdr)
 * @param bodyParts Optional body part info for assigning submeshes to body parts
 */
export function parseVGFormat(vgData: Uint8Array, meshMaterialMapping?: Map<number, number>, bodyParts?: BodyPart[]): MeshGeometry | null {
  if (!vgData || vgData.length < 128) {
    console.log('[parseVGFormat] Data too small');
    return null;
  }

  const reader = new BinaryReader(vgData);

  // Read VG header
  const id = reader.readUint32();
  if (id !== VG_MAGIC) {
    console.log(`[parseVGFormat] Invalid VG magic: 0x${id.toString(16)} (expected 0x${VG_MAGIC.toString(16)})`);
    return null;
  }

  const version = reader.readInt32();
  const unk = reader.readInt32();
  const dataSize = reader.readInt32();

  // Bone state change
  const boneStateChangeOffset = reader.readUint64();
  const boneStateChangeCount = reader.readUint64();

  // Mesh info
  const meshOffset = reader.readUint64();
  const meshCount = reader.readUint64();

  // Index buffer
  const indexOffset = reader.readUint64();
  const indexCount = reader.readUint64();

  // Vertex buffer  
  const vertOffset = reader.readUint64();
  const vertCount = reader.readUint64();

  // Extra bone weights
  const extraBoneWeightOffset = reader.readUint64();
  const extraBoneWeightSize = reader.readUint64();

  // Unknown
  const unknownOffset = reader.readUint64();
  const unknownCount = reader.readUint64();

  // LOD info
  const lodOffset = reader.readUint64();
  const lodCount = reader.readUint64();

  // Legacy weights
  const legacyWeightOffset = reader.readUint64();
  const legacyWeightCount = reader.readUint64();

  // Strips
  const stripOffset = reader.readUint64();
  const stripCount = reader.readUint64();

  console.log('[parseVGFormat] VG Header:', {
    id: `0x${id.toString(16)}`,
    version,
    dataSize,
    meshCount: Number(meshCount),
    indexCount: Number(indexCount),
    vertCount: Number(vertCount),
    lodCount: Number(lodCount),
  });

  if (Number(lodCount) === 0 || Number(meshCount) === 0) {
    console.log('[parseVGFormat] No LODs or meshes');
    return null;
  }

  // Read LOD 0 info
  reader.seek(Number(lodOffset));
  const lod0MeshIndex = reader.readUint16();
  const lod0MeshCount = reader.readUint16();
  const lod0SwitchPoint = reader.readFloat32();

  console.log('[parseVGFormat] LOD 0:', { 
    meshIndex: lod0MeshIndex, 
    meshCount: lod0MeshCount,
    switchPoint: lod0SwitchPoint,
  });

  // Collect all vertices and indices from all meshes in LOD 0
  const allPositions: number[] = [];
  const allNormals: number[] = [];
  const allUVs: number[] = [];
  const allIndices: number[] = [];
  const submeshes: SubMesh[] = [];
  let globalVertexOffset = 0;
  let globalIndexOffset = 0;

  for (let meshIdx = 0; meshIdx < lod0MeshCount; meshIdx++) {
    // MeshHeader_t is 0x48 bytes in rev1
    const meshHeaderOffset = Number(meshOffset) + (lod0MeshIndex + meshIdx) * 0x48;
    reader.seek(meshHeaderOffset);

    const meshFlags = reader.readUint64();
    const meshVertOffset = reader.readUint32();
    const meshVertCacheSize = reader.readUint32();
    const meshVertCount = reader.readUint32();
    reader.skip(4); // unk_14
    const meshExtraBoneWeightOffset = reader.readInt32();
    const meshExtraBoneWeightSize = reader.readInt32();
    const meshIndexOffset = reader.readInt32();
    const meshIndexCount = reader.readInt32();

    // Decode texcoord format from flags (bits 24-27)
    const texcoordFmt = Number((meshFlags >> 24n) & 0xFn);
    console.log(`[parseVGFormat] Mesh ${meshIdx}:`, {
      flags: `0x${meshFlags.toString(16)}`,
      vertOffset: meshVertOffset,
      vertCacheSize: meshVertCacheSize,
      vertCount: meshVertCount,
      indexOffset: meshIndexOffset,
      indexCount: meshIndexCount,
      texcoordFormat: texcoordFmt,
    });

    if (meshVertCount === 0 || meshIndexCount === 0) continue;

    // Get vertex layout based on flags
    const layout = getVertexLayout(meshFlags);
    const posType = Number(meshFlags & 0x3n);
    const hasPackedNormal = Boolean(meshFlags & 0x200n);
    const hasUnpackedNormal = Boolean(meshFlags & 0x100n);
    
    // Parse vertices for this mesh
    const vertexStart = Number(vertOffset) + meshVertOffset;
    
    for (let v = 0; v < meshVertCount; v++) {
      const vOffset = vertexStart + v * meshVertCacheSize;
      reader.seek(vOffset);

      let px: number, py: number, pz: number;
      
      if (posType === 0) {
        // No position
        px = py = pz = 0;
      } else if (posType === 1) {
        // Unpacked float32 position (12 bytes)
        px = reader.readFloat32();
        py = reader.readFloat32();
        pz = reader.readFloat32();
      } else if (posType === 2) {
        // Packed Vector64 (8 bytes) - 21:21:22 bits
        const packed = reader.readUint64();
        [px, py, pz] = unpackVector64(packed);
      } else {
        // posType === 3: Packed 48-bit (6 bytes)
        const low = reader.readUint32();
        const high = reader.readUint16();
        const packed = BigInt(low) | (BigInt(high) << 32n);
        const ix = Number(packed & 0xFFFFn);
        const iy = Number((packed >> 16n) & 0xFFFFn);
        const iz = Number((packed >> 32n) & 0xFFFFn);
        px = (ix / 65535.0) * 2048.0 - 1024.0;
        py = (iy / 65535.0) * 2048.0 - 1024.0;
        pz = (iz / 65535.0) * 4096.0 - 2048.0;
      }

      allPositions.push(px, py, pz);
      
      // Read normal if present
      if (hasPackedNormal) {
        reader.seek(vOffset + layout.normalOffset);
        const packedNorm = reader.readUint32();
        // Unpack 10-10-10-2 format
        const nx = ((packedNorm >> 0) & 0x3FF) / 511.5 - 1.0;
        const ny = ((packedNorm >> 10) & 0x3FF) / 511.5 - 1.0;
        const nz = ((packedNorm >> 20) & 0x3FF) / 511.5 - 1.0;
        allNormals.push(nx, ny, nz);
      } else if (hasUnpackedNormal) {
        reader.seek(vOffset + layout.normalOffset);
        const nx = reader.readFloat32();
        const ny = reader.readFloat32();
        const nz = reader.readFloat32();
        allNormals.push(nx, ny, nz);
      } else {
        allNormals.push(0, 1, 0); // Default up
      }

      // UV - read from uvOffset if we have texcoords
      // Check if we have texcoord0 (bits 24-27) - the value is the format type
      // Format sizes from magic number 0x48A31A20:
      //   Format 0: 0 bytes (no UV)
      //   Format 1: 4 bytes (half-float x2)
      //   Format 2: 8 bytes (float32 x2 = Vector2D)
      //   Format 3: 16 bytes (float32 x4)
      const texcoordFormat = Number((meshFlags >> 24n) & 0xFn);
      if (texcoordFormat > 0 && layout.uvOffset < meshVertCacheSize) {
        reader.seek(vOffset + layout.uvOffset);
        
        let u = 0, v = 0;
        if (texcoordFormat === 1) {
          // Half-float x2 (4 bytes)
          const uHalf = reader.readUint16();
          const vHalf = reader.readUint16();
          u = unpackHalfFloat(uHalf);
          v = unpackHalfFloat(vHalf);
        } else if (texcoordFormat === 2) {
          // Float32 x2 (8 bytes) - Vector2D
          u = reader.readFloat32();
          v = reader.readFloat32();
        } else if (texcoordFormat === 3) {
          // Float32 x4 (16 bytes) - only use first 2
          u = reader.readFloat32();
          v = reader.readFloat32();
          // Skip remaining 8 bytes
        }
        
        // Keep UV coordinates as-is from the file (DirectX convention: V=0 at top)
        // The texture flipY=true setting in THREE.js handles the coordinate conversion
        allUVs.push(u, v);
      } else {
        allUVs.push(0, 0);
      }
    }

    // Parse indices for this mesh
    // Index offset is the INDEX into the index buffer, not byte offset
    const indexStart = Number(indexOffset) + meshIndexOffset * 2;
    for (let i = 0; i < meshIndexCount; i++) {
      reader.seek(indexStart + i * 2);
      const idx = reader.readUint16();
      allIndices.push(idx + globalVertexOffset);
    }

    // Track submesh for material assignment
    // Use meshMaterialMapping if available to get correct material index from studiohdr
    // Otherwise fall back to using meshIdx as material index
    const materialIdx = meshMaterialMapping?.get(meshIdx) ?? meshIdx;
    
    // Find which body part this mesh belongs to
    let bodyPartIdx: number | undefined = undefined;
    if (bodyParts) {
      for (let bpIdx = 0; bpIdx < bodyParts.length; bpIdx++) {
        const bp = bodyParts[bpIdx];
        const globalMeshIdx = lod0MeshIndex + meshIdx;
        if (globalMeshIdx >= bp.meshStartIndex && globalMeshIdx < bp.meshStartIndex + bp.meshCount) {
          bodyPartIdx = bpIdx;
          break;
        }
      }
    }

    submeshes.push({
      materialIndex: materialIdx,
      indexStart: globalIndexOffset,
      indexCount: meshIndexCount,
      bodyPartIndex: bodyPartIdx,
    });

    globalVertexOffset += meshVertCount;
    globalIndexOffset += meshIndexCount;
  }

  if (allPositions.length === 0 || allIndices.length === 0) {
    console.log('[parseVGFormat] No geometry parsed');
    return null;
  }

  console.log('[parseVGFormat] Parsed geometry:', {
    vertices: allPositions.length / 3,
    indices: allIndices.length,
    submeshCount: submeshes.length,
    submeshDetails: submeshes.map(sm => ({
      materialIndex: sm.materialIndex,
      indexStart: sm.indexStart,
      indexCount: sm.indexCount,
      bodyPartIndex: sm.bodyPartIndex,
    })),
  });

  return {
    positions: new Float32Array(allPositions),
    normals: new Float32Array(allNormals),
    uvs: new Float32Array(allUVs),
    indices: new Uint32Array(allIndices),
    vertexCount: allPositions.length / 3,
    indexCount: allIndices.length,
    submeshes,
  };
}

/**
 * Parse mesh geometry from studiohdr + vertexComponentData
 */
export function parseMeshGeometry(
  studioData: Uint8Array,
  vertexComponentData: Uint8Array
): MeshGeometry | null {
  const modelInfo = parseStudioHeaderExtended(studioData);
  if (!modelInfo) {
    console.log('[parseMeshGeometry] Failed to parse studio header');
    return null;
  }

  console.log('[parseMeshGeometry] Model info:', {
    name: modelInfo.name,
    vtxOffset: modelInfo.vtxOffset,
    vvdOffset: modelInfo.vvdOffset,
    vtxSize: modelInfo.vtxSize,
    vvdSize: modelInfo.vvdSize,
  });

  // Determine VVD and VTX offsets
  let vvdOffset = modelInfo.vvdOffset;
  let vtxOffset = modelInfo.vtxOffset;
  
  // If offsets from header seem invalid, try to find them by magic
  if (!vvdOffset || vvdOffset <= 0 || vvdOffset >= vertexComponentData.length) {
    console.log('[parseMeshGeometry] Searching for VVD by magic...');
    vvdOffset = findVVDMagic(vertexComponentData);
    if (vvdOffset >= 0) {
      console.log('[parseMeshGeometry] Found VVD magic at offset:', vvdOffset);
    }
  }
  
  if (!vtxOffset || vtxOffset <= 0 || vtxOffset >= vertexComponentData.length) {
    console.log('[parseMeshGeometry] Searching for VTX by magic...');
    vtxOffset = findVTXStart(vertexComponentData);
    if (vtxOffset >= 0) {
      console.log('[parseMeshGeometry] Found VTX at offset:', vtxOffset);
    }
  }

  // Check if we have valid offsets
  if (vvdOffset < 0 || vtxOffset < 0) {
    console.log('[parseMeshGeometry] Could not find VTX/VVD data');
    return null;
  }

  // Parse VVD (vertices)
  const vertices = parseVVD(
    vertexComponentData,
    vvdOffset,
    modelInfo.vvdSize || 0
  );

  if (!vertices || vertices.length === 0) {
    console.log('[parseMeshGeometry] Failed to parse VVD');
    return null;
  }

  // Parse VTX (indices)
  const indices = parseVTX(
    vertexComponentData,
    vtxOffset,
    modelInfo.vtxSize || 0
  );

  if (!indices || indices.length === 0) {
    console.log('[parseMeshGeometry] Failed to parse VTX');
    return null;
  }

  // Build geometry arrays
  const positions = new Float32Array(vertices.length * 3);
  const normals = new Float32Array(vertices.length * 3);
  const uvs = new Float32Array(vertices.length * 2);

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    positions[i * 3] = v.position[0];
    positions[i * 3 + 1] = v.position[1];
    positions[i * 3 + 2] = v.position[2];

    normals[i * 3] = v.normal[0];
    normals[i * 3 + 1] = v.normal[1];
    normals[i * 3 + 2] = v.normal[2];

    uvs[i * 2] = v.uv[0];
    // Don't flip V here - texture flipY handles UV orientation
    uvs[i * 2 + 1] = v.uv[1];
  }

  return {
    positions,
    normals,
    uvs,
    indices: new Uint32Array(indices),
    vertexCount: vertices.length,
    indexCount: indices.length,
  };
}
