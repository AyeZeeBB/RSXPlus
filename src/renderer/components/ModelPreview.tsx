import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { Asset } from '../types/asset';
import { parseStudioHeader, ParsedModel, parseMeshGeometry, MeshGeometry, parseVGFormat, SubMesh, extractMeshMaterialMapping, BodyPart, SkinFamily } from '../parsers/modelParser';
import { loadModelStreamingData } from '../parsers/fileLoader';
import { useAssetStore } from '../stores/assetStore';
import { useSettingsStore } from '../stores/settingsStore';
import { parseMaterialAsset, ParsedMaterialData, MaterialTextureEntry, TextureBindingNames, MaterialShaderType } from '../parsers/materialParser';
import { decodeTextureToRGBA, TextureFormat, CompressionType } from '../parsers/textureParser';
import { loadTextureMipFromStarpak } from '../parsers/starpakLoader';
import { decompress as zstdDecompress } from 'fzstd';
import { decompressRTech } from '../utils/rtechDecompress';
import { decompressOodle } from '../utils/oodleDecompress';
import './ModelPreview.css';

/**
 * Calculate normal Z from X and Y components
 * Based on RSX's GetNormalZFromXY function
 */
function getNormalZFromXY(x: number, y: number): number {
  const xm = (2.0 * x) - 1.0;
  const ym = (2.0 * y) - 1.0;
  
  const a = 1.0 - (xm * xm) - (ym * ym);
  
  if (a < 0.0) {
    return 0.5;
  }
  
  const sq = Math.sqrt(a);
  return (sq / 2.0) + 0.5;
}

/**
 * Convert Source/Respawn BC5 normal map to standard format with reconstructed Z channel
 */
function convertNormalMap(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const output = new Uint8Array(rgba.length);
  
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];     // X component
    const g = rgba[i + 1]; // Y component
    
    const x = r / 255.0;
    const y = g / 255.0;
    const z = getNormalZFromXY(x, y);
    
    output[i] = r;
    output[i + 1] = g;
    output[i + 2] = Math.round(z * 255);
    output[i + 3] = 255;
  }
  
  return output;
}

// Material info for display
interface LoadedMaterialInfo {
  material: THREE.Material;
  name: string;
  isPlaceholder: boolean;
}

interface ModelPreviewProps {
  asset: Asset;
}

/**
 * Convert Uint8Array-like object back to Uint8Array
 * Data may be serialized through React state as plain object
 */
function ensureUint8Array(data: unknown): Uint8Array | undefined {
  if (!data) return undefined;
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array((data as ArrayBufferView).buffer);
  if (Array.isArray(data)) return new Uint8Array(data);
  if (typeof data === 'object') {
    const values = Object.values(data as Record<string, number>);
    return new Uint8Array(values);
  }
  return undefined;
}

export const ModelPreview: React.FC<ModelPreviewProps> = ({ asset }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [modelInfo, setModelInfo] = useState<ParsedModel | null>(null);
  const [meshGeometry, setMeshGeometry] = useState<MeshGeometry | null>(null);
  const [showWireframe, setShowWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showBounds, setShowBounds] = useState(true);
  const [showMesh, setShowMesh] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [showMaterials, setShowMaterials] = useState(true);
  
  // Body group visibility - maps body part index to visibility state
  const [bodyGroupVisibility, setBodyGroupVisibility] = useState<Map<number, boolean>>(new Map());
  
  // Skin selection
  const [selectedSkin, setSelectedSkin] = useState(0);
  
  // Material state - map GUID to material info (includes name for display)
  const [loadedMaterials, setLoadedMaterials] = useState<Map<string, LoadedMaterialInfo>>(new Map());
  const [materialsLoading, setMaterialsLoading] = useState(false);
  
  // Asset store for looking up materials
  const { assets, getTextureData, getParser } = useAssetStore();
  
  // Settings store for render mode
  const { settings } = useSettingsStore();
  
  // Parse model header and mesh data when asset changes
  useEffect(() => {
    const loadModelData = async () => {
      if (!asset.metadata) {
        setModelInfo(null);
        setMeshGeometry(null);
        return;
      }
      
      // Get studio header data
      const dataPageData = ensureUint8Array(asset.metadata.dataPageData);
      
      // Get vertex component data (VTX, VVD) - for embedded data
      const vertexData = ensureUint8Array(asset.metadata.vertexComponentData);
      
      // Get starpak offset for streaming data
      const starpakOffset = asset.metadata.starpakOffset;
      
      if (dataPageData && dataPageData.length > 0) {
        // Get the asset version from metadata (RPak asset version, not MDL version)
        const assetVersion = (asset.metadata.version as number) || 9;
        
        const parsed = parseStudioHeader(dataPageData, assetVersion);
        if (parsed) {
          setModelInfo(parsed);
          
          // Initialize body group visibility - all visible by default
          if (parsed.bodyParts && parsed.bodyParts.length > 0) {
            const visibility = new Map<number, boolean>();
            parsed.bodyParts.forEach((_, idx) => visibility.set(idx, true));
            setBodyGroupVisibility(visibility);
          } else {
            setBodyGroupVisibility(new Map());
          }
          
          // Reset skin selection
          setSelectedSkin(0);
          
          // Try to get mesh geometry
          let geometry: MeshGeometry | null = null;
          
          // First try: embedded vertex data (v8 models)
          if (vertexData && vertexData.length > 0) {
            geometry = parseMeshGeometry(dataPageData, vertexData);
          }
          
          // Second try: streaming data from starpak (v9+ models)
          if (!geometry && starpakOffset) {
            const offset = BigInt(starpakOffset as any);
            if (offset !== 0n && offset !== -1n) {
              try {
                const streamingData = await loadModelStreamingData(offset);
                if (streamingData && streamingData.length > 0) {
                  // Extract mesh-to-material mapping from studiohdr
                  const meshMaterialMapping = extractMeshMaterialMapping(dataPageData);
                  
                  // Parse VG format with material mapping and body parts
                  geometry = parseVGFormat(streamingData, meshMaterialMapping, parsed.bodyParts);
                }
              } catch {
                // Failed to load streaming data
              }
            }
          }
          
          setMeshGeometry(geometry);
        } else {
          setModelInfo(null);
          setMeshGeometry(null);
        }
      } else {
        setModelInfo(null);
        setMeshGeometry(null);
      }
    };
    
    loadModelData();
  }, [asset]);

  // Load materials for the model
  useEffect(() => {
    if (!modelInfo || !modelInfo.materialGUIDs || modelInfo.materialGUIDs.length === 0) {
      setLoadedMaterials(new Map());
      return;
    }
    
    const loadMaterials = async () => {
      setMaterialsLoading(true);
      const materials = new Map<string, LoadedMaterialInfo>();
      
      // Build lookup maps for O(1) asset access
      const materialLookup = new Map<bigint, typeof assets[0]>();
      const textureLookup = new Map<bigint, typeof assets[0]>();
      for (const asset of assets) {
        try {
          const assetGuid = BigInt('0x' + asset.guid);
          if (asset.type === 'matl') {
            materialLookup.set(assetGuid, asset);
          } else if (asset.type === 'txtr') {
            textureLookup.set(assetGuid, asset);
          }
        } catch { /* skip invalid guids */ }
      }
      
      for (let i = 0; i < modelInfo.materialGUIDs.length; i++) {
        const guid = modelInfo.materialGUIDs[i];
        const guidHex = '0x' + guid.toString(16).toUpperCase().padStart(16, '0');
        
        // O(1) lookup instead of linear search
        const materialAsset = materialLookup.get(guid);
        
        if (!materialAsset) {
          // Create default material for missing materials
          const colors = [0x4488cc, 0x88cc44, 0xcc8844, 0x8844cc, 0xcc4488, 0x44cc88];
          const defaultMat = new THREE.MeshBasicMaterial({
            color: colors[i % colors.length],
            side: THREE.DoubleSide,
          });
          materials.set(guidHex, {
            material: defaultMat,
            name: `Unknown (${guidHex})`,
            isPlaceholder: true,
          });
          continue;
        }
        
        // Extract material name from asset name (use last part of path)
        const materialName = materialAsset.name?.split('/').pop() || materialAsset.name || guidHex;
        
        try {
          // Get parser for material's container file
          const parser = getParser(materialAsset.containerFile);
          if (!parser) continue;
          
          // Get header data from metadata
          let headerData = materialAsset.metadata?.headerData as Uint8Array | undefined;
          if (!headerData) continue;
          
          // Convert headerData to Uint8Array if needed
          if (!(headerData instanceof Uint8Array)) {
            if (Array.isArray(headerData)) {
              headerData = new Uint8Array(headerData);
            } else if (typeof headerData === 'object') {
              const values = Object.values(headerData as Record<string, number>);
              headerData = new Uint8Array(values);
            }
          }
          
          const metadata = materialAsset.metadata || {};
          
          // Parse material to get texture references
          const materialData = parseMaterialAsset({
            headerData,
            guid: materialAsset.guid,
            type: 0,
            typeFourCC: 'matl',
            typeName: 'Material',
            version: (metadata.version as number) || 15,
            name: materialAsset.name,
            headerSize: headerData.length,
            headPagePtr: (metadata.headPagePtr as { index: number; offset: number }) || { index: 0, offset: 0 },
            dataPagePtr: (metadata.dataPagePtr as { index: number; offset: number }) || { index: 0, offset: 0 },
            starpakOffset: 0n,
            optStarpakOffset: 0n,
            pageEnd: 0,
            dependentsCount: 0,
            dependenciesCount: 0,
          }, (pageIndex: number) => parser.getPageData(pageIndex));
          
          if (!materialData) continue;
          
          // Determine the correct material type based on shader type and render settings
          const shaderType = materialData.header.materialType;
          const isParticle = shaderType === MaterialShaderType.PTCU || shaderType === MaterialShaderType.PTCS;
          const isUnlit = isParticle; // Particles are typically unlit
          
          // Check if we should use albedo-only mode from settings
          const useAlbedoOnly = settings.modelRenderMode === 'albedo';
          
          // Create appropriate Three.js material based on shader type and settings
          let threeMat: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
          
          if (isUnlit || useAlbedoOnly) {
            // Use unlit material for particles, effects, or when albedo-only mode is enabled
            threeMat = new THREE.MeshBasicMaterial({
              color: 0xffffff,
              side: THREE.DoubleSide,
              transparent: true,
            });
          } else {
            // Use PBR material for standard lit materials (skinned, static, world)
            threeMat = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              side: THREE.DoubleSide,
              roughness: 0.5,
              metalness: 0.0,
            });
          }
          
          // Helper function to load a texture from a material entry
          const loadTextureFromEntry = async (entry: MaterialTextureEntry): Promise<{rgba: Uint8Array, width: number, height: number, format: TextureFormat} | null> => {
            if (!entry || !entry.guid || entry.guid === 0n) return null;
            
            // O(1) lookup from pre-built map
            const textureAsset = textureLookup.get(entry.guid);
            if (!textureAsset) return null;
            
            try {
              const textureData = await getTextureData(textureAsset);
              if (!textureData) return null;

              const { header, pixelData, starpakOffset, optStarpakOffset } = textureData;
              
              let finalPixelData = pixelData;
              let mipLevel = header.streamedMipCount + header.optStreamedMipCount;
              let mipWidth = Math.max(1, header.width >> mipLevel);
              let mipHeight = Math.max(1, header.height >> mipLevel);
              
              const texRpakPath = textureAsset.containerFile;
              const texRpakBasePath = texRpakPath ? texRpakPath.substring(0, Math.max(texRpakPath.lastIndexOf('/'), texRpakPath.lastIndexOf('\\'))) : undefined;
              
              const hasStarpak = starpakOffset && starpakOffset !== 0n && starpakOffset !== 0xFFFFFFFFFFFFFFFFn;
              const hasOptStarpak = optStarpakOffset && optStarpakOffset !== 0n && optStarpakOffset !== 0xFFFFFFFFFFFFFFFFn;
              
              if (hasOptStarpak || hasStarpak) {
                const targetMip = 0;
                const isOpt = hasOptStarpak && targetMip < header.optStreamedMipCount;
                const offset = isOpt ? optStarpakOffset : starpakOffset;
                
                try {
                  const starpakResult = await loadTextureMipFromStarpak(
                    offset!,
                    targetMip,
                    {
                      width: header.width,
                      height: header.height,
                      format: header.format,
                      mipCount: header.mipCount,
                      optStreamedMipCount: header.optStreamedMipCount,
                      streamedMipCount: header.streamedMipCount,
                      compTypePacked: header.compTypePacked,
                      compressedBytes: header.compressedBytes,
                    },
                    isOpt,
                    texRpakBasePath
                  );
                  
                  if (starpakResult) {
                    let decompressedData = starpakResult.data;
                    
                    if (starpakResult.compressed) {
                      if (starpakResult.compressionType === CompressionType.PAKFILE) {
                        try {
                          decompressedData = decompressRTech(starpakResult.data);
                        } catch {
                        }
                      } else if (starpakResult.compressionType === CompressionType.OODLE) {
                        try {
                          const oodleResult = await decompressOodle(starpakResult.data, mipWidth * mipHeight * 4);
                          if (oodleResult) {
                            decompressedData = oodleResult;
                          }
                        } catch {
                        }
                      }
                    }
                    
                    finalPixelData = decompressedData;
                    mipLevel = targetMip;
                    mipWidth = Math.max(1, header.width >> targetMip);
                    mipHeight = Math.max(1, header.height >> targetMip);
                  }
                } catch (starpakErr) {
                  // Use permanent mip
                }
              }
              
              if (!finalPixelData || finalPixelData.length === 0) return null;

              const rgba = decodeTextureToRGBA(finalPixelData, mipWidth, mipHeight, header.format);
              if (!rgba || rgba.length === 0) return null;
              
              return { rgba, width: mipWidth, height: mipHeight, format: header.format };
            } catch (e) {
              return null;
            }
          };
          
          // Load all texture slots based on binding names
          for (const texEntry of materialData.textures) {
            // Use the resourceBindingName from the shader, or fall back to default mapping
            const bindingName = (texEntry.resourceBindingName || TextureBindingNames[texEntry.index] || `slot${texEntry.index}`).toLowerCase();
            
            console.log(`[ModelPreview] Texture entry ${texEntry.index}: bindingName="${bindingName}", guid=${texEntry.guidHex}`);
            
            const textureResult = await loadTextureFromEntry(texEntry);
            if (!textureResult) continue;
            
            const { rgba, width, height, format } = textureResult;
            
            // Create Three.js DataTexture
            const threeTexture = new THREE.DataTexture(
              rgba,
              width,
              height,
              THREE.RGBAFormat,
              THREE.UnsignedByteType
            );
            threeTexture.needsUpdate = true;
            threeTexture.flipY = true; // Flip texture to match DirectX UV convention from Source engine
            threeTexture.wrapS = THREE.RepeatWrapping;
            threeTexture.wrapT = THREE.RepeatWrapping;
            threeTexture.magFilter = THREE.LinearFilter;
            threeTexture.minFilter = THREE.LinearMipmapLinearFilter;
            threeTexture.generateMipmaps = true;
            
            // Apply texture to appropriate material slot based on binding name
            // Note: MeshBasicMaterial only supports map, alphaMap, envMap, aoMap
            // MeshStandardMaterial supports all PBR maps
            const isPBRMaterial = threeMat instanceof THREE.MeshStandardMaterial;
            
            if (bindingName.includes('emis') || bindingName.includes('emit') || bindingName.includes('ilm') || bindingName.includes('selfillum')) {
              threeTexture.colorSpace = THREE.SRGBColorSpace;
              if (isPBRMaterial) {
                (threeMat as THREE.MeshStandardMaterial).emissiveMap = threeTexture;
                (threeMat as THREE.MeshStandardMaterial).emissive.setHex(0xffffff);
                (threeMat as THREE.MeshStandardMaterial).emissiveIntensity = 1.0;
              } else {
                // For unlit materials, use emissive as albedo (since it's self-illuminated)
                threeMat.map = threeTexture;
              }
            } else if (bindingName.includes('color') || bindingName.includes('albedo') || bindingName.includes('diffuse')) {
              threeTexture.colorSpace = THREE.SRGBColorSpace;
              threeMat.map = threeTexture;
              threeMat.color.setHex(0xffffff);
            } else if (bindingName.includes('normal') || bindingName.includes('nml')) {
              // Normal maps only work with PBR materials
              if (isPBRMaterial) {
                // Convert normal map format
                const convertedNormal = convertNormalMap(rgba, width, height);
                const normalTexture = new THREE.DataTexture(
                  convertedNormal,
                  width,
                  height,
                  THREE.RGBAFormat,
                  THREE.UnsignedByteType
                );
                normalTexture.needsUpdate = true;
                normalTexture.flipY = true;
                normalTexture.wrapS = THREE.RepeatWrapping;
                normalTexture.wrapT = THREE.RepeatWrapping;
                normalTexture.magFilter = THREE.LinearFilter;
                normalTexture.minFilter = THREE.LinearMipmapLinearFilter;
                normalTexture.generateMipmaps = true;
                normalTexture.colorSpace = THREE.NoColorSpace;
                (threeMat as THREE.MeshStandardMaterial).normalMap = normalTexture;
                (threeMat as THREE.MeshStandardMaterial).normalScale.set(1, 1);
              }
            } else if (bindingName.includes('gloss') || bindingName.includes('rough')) {
              // Roughness maps only work with PBR materials
              if (isPBRMaterial) {
                threeTexture.colorSpace = THREE.NoColorSpace;
                (threeMat as THREE.MeshStandardMaterial).roughnessMap = threeTexture;
                (threeMat as THREE.MeshStandardMaterial).roughness = 1.0;
              }
            } else if (bindingName.includes('spec') || bindingName.includes('metal')) {
              // Metalness maps only work with PBR materials
              if (isPBRMaterial) {
                threeTexture.colorSpace = THREE.NoColorSpace;
                (threeMat as THREE.MeshStandardMaterial).metalnessMap = threeTexture;
                (threeMat as THREE.MeshStandardMaterial).metalness = 1.0;
              }
            } else if (bindingName.includes('ao') || bindingName.includes('occlusion')) {
              threeTexture.colorSpace = THREE.NoColorSpace;
              threeMat.aoMap = threeTexture;
            } else if (bindingName.includes('cavity')) {
              threeTexture.colorSpace = THREE.NoColorSpace;
              if (!threeMat.aoMap) {
                threeMat.aoMap = threeTexture;
              }
            } else if (bindingName.includes('opacity') || bindingName.includes('alpha')) {
              threeTexture.colorSpace = THREE.NoColorSpace;
              threeMat.alphaMap = threeTexture;
              threeMat.transparent = true;
            } else if (texEntry.index === 0 && !threeMat.map) {
              // First texture as albedo fallback
              threeTexture.colorSpace = THREE.SRGBColorSpace;
              threeMat.map = threeTexture;
              threeMat.color.setHex(0xffffff);
            }
          }
          
          threeMat.needsUpdate = true;
          materials.set(guidHex, {
            material: threeMat,
            name: materialName,
            isPlaceholder: false,
          });
          
        } catch {
          // Failed to process material
        }
      }
      
      setLoadedMaterials(materials);
      setMaterialsLoading(false);
    };
    
    loadMaterials();
  }, [modelInfo, assets, getTextureData, getParser, settings.modelRenderMode]);

  // Three.js setup
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    // Camera
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    
    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // Lights - much stronger lighting for PBR materials
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    // Main key light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(5, 8, 5);
    scene.add(directionalLight);

    // Fill light from left
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
    fillLight.position.set(-5, 3, 5);
    scene.add(fillLight);

    // Back/rim light
    const backLight = new THREE.DirectionalLight(0x8888ff, 0.5);
    backLight.position.set(-5, 3, -5);
    scene.add(backLight);
    
    // Bottom light to reduce harsh shadows
    const bottomLight = new THREE.DirectionalLight(0xffffff, 0.3);
    bottomLight.position.set(0, -5, 0);
    scene.add(bottomLight);
    
    // Hemisphere light for natural sky/ground color
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
    scene.add(hemiLight);

    // Grid helper
    const gridHelper = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
    gridHelper.visible = showGrid;
    scene.add(gridHelper);

    // Objects to track for visibility toggle
    let boundingBox: THREE.LineSegments | null = null;
    let hullBox: THREE.Mesh | null = null;
    let modelMesh: THREE.Mesh | null = null;
    let modelWireframe: THREE.LineSegments | null = null;
    // Track per-body-part meshes for visibility toggling
    const bodyPartMeshes: Map<number, THREE.Mesh[]> = new Map();
    let target = new THREE.Vector3(0, 0.5, 0);
    let cameraDistance = 3;
    
    // Try to create mesh from geometry data
    if (meshGeometry && meshGeometry.vertexCount > 0 && meshGeometry.indexCount > 0) {
      
      // Convert Source engine coordinates (Z-up) to Three.js (Y-up)
      // Source: X=right, Y=forward, Z=up
      // Three.js: X=right, Y=up, Z=forward
      const positions = new Float32Array(meshGeometry.positions.length);
      const normals = new Float32Array(meshGeometry.normals.length);
      
      for (let i = 0; i < meshGeometry.vertexCount; i++) {
        const srcX = meshGeometry.positions[i * 3];
        const srcY = meshGeometry.positions[i * 3 + 1];
        const srcZ = meshGeometry.positions[i * 3 + 2];
        positions[i * 3] = srcX;
        positions[i * 3 + 1] = srcZ;
        positions[i * 3 + 2] = -srcY;
        
        const nrmX = meshGeometry.normals[i * 3];
        const nrmY = meshGeometry.normals[i * 3 + 1];
        const nrmZ = meshGeometry.normals[i * 3 + 2];
        normals[i * 3] = nrmX;
        normals[i * 3 + 1] = nrmZ;
        normals[i * 3 + 2] = -nrmY;
      }
      
      // Build materials array with skin remapping
      let materials: THREE.Material[] = [];
      
      // Get skin remap if available
      const skinRemap = modelInfo?.skinFamilies?.[selectedSkin]?.materialRemap;
      
      console.log('[ModelPreview] Building materials array:', {
        showMaterials,
        loadedMaterialsSize: loadedMaterials.size,
        materialGUIDsCount: modelInfo?.materialGUIDs?.length,
        loadedMaterialKeys: Array.from(loadedMaterials.keys()),
        skinRemap,
      });
      
      if (showMaterials && loadedMaterials.size > 0 && modelInfo?.materialGUIDs) {
        for (let i = 0; i < modelInfo.materialGUIDs.length; i++) {
          // Apply skin remap: the remap tells us which material GUID to use for slot i
          const remappedIdx = skinRemap ? skinRemap[i] ?? i : i;
          const guid = modelInfo.materialGUIDs[remappedIdx] ?? modelInfo.materialGUIDs[i];
          const guidHex = '0x' + guid.toString(16).toUpperCase().padStart(16, '0');
          const matInfo = loadedMaterials.get(guidHex);
          
          console.log(`[ModelPreview] Material ${i}: guid=${guidHex}, found=${!!matInfo}, hasMap=${!!(matInfo?.material as any)?.map}`);
          
          if (matInfo) {
            materials.push(matInfo.material);
          } else {
            const defaultMat = new THREE.MeshBasicMaterial({
              color: 0x888888 + (i * 0x222222 % 0x666666),
              side: THREE.DoubleSide,
            });
            materials.push(defaultMat);
          }
        }
      }
      
      console.log('[ModelPreview] Final materials array length:', materials.length);
      
      // Fall back to single material if none loaded
      if (materials.length === 0) {
        materials.push(new THREE.MeshBasicMaterial({
          color: 0x8888aa,
          side: THREE.DoubleSide,
        }));
      }
      
      // Check if we have body parts with submesh assignments
      const hasBodyParts = modelInfo?.bodyParts && modelInfo.bodyParts.length > 0 && 
                          meshGeometry.submeshes?.some(sm => sm.bodyPartIndex !== undefined);
      
      if (hasBodyParts && meshGeometry.submeshes) {
        // Create separate meshes per body part for visibility toggling
        
        // Group submeshes by body part
        const submeshesByBodyPart = new Map<number, SubMesh[]>();
        for (const submesh of meshGeometry.submeshes) {
          const bpIdx = submesh.bodyPartIndex ?? 0;
          if (!submeshesByBodyPart.has(bpIdx)) {
            submeshesByBodyPart.set(bpIdx, []);
          }
          submeshesByBodyPart.get(bpIdx)!.push(submesh);
        }
        
        // Create a mesh for each body part
        for (const [bpIdx, submeshes] of submeshesByBodyPart.entries()) {
          // Create geometry with shared vertex buffer but separate index buffer
          const bpGeometry = new THREE.BufferGeometry();
          bpGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          bpGeometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
          bpGeometry.setAttribute('uv', new THREE.BufferAttribute(meshGeometry.uvs, 2));
          
          // Collect indices for all submeshes in this body part
          const bpIndices: number[] = [];
          const bpGroups: { start: number; count: number; materialIndex: number }[] = [];
          
          for (const submesh of submeshes) {
            const groupStart = bpIndices.length;
            // Copy indices from original index buffer
            for (let i = 0; i < submesh.indexCount; i++) {
              bpIndices.push(meshGeometry.indices[submesh.indexStart + i]);
            }
            bpGroups.push({
              start: groupStart,
              count: submesh.indexCount,
              materialIndex: submesh.materialIndex,
            });
          }
          
          bpGeometry.setIndex(new THREE.BufferAttribute(new Uint32Array(bpIndices), 1));
          
          // Add groups for multi-material
          for (const group of bpGroups) {
            bpGeometry.addGroup(group.start, group.count, group.materialIndex);
          }
          
          const bpMesh = new THREE.Mesh(bpGeometry, materials.length === 1 ? materials[0] : materials);
          bpMesh.visible = showMesh && (bodyGroupVisibility.get(bpIdx) ?? true);
          scene.add(bpMesh);
          
          if (!bodyPartMeshes.has(bpIdx)) {
            bodyPartMeshes.set(bpIdx, []);
          }
          bodyPartMeshes.get(bpIdx)!.push(bpMesh);
        }
        
        // Compute bounding box from all meshes
        const bbox = new THREE.Box3();
        bodyPartMeshes.forEach(meshes => {
          meshes.forEach(mesh => {
            mesh.geometry.computeBoundingBox();
            if (mesh.geometry.boundingBox) {
              bbox.union(mesh.geometry.boundingBox);
            }
          });
        });
        
        target = new THREE.Vector3();
        bbox.getCenter(target);
        
        const size = new THREE.Vector3();
        bbox.getSize(size);
        cameraDistance = Math.max(size.x, size.y, size.z, 1) * 1.8;
      } else {
        // Single mesh for all geometry (no body parts or old behavior)
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(meshGeometry.uvs, 2));
        geometry.setIndex(new THREE.BufferAttribute(meshGeometry.indices, 1));
        
        if (meshGeometry.submeshes) {
          console.log('[ModelPreview] Adding geometry groups:', meshGeometry.submeshes.map(sm => ({
            start: sm.indexStart,
            count: sm.indexCount,
            materialIndex: sm.materialIndex,
          })));
          for (const submesh of meshGeometry.submeshes) {
            geometry.addGroup(submesh.indexStart, submesh.indexCount, submesh.materialIndex);
          }
        }
        
        geometry.computeBoundingBox();
        const bbox = geometry.boundingBox!;
        
        modelMesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
        modelMesh.visible = showMesh;
        scene.add(modelMesh);
        
        target = new THREE.Vector3();
        bbox.getCenter(target);
        
        const size = new THREE.Vector3();
        bbox.getSize(size);
        cameraDistance = Math.max(size.x, size.y, size.z, 1) * 1.8;
      }
      
      // Create wireframe overlay (covers all geometry)
      const fullGeometry = new THREE.BufferGeometry();
      fullGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      fullGeometry.setIndex(new THREE.BufferAttribute(meshGeometry.indices, 1));
      
      const wireframeMaterial = new THREE.LineBasicMaterial({ 
        color: 0x6366f1,
        linewidth: 1,
      });
      const wireframeGeometry = new THREE.WireframeGeometry(fullGeometry);
      modelWireframe = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
      modelWireframe.visible = showWireframe;
      scene.add(modelWireframe);
      
      camera.position.set(
        target.x + cameraDistance * 0.7, 
        target.y + cameraDistance * 0.5, 
        target.z + cameraDistance * 0.7
      );
      camera.lookAt(target);
    }
    // Create bounding box visualization from model info
    else if (modelInfo) {
      // Calculate box dimensions from hull bounds
      const min = new THREE.Vector3(modelInfo.hullMin[0], modelInfo.hullMin[1], modelInfo.hullMin[2]);
      const max = new THREE.Vector3(modelInfo.hullMax[0], modelInfo.hullMax[1], modelInfo.hullMax[2]);
      
      // Source engine coordinate system: Z is up, Y is forward
      // Three.js: Y is up, Z is forward
      // Swap Y and Z for visualization
      const threeMin = new THREE.Vector3(min.x, min.z, -min.y);
      const threeMax = new THREE.Vector3(max.x, max.z, -max.y);
      
      // Ensure min/max are correct order
      const actualMin = new THREE.Vector3(
        Math.min(threeMin.x, threeMax.x),
        Math.min(threeMin.y, threeMax.y),
        Math.min(threeMin.z, threeMax.z)
      );
      const actualMax = new THREE.Vector3(
        Math.max(threeMin.x, threeMax.x),
        Math.max(threeMin.y, threeMax.y),
        Math.max(threeMin.z, threeMax.z)
      );
      
      // Calculate dimensions
      let width = actualMax.x - actualMin.x;
      let height = actualMax.y - actualMin.y;
      let depth = actualMax.z - actualMin.z;
      
      // If bounds are zero or very small, use default size
      const minSize = 0.1;
      if (width < minSize && height < minSize && depth < minSize) {
        width = 1;
        height = 1;
        depth = 1;
      }
      
      // Create bounding box helper
      const boxGeometry = new THREE.BoxGeometry(
        Math.max(width, 0.01),
        Math.max(height, 0.01),
        Math.max(depth, 0.01)
      );
      
      // Position at center of bounds
      target = new THREE.Vector3(
        (actualMin.x + actualMax.x) / 2,
        (actualMin.y + actualMax.y) / 2,
        (actualMin.z + actualMax.z) / 2
      );
      
      // Wireframe box
      const edges = new THREE.EdgesGeometry(boxGeometry);
      const lineMaterial = new THREE.LineBasicMaterial({ 
        color: 0x6366f1,
        linewidth: 2,
      });
      boundingBox = new THREE.LineSegments(edges, lineMaterial);
      boundingBox.position.copy(target);
      boundingBox.visible = showBounds;
      scene.add(boundingBox);
      
      // Semi-transparent fill
      const fillMaterial = new THREE.MeshBasicMaterial({
        color: 0x6366f1,
        transparent: true,
        opacity: 0.15,
      });
      hullBox = new THREE.Mesh(boxGeometry, fillMaterial);
      hullBox.position.copy(target);
      hullBox.visible = showBounds;
      scene.add(hullBox);
      
      // Position camera based on model size
      const size = Math.max(width, height, depth, 1);
      cameraDistance = size * 2.5;
      camera.position.set(cameraDistance * 0.7, cameraDistance * 0.5, cameraDistance * 0.7);
      camera.lookAt(target);
      
      // Eye position indicator (if available)
      if (modelInfo.eyePosition && (modelInfo.eyePosition[0] !== 0 || modelInfo.eyePosition[1] !== 0 || modelInfo.eyePosition[2] !== 0)) {
        const eyeGeometry = new THREE.SphereGeometry(0.05 * size, 16, 16);
        const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x22c55e });
        const eyeSphere = new THREE.Mesh(eyeGeometry, eyeMaterial);
        eyeSphere.position.set(
          modelInfo.eyePosition[0],
          modelInfo.eyePosition[2],
          -modelInfo.eyePosition[1]
        );
        scene.add(eyeSphere);
      }
    } else {
      // Default placeholder cube when no model info
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshStandardMaterial({ 
        color: 0x6366f1,
        metalness: 0.3,
        roughness: 0.7,
      });
      const cube = new THREE.Mesh(geometry, material);
      cube.position.y = 0.5;
      scene.add(cube);
      target = new THREE.Vector3(0, 0.5, 0);
      cameraDistance = 3;
      camera.position.set(2, 1.5, 2);
      camera.lookAt(target);
    }

    // Camera controls - orbit (left drag), pan (right/middle drag), zoom (scroll)
    let isDragging = false;
    let isPanning = false;
    let previousMousePosition = { x: 0, y: 0 };
    let spherical = { 
      theta: Math.PI / 4, 
      phi: Math.PI / 3, 
      radius: cameraDistance
    };
    const initialTarget = target.clone();
    const initialSpherical = { ...spherical };

    const updateCameraPosition = () => {
      camera.position.x = target.x + spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta);
      camera.position.y = target.y + spherical.radius * Math.cos(spherical.phi);
      camera.position.z = target.z + spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta);
      camera.lookAt(target);
    };

    // Reset camera to initial position
    const resetCamera = () => {
      target.copy(initialTarget);
      spherical.theta = initialSpherical.theta;
      spherical.phi = initialSpherical.phi;
      spherical.radius = initialSpherical.radius;
      updateCameraPosition();
    };

    // Expose reset function globally on the container
    (container as any)._resetCamera = resetCamera;

    const handleMouseDown = (e: MouseEvent) => {
      // Right-click or middle-click for pan
      if (e.button === 2 || e.button === 1) {
        isPanning = true;
        isDragging = false;
      } else if (e.button === 0) {
        // Left-click for orbit
        isDragging = true;
        isPanning = false;
      }
      previousMousePosition = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging && !isPanning) return;

      const deltaX = e.clientX - previousMousePosition.x;
      const deltaY = e.clientY - previousMousePosition.y;

      if (isPanning) {
        // Pan - move the target point
        const panSpeed = spherical.radius * 0.002;
        
        // Get camera's right and up vectors for panning in screen space
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();
        camera.getWorldDirection(up);
        right.crossVectors(up, camera.up).normalize();
        up.crossVectors(right, up.negate()).normalize();
        
        // Move target based on mouse movement
        target.addScaledVector(right, -deltaX * panSpeed);
        target.addScaledVector(up, deltaY * panSpeed);
      } else if (isDragging) {
        // Orbit
        const rotateSpeed = 0.008;
        spherical.theta -= deltaX * rotateSpeed;
        spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi + deltaY * rotateSpeed));
      }

      updateCameraPosition();
      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
      isDragging = false;
      isPanning = false;
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Smooth zoom with better sensitivity
      const zoomSpeed = spherical.radius * 0.001;
      const delta = e.deltaY * zoomSpeed;
      spherical.radius = Math.max(0.1, Math.min(100, spherical.radius + delta));
      updateCameraPosition();
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault(); // Prevent right-click menu
    };

    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('mouseleave', handleMouseUp);
    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('contextmenu', handleContextMenu);

    // Animation loop
    let animationId: number;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      
      if (autoRotate && !isDragging) {
        spherical.theta += 0.003;
        updateCameraPosition();
      }
      
      // Update visibility based on state
      gridHelper.visible = showGrid;
      if (boundingBox) boundingBox.visible = showBounds;
      if (hullBox) hullBox.visible = showBounds;
      if (modelMesh) modelMesh.visible = showMesh;
      if (modelWireframe) modelWireframe.visible = showWireframe;
      
      // Update body part mesh visibility
      bodyPartMeshes.forEach((meshes, bpIdx) => {
        const isVisible = showMesh && (bodyGroupVisibility.get(bpIdx) ?? true);
        meshes.forEach(mesh => {
          mesh.visible = isVisible;
        });
      });
      
      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const handleResize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // Cleanup
    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('mouseleave', handleMouseUp);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('contextmenu', handleContextMenu);
      delete (container as any)._resetCamera;
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [modelInfo, meshGeometry, showGrid, showBounds, showMesh, showWireframe, autoRotate, showMaterials, loadedMaterials, bodyGroupVisibility, selectedSkin]);

  const formatVector = (v: [number, number, number]) => 
    `(${v[0].toFixed(2)}, ${v[1].toFixed(2)}, ${v[2].toFixed(2)})`;

  return (
    <div className="model-preview">
      <div className="model-preview-viewport" ref={containerRef}>
        <div className="model-preview-controls">
          <button 
            className={`control-btn ${showGrid ? 'active' : ''}`}
            onClick={() => setShowGrid(!showGrid)}
            title="Toggle Grid"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3h18v18H3V3z" />
              <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
            </svg>
          </button>
          <button 
            className={`control-btn ${showBounds ? 'active' : ''}`}
            onClick={() => setShowBounds(!showBounds)}
            title="Toggle Bounds"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            </svg>
          </button>
          {meshGeometry && (
            <>
              <button 
                className={`control-btn ${showMesh ? 'active' : ''}`}
                onClick={() => setShowMesh(!showMesh)}
                title="Toggle Mesh"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 2 7 12 12 22 7 12 2" />
                  <polyline points="2 17 12 22 22 17" />
                  <polyline points="2 12 12 17 22 12" />
                </svg>
              </button>
              <button 
                className={`control-btn ${showWireframe ? 'active' : ''}`}
                onClick={() => setShowWireframe(!showWireframe)}
                title="Toggle Wireframe"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 7v10l10 5V12L2 7z" />
                  <path d="M22 7v10l-10 5V12l10-5z" />
                </svg>
              </button>
              <button 
                className={`control-btn ${showMaterials ? 'active' : ''} ${materialsLoading ? 'loading' : ''}`}
                onClick={() => setShowMaterials(!showMaterials)}
                title={materialsLoading ? 'Loading materials...' : 'Toggle Materials'}
                disabled={loadedMaterials.size === 0}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 2a10 10 0 0 1 0 20" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
              </button>
            </>
          )}
          <button 
            className={`control-btn ${autoRotate ? 'active' : ''}`}
            onClick={() => setAutoRotate(!autoRotate)}
            title="Auto Rotate"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-9-9" />
              <polyline points="21 3 21 9 15 9" />
            </svg>
          </button>
          <button 
            className="control-btn"
            onClick={() => {
              const container = containerRef.current;
              if (container && (container as any)._resetCamera) {
                (container as any)._resetCamera();
              }
            }}
            title="Reset Camera"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        </div>
        <div className="model-preview-hint">
          <span>Left drag: rotate • Right drag: pan • Scroll: zoom</span>
        </div>
      </div>
      
      {modelInfo && (
        <div className="model-preview-info">
          <div className="model-info-header">
            <h4>{modelInfo.name || asset.name.split('/').pop()}</h4>
            <span className="model-version">v{modelInfo.version}</span>
            {meshGeometry && (
              <span className="mesh-status success" title="Mesh data loaded">✓ Mesh</span>
            )}
            {!meshGeometry && modelInfo && (
              <span className="mesh-status warning" title="Model uses streaming - mesh data in starpak">⚠ Streaming</span>
            )}
          </div>
          
          <div className="model-info-grid">
            <div className="model-info-section">
              <h5>Structure</h5>
              <div className="info-row">
                <span className="info-label">Bones</span>
                <span className="info-value">{modelInfo.boneCount}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Body Parts</span>
                <span className="info-value">{modelInfo.bodyPartCount}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Materials</span>
                <span className="info-value">
                  {modelInfo.materialCount}
                  {loadedMaterials.size > 0 && (
                    <span className="material-loaded"> ({loadedMaterials.size} loaded)</span>
                  )}
                  {materialsLoading && (
                    <span className="material-loading"> (loading...)</span>
                  )}
                </span>
              </div>
              <div className="info-row">
                <span className="info-label">Hitbox Sets</span>
                <span className="info-value">{modelInfo.hitboxSetCount}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Attachments</span>
                <span className="info-value">{modelInfo.attachmentCount}</span>
              </div>
            </div>
            
            <div className="model-info-section">
              <h5>Properties</h5>
              <div className="info-row">
                <span className="info-label">Mass</span>
                <span className="info-value">{modelInfo.mass.toFixed(2)} kg</span>
              </div>
              <div className="info-row">
                <span className="info-label">Flags</span>
                <span className="info-value mono">0x{modelInfo.flags.toString(16).toUpperCase()}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Checksum</span>
                <span className="info-value mono">0x{modelInfo.checksum.toString(16).toUpperCase()}</span>
              </div>
              {meshGeometry && (
                <>
                  <div className="info-row">
                    <span className="info-label">Vertices</span>
                    <span className="info-value">{meshGeometry.vertexCount.toLocaleString()}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Triangles</span>
                    <span className="info-value">{Math.floor(meshGeometry.indexCount / 3).toLocaleString()}</span>
                  </div>
                </>
              )}
            </div>
            
            <div className="model-info-section full-width">
              <h5>Bounds</h5>
              <div className="info-row">
                <span className="info-label">Hull Min</span>
                <span className="info-value mono">{formatVector(modelInfo.hullMin)}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Hull Max</span>
                <span className="info-value mono">{formatVector(modelInfo.hullMax)}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Eye Position</span>
                <span className="info-value mono">{formatVector(modelInfo.eyePosition)}</span>
              </div>
            </div>
            
            {modelInfo.bodyParts && modelInfo.bodyParts.length > 0 && (
              <div className="model-info-section full-width">
                <h5>Body Groups ({modelInfo.bodyParts.length})</h5>
                <div className="bodygroup-list">
                  {modelInfo.bodyParts.map((bodyPart, idx) => (
                    <div key={idx} className="bodygroup-item">
                      <label className="bodygroup-toggle">
                        <input
                          type="checkbox"
                          checked={bodyGroupVisibility.get(idx) ?? true}
                          onChange={(e) => {
                            const newVisibility = new Map(bodyGroupVisibility);
                            newVisibility.set(idx, e.target.checked);
                            setBodyGroupVisibility(newVisibility);
                          }}
                        />
                        <span className="bodygroup-name" title={`${bodyPart.meshCount} mesh(es)`}>
                          {bodyPart.name}
                        </span>
                        <span className="bodygroup-info">
                          {bodyPart.meshCount} mesh{bodyPart.meshCount !== 1 ? 'es' : ''}
                        </span>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {modelInfo.skinFamilies && modelInfo.skinFamilies.length > 1 && (
              <div className="model-info-section full-width">
                <h5>Skins ({modelInfo.skinFamilies.length})</h5>
                <div className="skin-selector">
                  <select
                    value={selectedSkin}
                    onChange={(e) => setSelectedSkin(parseInt(e.target.value, 10))}
                    className="skin-dropdown"
                  >
                    {modelInfo.skinFamilies.map((skin, idx) => (
                      <option key={idx} value={idx}>
                        {skin.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            
            {loadedMaterials.size > 0 && (
              <div className="model-info-section full-width">
                <h5>Materials ({loadedMaterials.size})</h5>
                <div className="material-list">
                  {Array.from(loadedMaterials.entries()).map(([guid, matInfo], idx) => (
                    <div key={guid} className={`material-item ${matInfo.isPlaceholder ? 'placeholder' : ''}`}>
                      <span className="material-index">{idx + 1}</span>
                      <span className="material-name" title={matInfo.name}>{matInfo.name}</span>
                      {matInfo.isPlaceholder && (
                        <span className="material-status">⚠</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      {!modelInfo && (
        <div className="model-preview-info">
          <div className="model-info-header">
            <h4>{asset.name.split('/').pop()}</h4>
          </div>
          <p className="text-muted">Model data not available</p>
        </div>
      )}
    </div>
  );
};
