import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import * as THREE from 'three';
import { Asset } from '../types/asset';
import { 
  parseMaterialAsset, 
  MaterialAssetHeader,
  MaterialTextureEntry,
  MaterialShaderTypeNames,
  TextureBindingNames,
  ParsedMaterialData,
} from '../parsers/materialParser';
import { decodeTextureToRGBA, calculateMipSize, CompressionType, TextureFormat } from '../parsers/textureParser';
import { loadTextureMipFromStarpak } from '../parsers/starpakLoader';
import { decompress as zstdDecompress } from 'fzstd';
import { decompressRTech } from '../utils/rtechDecompress';
import { decompressOodle } from '../utils/oodleDecompress';
import { useAssetStore } from '../stores/assetStore';
import { TexturePreview } from './TexturePreview';
import { extractTextureBindings } from '../parsers/dxbcParser';
import './MaterialPreview.css';

/**
 * Calculate normal Z from X and Y components
 * Based on RSX's GetNormalZFromXY function
 */
function getNormalZFromXY(x: number, y: number): number {
  const xm = (2.0 * x) - 1.0;
  const ym = (2.0 * y) - 1.0;
  
  const a = 1.0 - (xm * xm) - (ym * ym);
  
  // Can't be valid if negative
  if (a < 0.0) {
    return 0.5;
  }
  
  const sq = Math.sqrt(a);
  return (sq / 2.0) + 0.5;
}

/**
 * Convert Source/Respawn BC5 normal map to standard format with reconstructed Z channel
 * Based on RSX's ConvertNormalOpenDX - preserves the original R and G channels
 * and only reconstructs the blue (Z) channel
 */
function convertNormalMap(rgba: Uint8Array, width: number, height: number, format: TextureFormat): Uint8Array {
  const output = new Uint8Array(rgba.length);
  
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];     // X component (keep as-is)
    const g = rgba[i + 1]; // Y component (keep as-is for DX format)
    
    // Normalize to 0-1 range for Z calculation
    const x = r / 255.0;
    const y = g / 255.0;
    
    // Calculate Z using the same formula as RSX
    const z = getNormalZFromXY(x, y);
    
    // Output: R=X, G=Y, B=Z (calculated), A=255
    output[i] = r;
    output[i + 1] = g;
    output[i + 2] = Math.round(z * 255);
    output[i + 3] = 255;
  }
  
  return output;
}

interface MaterialPreviewProps {
  asset: Asset;
}

interface MaterialTexturePreviewInfo extends MaterialTextureEntry {
  textureAsset?: Asset;
  previewUrl?: string;
}

export const MaterialPreview: React.FC<MaterialPreviewProps> = ({ asset }) => {
  const [materialData, setMaterialData] = useState<ParsedMaterialData | null>(null);
  const [textures, setTextures] = useState<MaterialTexturePreviewInfo[]>([]);
  const [selectedTextureIndex, setSelectedTextureIndex] = useState<number>(-1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'textures' | 'properties' | 'preview'>('textures');
  const [sceneReady, setSceneReady] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const sphereRef = useRef<THREE.Mesh | null>(null);
  const animationRef = useRef<number | null>(null);
  
  const { assets, getParser, getTextureData } = useAssetStore();

  // Load material data
  useEffect(() => {
    setIsLoading(true);
    setError(null);
    setMaterialData(null);
    setTextures([]);
    setSelectedTextureIndex(-1);

    const loadMaterial = async () => {
      try {
        const metadata = asset.metadata || {};
        let headerData = metadata.headerData as Uint8Array | undefined;
        
        if (!headerData) {
          setError('No header data available');
          setIsLoading(false);
          return;
        }

        // Convert headerData to Uint8Array if needed
        if (!(headerData instanceof Uint8Array)) {
          if (Array.isArray(headerData)) {
            headerData = new Uint8Array(headerData);
          } else if (typeof headerData === 'object') {
            const values = Object.values(headerData as Record<string, number>);
            headerData = new Uint8Array(values);
          }
        }

        // Get the parser to access page data
        const parser = getParser(asset.containerFile);
        if (!parser) {
          setError('Parser not available');
          setIsLoading(false);
          return;
        }

        // Try to get shader texture bindings by looking up shader set and pixel shader
        let shaderTextureBindings: Map<number, string> | undefined;
        
        // First do a quick parse to get shaderSetGuid
        const quickReader = new Uint8Array(headerData);
        // shaderSetGuid is at offset 0x28 in v15+ headers (after vftable, gap, guid, namePtr, surfaceNamePtr, surfaceName2Ptr, and other materials)
        // Let's try to read it from various possible offsets
        const possibleShaderSetOffsets = [0x50, 0x48, 0x58, 0x60]; // Different versions have different offsets
        
        for (const offset of possibleShaderSetOffsets) {
          if (offset + 8 <= headerData.length) {
            const low = headerData[offset] | (headerData[offset + 1] << 8) | 
                        (headerData[offset + 2] << 16) | (headerData[offset + 3] << 24);
            const high = headerData[offset + 4] | (headerData[offset + 5] << 8) | 
                         (headerData[offset + 6] << 16) | (headerData[offset + 7] << 24);
            const shaderSetGuidBigInt = (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0);
            
            if (shaderSetGuidBigInt !== 0n) {
              const shaderSetGuidHex = '0x' + shaderSetGuidBigInt.toString(16).toUpperCase().padStart(16, '0');
              
              // Find shader set asset
              const shaderSetAsset = assets.find(a => {
                if (!a.guid || a.type !== 'shds') return false;
                const aGuidNorm = a.guid.replace('0x', '').toUpperCase().padStart(16, '0');
                const sGuidNorm = shaderSetGuidHex.replace('0x', '').toUpperCase().padStart(16, '0');
                return aGuidNorm === sGuidNorm;
              });
              
              if (shaderSetAsset && shaderSetAsset.metadata?.headerData) {
                console.log('[MaterialPreview] Found shader set:', shaderSetAsset.name);
                
                // Parse shader set to get pixel shader GUID
                // Pixel shader GUID is typically at the end of the shader set header
                let shdsHeader = shaderSetAsset.metadata.headerData as Uint8Array;
                if (!(shdsHeader instanceof Uint8Array)) {
                  shdsHeader = new Uint8Array(shdsHeader as ArrayBuffer);
                }
                
                // Shader set pixel shader is typically at the end - try common offsets
                // v11: 56 bytes, pixelShader at offset 48
                // v12: 72 bytes, pixelShader at offset 64  
                // v13: 104 bytes, pixelShader at offset 96
                const psOffsets = [shdsHeader.length - 8, 48, 64, 72, 96];
                
                for (const psOffset of psOffsets) {
                  if (psOffset >= 0 && psOffset + 8 <= shdsHeader.length) {
                    const psLow = shdsHeader[psOffset] | (shdsHeader[psOffset + 1] << 8) | 
                                  (shdsHeader[psOffset + 2] << 16) | (shdsHeader[psOffset + 3] << 24);
                    const psHigh = shdsHeader[psOffset + 4] | (shdsHeader[psOffset + 5] << 8) | 
                                   (shdsHeader[psOffset + 6] << 16) | (shdsHeader[psOffset + 7] << 24);
                    const pixelShaderGuid = (BigInt(psHigh >>> 0) << 32n) | BigInt(psLow >>> 0);
                    
                    if (pixelShaderGuid !== 0n) {
                      const psGuidHex = '0x' + pixelShaderGuid.toString(16).toUpperCase().padStart(16, '0');
                      
                      // Find pixel shader asset
                      const pixelShaderAsset = assets.find(a => {
                        if (!a.guid || a.type !== 'shdr') return false;
                        const aGuidNorm = a.guid.replace('0x', '').toUpperCase().padStart(16, '0');
                        const pGuidNorm = psGuidHex.replace('0x', '').toUpperCase().padStart(16, '0');
                        return aGuidNorm === pGuidNorm;
                      });
                      
                      if (pixelShaderAsset) {
                        console.log('[MaterialPreview] Found pixel shader:', pixelShaderAsset.name);
                        
                        // Get shader data page and parse DXBC
                        const shaderParser = getParser(pixelShaderAsset.containerFile);
                        if (shaderParser && pixelShaderAsset.metadata?.dataPagePtr) {
                          const dataPtr = pixelShaderAsset.metadata.dataPagePtr as { index: number; offset: number };
                          const shaderData = shaderParser.getPageData(dataPtr.index);
                          
                          if (shaderData && dataPtr.offset < shaderData.length) {
                            // Extract DXBC from the shader data
                            const dxbcData = shaderData.slice(dataPtr.offset);
                            shaderTextureBindings = extractTextureBindings(dxbcData);
                            
                            if (shaderTextureBindings.size > 0) {
                              console.log('[MaterialPreview] Extracted texture bindings:', 
                                Array.from(shaderTextureBindings.entries()));
                              break;
                            }
                          }
                        }
                      }
                    }
                  }
                }
                
                if (shaderTextureBindings && shaderTextureBindings.size > 0) break;
              }
            }
          }
        }

        // Parse material - pass the parser's getPageData method and shader bindings
        const parsed = parseMaterialAsset({
          headerData,
          guid: asset.guid,
          type: 0,
          typeFourCC: 'matl',
          typeName: 'Material',
          version: metadata.version as number || 15,
          name: asset.name,
          headerSize: headerData.length,
          headPagePtr: metadata.headPagePtr as { index: number; offset: number } || { index: 0, offset: 0 },
          dataPagePtr: metadata.dataPagePtr as { index: number; offset: number } || { index: 0, offset: 0 },
          starpakOffset: 0n,
          optStarpakOffset: 0n,
          pageEnd: 0,
          dependentsCount: 0,
          dependenciesCount: 0,
        }, (pageIndex: number) => parser.getPageData(pageIndex), shaderTextureBindings);

        if (!parsed) {
          setError('Failed to parse material');
          setIsLoading(false);
          return;
        }

        setMaterialData(parsed);

        // Resolve texture assets
        const resolvedTextures: MaterialTexturePreviewInfo[] = [];
        for (const tex of parsed.textures) {
          // Try multiple ways to match the GUID
          const textureAsset = assets.find(a => {
            // Direct string match
            if (a.guid === tex.guidHex) return true;
            // Match without 0x prefix
            const texGuidNoPrefix = tex.guidHex.replace('0x', '').toLowerCase();
            const assetGuidNoPrefix = a.guid.replace('0x', '').toLowerCase();
            if (assetGuidNoPrefix === texGuidNoPrefix) return true;
            // Try BigInt comparison
            try {
              const assetGuid = BigInt('0x' + assetGuidNoPrefix);
              if (assetGuid === tex.guid) return true;
            } catch {
              // Ignore BigInt conversion errors
            }
            return false;
          });
          
          resolvedTextures.push({
            ...tex,
            textureAsset: textureAsset || undefined,
            isLoaded: !!textureAsset,
            name: textureAsset?.name?.split('/').pop() || tex.name || null,
          });
        }

        setTextures(resolvedTextures);
        
        // Auto-select first texture
        if (resolvedTextures.length > 0) {
          setSelectedTextureIndex(0);
        }

        setIsLoading(false);
      } catch (err) {
        console.error('[MaterialPreview] Error loading material:', err);
        setError((err as Error).message);
        setIsLoading(false);
      }
    };

    loadMaterial();
  }, [asset, assets, getParser]);

  // Initialize 3D preview
  useEffect(() => {
    if (activeTab !== 'preview' || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const container = canvas.parentElement;
    
    // Use a small delay to ensure canvas has proper dimensions
    const initTimeout = setTimeout(() => {
      // Get dimensions from parent container
      const containerRect = container?.getBoundingClientRect();
      const width = containerRect?.width || 400;
      const height = (containerRect?.height || 400) - 40; // Subtract controls height

      console.log('[MaterialPreview] Initializing 3D preview, container size:', width, 'x', height);

      if (width <= 0 || height <= 0) {
        console.warn('[MaterialPreview] Invalid canvas dimensions, using defaults');
      }

      const finalWidth = Math.max(width, 100);
      const finalHeight = Math.max(height, 100);

      // Set canvas size explicitly
      canvas.width = finalWidth;
      canvas.height = finalHeight;
      canvas.style.width = `${finalWidth}px`;
      canvas.style.height = `${finalHeight}px`;

      // Create renderer
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setSize(finalWidth, finalHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1;
      rendererRef.current = renderer;

      // Create scene
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a1a2e);
      sceneRef.current = scene;

      // Create camera
      const camera = new THREE.PerspectiveCamera(45, finalWidth / finalHeight, 0.1, 100);
      camera.position.set(0, 0, 3);
      cameraRef.current = camera;

      // Add lights
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
      scene.add(ambientLight);

      const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
      directionalLight.position.set(5, 5, 5);
      scene.add(directionalLight);

      const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
      directionalLight2.position.set(-5, -5, -5);
      scene.add(directionalLight2);

      // Create material
      const material = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        roughness: 0.5,
        metalness: 0.0,
      });
      materialRef.current = material;

      // Create sphere
      const geometry = new THREE.SphereGeometry(1, 64, 64);
      const sphere = new THREE.Mesh(geometry, material);
      scene.add(sphere);
      sphereRef.current = sphere;

      // Initial render
      renderer.render(scene, camera);
      console.log('[MaterialPreview] Initial render complete');

      // Animation loop
      let isRunning = true;
      const animate = () => {
        if (!isRunning) return;
        animationRef.current = requestAnimationFrame(animate);
        sphere.rotation.y += 0.005;
        renderer.render(scene, camera);
      };
      animate();

      // Handle resize with ResizeObserver on container
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const newWidth = entry.contentRect.width;
          const newHeight = entry.contentRect.height - 40; // Subtract controls
          if (newWidth > 0 && newHeight > 0) {
            canvas.width = newWidth;
            canvas.height = newHeight;
            camera.aspect = newWidth / newHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(newWidth, newHeight);
          }
        }
      });
      if (container) {
        resizeObserver.observe(container);
      }

      // Mark scene as ready
      setSceneReady(true);

      // Store cleanup function
      const cleanup = () => {
        isRunning = false;
        setSceneReady(false);
        resizeObserver.disconnect();
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
        renderer.dispose();
        geometry.dispose();
        material.dispose();
      };
      
      // Store cleanup for useEffect return
      (canvas as any)._cleanup = cleanup;
    }, 100); // Slightly longer delay

    return () => {
      clearTimeout(initTimeout);
      setSceneReady(false);
      if ((canvas as any)._cleanup) {
        (canvas as any)._cleanup();
        delete (canvas as any)._cleanup;
      }
    };
  }, [activeTab]);

  // Load textures into material
  useEffect(() => {
    if (!sceneReady || !materialRef.current || activeTab !== 'preview') return;

    const loadTexturesIntoMaterial = async () => {
      const material = materialRef.current;
      if (!material) return;

      for (const tex of textures) {
        if (!tex.textureAsset) continue;

        try {
          const textureData = await getTextureData(tex.textureAsset);
          if (!textureData) {
            console.log('[MaterialPreview] No texture data for:', tex.name);
            continue;
          }

          const { header, pixelData, starpakOffset, optStarpakOffset } = textureData;
          
          // Try to load highest quality mip available
          let finalPixelData = pixelData;
          let mipLevel = header.streamedMipCount + header.optStreamedMipCount; // Default to first permanent mip
          let mipWidth = Math.max(1, header.width >> mipLevel);
          let mipHeight = Math.max(1, header.height >> mipLevel);
          
          // Get the rpak base path from the texture's container file
          const texRpakPath = tex.textureAsset?.containerFile;
          const texRpakBasePath = texRpakPath ? texRpakPath.substring(0, Math.max(texRpakPath.lastIndexOf('/'), texRpakPath.lastIndexOf('\\'))) : undefined;
          
          // Try to load from starpak for higher resolution (mip 0 or best available)
          const hasStarpak = starpakOffset && starpakOffset !== 0n;
          const hasOptStarpak = optStarpakOffset && optStarpakOffset !== 0n;
          
          if (hasOptStarpak || hasStarpak) {
            // Try to load mip 0 (highest res) from starpak
            const targetMip = 0;
            const isOpt = hasOptStarpak && targetMip < header.optStreamedMipCount;
            const offset = isOpt ? optStarpakOffset : starpakOffset;
            
            console.log('[MaterialPreview] Loading starpak texture:', tex.name, 'isOpt:', isOpt);
            
            try {
              const starpakResult = await loadTextureMipFromStarpak(
                offset,
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
                
                // Decompress if needed
                if (starpakResult.compressed) {
                  if (starpakResult.compressionType === CompressionType.PAKFILE) {
                    try {
                      decompressedData = decompressRTech(starpakResult.data);
                      console.log('[MaterialPreview] RTech decompressed starpak data:', starpakResult.data.length, '->', decompressedData.length);
                    } catch (e) {
                      console.warn('[MaterialPreview] RTech decompression failed:', e);
                    }
                  } else if (starpakResult.compressionType === CompressionType.OODLE) {
                    try {
                      const expectedSize = calculateMipSize(mipWidth, mipHeight, header.format, targetMip);
                      const oodleResult = await decompressOodle(starpakResult.data, expectedSize);
                      if (oodleResult) {
                        decompressedData = oodleResult;
                        console.log('[MaterialPreview] Oodle decompressed starpak data:', starpakResult.data.length, '->', decompressedData.length);
                      }
                    } catch (e) {
                      console.warn('[MaterialPreview] Oodle decompression failed:', e);
                    }
                  }
                }
                
                finalPixelData = decompressedData;
                mipLevel = targetMip;
                mipWidth = Math.max(1, header.width >> targetMip);
                mipHeight = Math.max(1, header.height >> targetMip);
                console.log('[MaterialPreview] Using starpak mip', targetMip, ':', mipWidth, 'x', mipHeight);
              }
            } catch (starpakErr) {
              console.warn('[MaterialPreview] Starpak load failed, using permanent mip:', starpakErr);
            }
          }
          
          if (!finalPixelData || finalPixelData.length === 0) {
            console.log('[MaterialPreview] No pixel data for texture:', tex.name);
            continue;
          }
          
          console.log('[MaterialPreview] Decoding texture:', tex.name, mipWidth, 'x', mipHeight, 'format:', header.format);

          // Decode the texture to RGBA
          const rgba = decodeTextureToRGBA(finalPixelData, mipWidth, mipHeight, header.format);
          if (!rgba || rgba.length === 0) {
            console.warn('[MaterialPreview] Failed to decode texture:', tex.name);
            continue;
          }

          // Create Three.js DataTexture
          const threeTexture = new THREE.DataTexture(
            rgba,
            mipWidth,
            mipHeight,
            THREE.RGBAFormat,
            THREE.UnsignedByteType
          );
          threeTexture.needsUpdate = true;
          threeTexture.flipY = true; // Flip for correct UV mapping
          threeTexture.wrapS = THREE.RepeatWrapping;
          threeTexture.wrapT = THREE.RepeatWrapping;
          threeTexture.magFilter = THREE.LinearFilter;
          threeTexture.minFilter = THREE.LinearMipmapLinearFilter;
          threeTexture.generateMipmaps = true;
          threeTexture.colorSpace = THREE.SRGBColorSpace; // Default to sRGB for color textures

          // Apply texture to appropriate material slot based on binding name
          const bindingName = tex.resourceBindingName?.toLowerCase() || '';
          console.log('[MaterialPreview] Texture binding:', tex.index, bindingName, tex.name);
          
          if (bindingName.includes('emis') || bindingName.includes('emit') || bindingName.includes('ilm') || bindingName.includes('selfillum')) {
            // Check emissive FIRST before color (since 'g_tEmission' might also get caught by other checks)
            console.log('[MaterialPreview] Applying as emissive map');
            threeTexture.colorSpace = THREE.SRGBColorSpace;
            material.emissiveMap = threeTexture;
            material.emissive.setHex(0xffffff);
            material.emissiveIntensity = 1.0;
          } else if (bindingName.includes('color') || bindingName.includes('albedo') || bindingName.includes('diffuse')) {
            console.log('[MaterialPreview] Applying as color/albedo map');
            material.map = threeTexture;
            material.color.setHex(0xffffff); // Reset color when using map
          } else if (bindingName.includes('normal') || bindingName.includes('nml')) {
            console.log('[MaterialPreview] Applying as normal map, converting format...');
            // Convert normal map from Source/Respawn format to OpenGL format
            const convertedNormal = convertNormalMap(rgba, mipWidth, mipHeight, header.format);
            const normalTexture = new THREE.DataTexture(
              convertedNormal,
              mipWidth,
              mipHeight,
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
            material.normalMap = normalTexture;
            material.normalScale.set(1, 1);
          } else if (bindingName.includes('gloss') || bindingName.includes('rough')) {
            console.log('[MaterialPreview] Applying as roughness map');
            threeTexture.colorSpace = THREE.NoColorSpace;
            material.roughnessMap = threeTexture;
            material.roughness = 1.0;
          } else if (bindingName.includes('spec') || bindingName.includes('metal')) {
            console.log('[MaterialPreview] Applying as metalness map');
            threeTexture.colorSpace = THREE.NoColorSpace;
            material.metalnessMap = threeTexture;
            material.metalness = 1.0;
          } else if (bindingName.includes('ao') || bindingName.includes('occlusion')) {
            console.log('[MaterialPreview] Applying as AO map');
            threeTexture.colorSpace = THREE.NoColorSpace;
            material.aoMap = threeTexture;
          } else if (bindingName.includes('opacity') || bindingName.includes('alpha')) {
            console.log('[MaterialPreview] Applying as alpha/opacity map');
            threeTexture.colorSpace = THREE.NoColorSpace;
            material.alphaMap = threeTexture;
            material.transparent = true;
          } else if (bindingName.includes('detail') && !bindingName.includes('normal')) {
            // Detail maps can be used as a secondary color modulation
            // Three.js doesn't have built-in detail map support, so we skip or could blend manually
            console.log('[MaterialPreview] Detail map detected (not directly supported in Three.js):', bindingName);
          } else if (bindingName.includes('detailnormal')) {
            // Detail normal maps would need custom shader blending
            console.log('[MaterialPreview] Detail normal map detected (not directly supported):', bindingName);
          } else if (bindingName.includes('cavity')) {
            // Cavity maps are similar to AO but for crevices - can use as additional AO
            console.log('[MaterialPreview] Applying cavity map as secondary AO');
            threeTexture.colorSpace = THREE.NoColorSpace;
            // If no AO map set, use cavity as AO
            if (!material.aoMap) {
              material.aoMap = threeTexture;
            }
          } else if (bindingName.includes('scatter') || bindingName.includes('thickness')) {
            // Subsurface scattering / thickness - would need MeshPhysicalMaterial
            console.log('[MaterialPreview] Scatter/thickness map detected (requires physical material):', bindingName);
          } else if (bindingName.includes('iridescence')) {
            // Iridescence - would need MeshPhysicalMaterial
            console.log('[MaterialPreview] Iridescence map detected (requires physical material):', bindingName);
          } else if (tex.index === 0 && !material.map) {
            // First texture is usually albedo/color (only if we haven't set a map yet)
            console.log('[MaterialPreview] Applying first texture as color map (fallback)');
            material.map = threeTexture;
            material.color.setHex(0xffffff);
          } else {
            console.log('[MaterialPreview] Unknown texture binding, skipping:', bindingName);
          }

          material.needsUpdate = true;
        } catch (err) {
          console.warn('[MaterialPreview] Failed to load texture:', tex.name, err);
        }
      }
    };

    loadTexturesIntoMaterial();
  }, [textures, activeTab, sceneReady, getTextureData]);

  // Get selected texture asset
  const selectedTexture = useMemo(() => {
    if (selectedTextureIndex < 0 || selectedTextureIndex >= textures.length) return null;
    return textures[selectedTextureIndex];
  }, [textures, selectedTextureIndex]);

  if (isLoading) {
    return (
      <div className="material-preview loading">
        <div className="loading-spinner" />
        <p>Loading material...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="material-preview error">
        <p className="error-message">{error}</p>
      </div>
    );
  }

  return (
    <div className="material-preview">
      {/* Header */}
      <div className="material-header">
        <div className="material-title">
          <svg className="material-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a10 10 0 0 0 0 20" fill="currentColor" opacity="0.3" />
          </svg>
          <div className="material-title-text">
            <h3>{materialData?.name || asset.name.split('/').pop()}</h3>
            {materialData && (
              <span className="material-type">
                {MaterialShaderTypeNames[materialData.header.materialType] || 'Unknown'}
              </span>
            )}
          </div>
        </div>
        
        {materialData && (
          <div className="material-quick-info">
            <span className="info-item">
              <span className="info-label">Shader Set:</span>
              <span className="info-value mono">
                0x{materialData.header.shaderSetGuid.toString(16).toUpperCase().padStart(16, '0')}
              </span>
            </span>
            <span className="info-item">
              <span className="info-label">Textures:</span>
              <span className="info-value">{textures.length}</span>
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="material-tabs">
        <button
          className={`tab-btn ${activeTab === 'textures' ? 'active' : ''}`}
          onClick={() => setActiveTab('textures')}
        >
          Textures
        </button>
        <button
          className={`tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
          onClick={() => setActiveTab('preview')}
        >
          3D Preview
        </button>
        <button
          className={`tab-btn ${activeTab === 'properties' ? 'active' : ''}`}
          onClick={() => setActiveTab('properties')}
        >
          Properties
        </button>
      </div>

      {/* Tab Content */}
      <div className="material-content">
        {activeTab === 'textures' && (
          <div className="textures-tab">
            {/* Texture List */}
            <div className="texture-list">
              <table className="texture-table">
                <thead>
                  <tr>
                    <th>IDX</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {textures.map((tex, idx) => (
                    <tr
                      key={tex.index}
                      className={`texture-row ${selectedTextureIndex === idx ? 'selected' : ''}`}
                      onClick={() => setSelectedTextureIndex(idx)}
                    >
                      <td className="cell-idx">{tex.index}</td>
                      <td className="cell-name">
                        {tex.name || tex.guidHex}
                      </td>
                      <td className="cell-type">{tex.resourceBindingName}</td>
                      <td className="cell-status">
                        {tex.isLoaded ? (
                          <span className="status-loaded">Loaded</span>
                        ) : (
                          <span className="status-unloaded">Not Loaded</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {textures.length === 0 && (
                    <tr>
                      <td colSpan={4} className="no-textures">
                        No textures found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Selected Texture Preview */}
            {selectedTexture && selectedTexture.textureAsset && (
              <div className="texture-preview-container">
                <div className="texture-preview-header">
                  <span className="preview-title">
                    {selectedTexture.resourceBindingName} - {selectedTexture.name || selectedTexture.guidHex}
                  </span>
                </div>
                <div className="texture-preview-wrapper">
                  <TexturePreview asset={selectedTexture.textureAsset} />
                </div>
              </div>
            )}

            {selectedTexture && !selectedTexture.textureAsset && (
              <div className="texture-preview-container">
                <div className="texture-not-loaded">
                  <p>Texture not loaded</p>
                  <p className="guid-display">{selectedTexture.guidHex}</p>
                  <p className="help-text">Load the RPak containing this texture to preview it</p>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'preview' && (
          <div className="preview-3d-tab">
            <canvas ref={canvasRef} className="material-3d-canvas" />
            <div className="preview-3d-controls">
              <p className="preview-hint">
                3D material preview (textures applied to sphere)
              </p>
            </div>
          </div>
        )}

        {activeTab === 'properties' && materialData && (
          <div className="properties-tab">
            <div className="property-group">
              <h4>Material Info</h4>
              <div className="property-row">
                <span className="property-label">Name</span>
                <span className="property-value">{materialData.name}</span>
              </div>
              <div className="property-row">
                <span className="property-label">GUID</span>
                <span className="property-value mono">
                  0x{materialData.header.guid.toString(16).toUpperCase().padStart(16, '0')}
                </span>
              </div>
              <div className="property-row">
                <span className="property-label">Type</span>
                <span className="property-value">
                  {MaterialShaderTypeNames[materialData.header.materialType] || `Unknown (${materialData.header.materialType})`}
                </span>
              </div>
              {materialData.surfaceName && (
                <div className="property-row">
                  <span className="property-label">Surface</span>
                  <span className="property-value">{materialData.surfaceName}</span>
                </div>
              )}
              {materialData.surfaceName2 && (
                <div className="property-row">
                  <span className="property-label">Surface 2</span>
                  <span className="property-value">{materialData.surfaceName2}</span>
                </div>
              )}
            </div>

            <div className="property-group">
              <h4>Shader Set</h4>
              <div className="property-row">
                <span className="property-label">GUID</span>
                <span className="property-value mono">
                  0x{materialData.header.shaderSetGuid.toString(16).toUpperCase().padStart(16, '0')}
                </span>
              </div>
            </div>

            <div className="property-group">
              <h4>Dimensions</h4>
              <div className="property-row">
                <span className="property-label">Size</span>
                <span className="property-value">
                  {materialData.header.width} x {materialData.header.height}
                  {materialData.header.depth > 1 ? ` x ${materialData.header.depth}` : ''}
                </span>
              </div>
            </div>

            <div className="property-group">
              <h4>Flags</h4>
              <div className="property-row">
                <span className="property-label">Glue Flags</span>
                <span className="property-value mono">0x{materialData.header.glueFlags.toString(16).toUpperCase()}</span>
              </div>
              <div className="property-row">
                <span className="property-label">Glue Flags 2</span>
                <span className="property-value mono">0x{materialData.header.glueFlags2.toString(16).toUpperCase()}</span>
              </div>
              <div className="property-row">
                <span className="property-label">Uber Buffer Flags</span>
                <span className="property-value mono">0x{materialData.header.uberBufferFlags.toString(16).toUpperCase()}</span>
              </div>
            </div>

            <div className="property-group">
              <h4>Animation</h4>
              <div className="property-row">
                <span className="property-label">Frames</span>
                <span className="property-value">{materialData.header.numAnimationFrames}</span>
              </div>
              {materialData.header.textureAnimation !== 0n && (
                <div className="property-row">
                  <span className="property-label">Animation Asset</span>
                  <span className="property-value mono">
                    0x{materialData.header.textureAnimation.toString(16).toUpperCase().padStart(16, '0')}
                  </span>
                </div>
              )}
            </div>

            <div className="property-group">
              <h4>Related Materials</h4>
              {materialData.header.depthShadowMaterial !== 0n && (
                <div className="property-row">
                  <span className="property-label">Depth Shadow</span>
                  <span className="property-value mono">
                    0x{materialData.header.depthShadowMaterial.toString(16).toUpperCase().padStart(16, '0')}
                  </span>
                </div>
              )}
              {materialData.header.depthPrepassMaterial !== 0n && (
                <div className="property-row">
                  <span className="property-label">Depth Prepass</span>
                  <span className="property-value mono">
                    0x{materialData.header.depthPrepassMaterial.toString(16).toUpperCase().padStart(16, '0')}
                  </span>
                </div>
              )}
              {materialData.header.depthVSMMaterial !== 0n && (
                <div className="property-row">
                  <span className="property-label">Depth VSM</span>
                  <span className="property-value mono">
                    0x{materialData.header.depthVSMMaterial.toString(16).toUpperCase().padStart(16, '0')}
                  </span>
                </div>
              )}
              {materialData.header.colpassMaterial !== 0n && (
                <div className="property-row">
                  <span className="property-label">Colpass</span>
                  <span className="property-value mono">
                    0x{materialData.header.colpassMaterial.toString(16).toUpperCase().padStart(16, '0')}
                  </span>
                </div>
              )}
            </div>

            <div className="property-group">
              <h4>Samplers</h4>
              <div className="property-row">
                <span className="property-label">Values</span>
                <span className="property-value mono">
                  [{materialData.header.samplers.map(s => `0x${s.toString(16)}`).join(', ')}]
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
