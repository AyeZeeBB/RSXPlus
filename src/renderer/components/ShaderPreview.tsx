import React, { useMemo } from 'react';
import { Asset } from '../types/asset';
import { parseDXBC, ShaderInputType, ResourceBinding } from '../parsers/dxbcParser';
import { parseShaderSetHeader } from '../parsers/shaderParser';
import { useAssetStore } from '../stores/assetStore';
import './ShaderPreview.css';

interface ShaderPreviewProps {
  asset: Asset;
}

// Shader type from asset type
const ShaderTypeNames: Record<string, string> = {
  'shdr': 'Shader',
  'shds': 'Shader Set',
};

// Input type display names
const InputTypeNames: Record<number, string> = {
  [ShaderInputType.CBUFFER]: 'Constant Buffer',
  [ShaderInputType.TBUFFER]: 'Texture Buffer',
  [ShaderInputType.TEXTURE]: 'Texture',
  [ShaderInputType.SAMPLER]: 'Sampler',
  [ShaderInputType.UAV_RWTYPED]: 'RW Typed UAV',
  [ShaderInputType.STRUCTURED]: 'Structured Buffer',
  [ShaderInputType.UAV_RWSTRUCTURED]: 'RW Structured UAV',
  [ShaderInputType.BYTEADDRESS]: 'ByteAddress Buffer',
  [ShaderInputType.UAV_RWBYTEADDRESS]: 'RW ByteAddress UAV',
  [ShaderInputType.UAV_APPEND_STRUCTURED]: 'Append Structured UAV',
  [ShaderInputType.UAV_CONSUME_STRUCTURED]: 'Consume Structured UAV',
  [ShaderInputType.UAV_RWSTRUCTURED_WITH_COUNTER]: 'RW Structured UAV w/ Counter',
};

// Badge color based on input type
function getInputTypeBadgeClass(type: ShaderInputType): string {
  switch (type) {
    case ShaderInputType.TEXTURE:
      return 'badge-texture';
    case ShaderInputType.SAMPLER:
      return 'badge-sampler';
    case ShaderInputType.CBUFFER:
      return 'badge-cbuffer';
    default:
      return 'badge-default';
  }
}

export const ShaderPreview: React.FC<ShaderPreviewProps> = ({ asset }) => {
  const { getParser, assets: allAssets } = useAssetStore();
  
  // Parse shader/shaderset data
  const shaderInfo = useMemo(() => {
    const metadata = asset.metadata || {};
    const headerData = metadata.headerData as Uint8Array | undefined;
    const dataPageData = metadata.dataPageData as Uint8Array | undefined;
    const version = (metadata.version as number) || asset.version || 8;
    
    if (asset.type === 'shds') {
      // Shader Set - parse header to get info
      const parser = getParser(asset.containerFile);
      if (!parser || !headerData) return null;
      
      const parsed = parseShaderSetHeader(headerData, version, (pageIndex) => parser.getPageData(pageIndex));
      if (!parsed) return null;
      
      return {
        type: 'shds',
        name: parsed.name || asset.name,
        shaderSet: {
          numVertexShaderTextures: parsed.header.numVertexShaderTextures,
          numPixelShaderTextures: parsed.header.numPixelShaderTextures,
          numSamplers: parsed.header.numSamplers,
          firstResourceBindPoint: parsed.header.firstResourceBindPoint,
          numResources: parsed.header.numResources,
          vertexShaderGuid: parsed.header.vertexShaderGuid.toString(16).padStart(16, '0').toUpperCase(),
          pixelShaderGuid: parsed.header.pixelShaderGuid.toString(16).padStart(16, '0').toUpperCase(),
        },
        resourceBindings: new Map<number, ResourceBinding>(),
      };
    } else if (asset.type === 'shdr') {
      // Shader - try to parse DXBC from data
      if (!dataPageData || dataPageData.length < 32) {
        // Try to find DXBC in raw data or header
        return {
          type: 'shdr',
          name: asset.name,
          dataSize: dataPageData?.length || 0,
          resourceBindings: new Map<number, ResourceBinding>(),
        };
      }
      
      // Find DXBC signature in data
      const dxbcResult = parseDXBC(dataPageData);
      
      return {
        type: 'shdr',
        name: asset.name,
        dataSize: dataPageData.length,
        isValidDXBC: dxbcResult.isValid,
        resourceBindings: dxbcResult.resourceBindings,
      };
    }
    
    return null;
  }, [asset, getParser]);

  if (!shaderInfo) {
    return (
      <div className="shader-preview">
        <div className="preview-info">
          <p>Unable to parse shader data</p>
        </div>
      </div>
    );
  }

  // Group resource bindings by type
  const groupedBindings = useMemo(() => {
    const groups: Record<string, ResourceBinding[]> = {
      textures: [],
      samplers: [],
      cbuffers: [],
      other: [],
    };
    
    for (const [, binding] of shaderInfo.resourceBindings) {
      switch (binding.type) {
        case ShaderInputType.TEXTURE:
          groups.textures.push(binding);
          break;
        case ShaderInputType.SAMPLER:
          groups.samplers.push(binding);
          break;
        case ShaderInputType.CBUFFER:
          groups.cbuffers.push(binding);
          break;
        default:
          groups.other.push(binding);
      }
    }
    
    // Sort each group by bind point
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => a.bindPoint - b.bindPoint);
    }
    
    return groups;
  }, [shaderInfo.resourceBindings]);

  return (
    <div className="shader-preview">
      {/* Header Info */}
      <div className="shader-header">
        <div className="shader-type-badge">
          {ShaderTypeNames[shaderInfo.type] || shaderInfo.type.toUpperCase()}
        </div>
        <div className="shader-name">{shaderInfo.name}</div>
      </div>

      {/* Shader Set specific info */}
      {shaderInfo.type === 'shds' && shaderInfo.shaderSet && (
        <div className="shader-section">
          <h4>Shader Set Properties</h4>
          <div className="shader-properties">
            <div className="property-row">
              <span className="property-label">Vertex Shader Textures</span>
              <span className="property-value">{shaderInfo.shaderSet.numVertexShaderTextures}</span>
            </div>
            <div className="property-row">
              <span className="property-label">Pixel Shader Textures</span>
              <span className="property-value">{shaderInfo.shaderSet.numPixelShaderTextures}</span>
            </div>
            <div className="property-row">
              <span className="property-label">Samplers</span>
              <span className="property-value">{shaderInfo.shaderSet.numSamplers}</span>
            </div>
            <div className="property-row">
              <span className="property-label">First Resource Bind Point</span>
              <span className="property-value">{shaderInfo.shaderSet.firstResourceBindPoint}</span>
            </div>
            <div className="property-row">
              <span className="property-label">Num Resources</span>
              <span className="property-value">{shaderInfo.shaderSet.numResources}</span>
            </div>
          </div>

          <h4>Referenced Shaders</h4>
          <div className="shader-refs">
            <div className="shader-ref">
              <span className="ref-type">Vertex Shader</span>
              <span className="ref-guid mono">0x{shaderInfo.shaderSet.vertexShaderGuid}</span>
            </div>
            <div className="shader-ref">
              <span className="ref-type">Pixel Shader</span>
              <span className="ref-guid mono">0x{shaderInfo.shaderSet.pixelShaderGuid}</span>
            </div>
          </div>
        </div>
      )}

      {/* Shader specific info */}
      {shaderInfo.type === 'shdr' && (
        <div className="shader-section">
          <h4>Shader Data</h4>
          <div className="shader-properties">
            <div className="property-row">
              <span className="property-label">Data Size</span>
              <span className="property-value">{shaderInfo.dataSize?.toLocaleString()} bytes</span>
            </div>
            <div className="property-row">
              <span className="property-label">Valid DXBC</span>
              <span className={`property-value ${shaderInfo.isValidDXBC ? 'text-success' : 'text-warning'}`}>
                {shaderInfo.isValidDXBC ? 'Yes' : 'No / Not Found'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Resource Bindings */}
      {shaderInfo.resourceBindings.size > 0 && (
        <>
          {/* Textures */}
          {groupedBindings.textures.length > 0 && (
            <div className="shader-section">
              <h4>
                <span className="section-icon">🖼️</span>
                Textures ({groupedBindings.textures.length})
              </h4>
              <div className="binding-list">
                {groupedBindings.textures.map((binding, idx) => (
                  <div key={idx} className="binding-item">
                    <span className="binding-slot">t{binding.bindPoint}</span>
                    <span className="binding-name">{binding.name}</span>
                    {binding.bindCount > 1 && (
                      <span className="binding-count">[{binding.bindCount}]</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Samplers */}
          {groupedBindings.samplers.length > 0 && (
            <div className="shader-section">
              <h4>
                <span className="section-icon">🔘</span>
                Samplers ({groupedBindings.samplers.length})
              </h4>
              <div className="binding-list">
                {groupedBindings.samplers.map((binding, idx) => (
                  <div key={idx} className="binding-item">
                    <span className="binding-slot">s{binding.bindPoint}</span>
                    <span className="binding-name">{binding.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Constant Buffers */}
          {groupedBindings.cbuffers.length > 0 && (
            <div className="shader-section">
              <h4>
                <span className="section-icon">📦</span>
                Constant Buffers ({groupedBindings.cbuffers.length})
              </h4>
              <div className="binding-list">
                {groupedBindings.cbuffers.map((binding, idx) => (
                  <div key={idx} className="binding-item">
                    <span className="binding-slot">b{binding.bindPoint}</span>
                    <span className="binding-name">{binding.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Other Resources */}
          {groupedBindings.other.length > 0 && (
            <div className="shader-section">
              <h4>
                <span className="section-icon">📋</span>
                Other Resources ({groupedBindings.other.length})
              </h4>
              <div className="binding-list">
                {groupedBindings.other.map((binding, idx) => (
                  <div key={idx} className="binding-item">
                    <span className="binding-slot">r{binding.bindPoint}</span>
                    <span className="binding-name">{binding.name}</span>
                    <span className={`badge badge-sm ${getInputTypeBadgeClass(binding.type)}`}>
                      {InputTypeNames[binding.type] || `Type ${binding.type}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* No bindings message */}
      {shaderInfo.resourceBindings.size === 0 && shaderInfo.type === 'shdr' && (
        <div className="shader-section">
          <div className="preview-info">
            <p>No resource bindings found in DXBC data.</p>
            <p className="text-muted">
              The shader may use different bytecode format or the data couldn't be parsed.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
