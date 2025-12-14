import React, { useMemo, useState } from 'react';
import { Asset } from '../types/asset';
import { useAssetStore } from '../stores/assetStore';
import './EffectPreview.css';

interface EffectPreviewProps {
  asset: Asset;
}

// Binary reading helpers
function readUint32(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
}

function readUint64(data: Uint8Array, offset: number): bigint {
  const low = BigInt(readUint32(data, offset));
  const high = BigInt(readUint32(data, offset + 4));
  return (high << 32n) | low;
}

function readString(data: Uint8Array, offset: number): string {
  let end = offset;
  while (end < data.length && data[end] !== 0) end++;
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(data.slice(offset, end));
}

interface EffectElement {
  index: number;
  name: string;
  material: string;
  maxParticles: number;
}

interface EffectData {
  fileName: string;
  elementCount: number;
  stringCount: number;
  elements: EffectElement[];
}

interface ParsedEffect {
  pcfCount: number;
  effects: EffectData[];
}

/**
 * Effect Asset Header Structure:
 * 
 * EffectHeader (0x10 bytes):
 * - 0x00: PagePtr pcfData (8 bytes) - pointer to EffectData_v2 array
 * - 0x08: uint64 pcfCount (8 bytes) - number of PCF entries
 * 
 * EffectData_v2 (0x28 bytes):
 * - 0x00: PagePtr pFileName (8 bytes) - pointer to effect filename
 * - 0x08: PagePtr pElements (8 bytes) - pointer to element array
 * - 0x10: uint64 numElements (8 bytes)
 * - 0x18: PagePtr pStringDict (8 bytes) - pointer to string dictionary
 * - 0x20: uint64 numStrings (8 bytes)
 * 
 * EffectElement_v2 (~0x170 bytes):
 * - 0x00: PagePtr elementName (8 bytes)
 * - 0x08: GUID (16 bytes)
 * - 0x18: PagePtr unkPtr (8 bytes)
 * - 0x20: int64 unk[3] (24 bytes)
 * - 0x38: int64 max_particles (8 bytes)
 * - 0x40: PagePtr material (8 bytes)
 * ... more fields
 */

const HEADER_SIZE = 0x10;
const EFFECT_DATA_SIZE = 0x28;
const ELEMENT_SIZE = 0x170; // Approximate size

function parseEffectAsset(
  headerData: Uint8Array,
  getPageData: (pageIndex: number) => Uint8Array | null
): ParsedEffect | null {
  if (headerData.length < HEADER_SIZE) {
    console.log('[efct] Header too small:', headerData.length);
    return null;
  }

  // Read header
  const pcfDataPageIndex = readUint32(headerData, 0);
  const pcfDataPageOffset = readUint32(headerData, 4);
  const pcfCount = Number(readUint64(headerData, 8));

  console.log('[efct] Header:', { pcfDataPageIndex, pcfDataPageOffset, pcfCount });

  if (pcfCount === 0 || pcfCount > 1000) {
    return { pcfCount: 0, effects: [] };
  }

  const effects: EffectData[] = [];

  // Get PCF data page
  const pcfDataPage = getPageData(pcfDataPageIndex);
  if (!pcfDataPage) {
    console.log('[efct] Could not get PCF data page');
    return { pcfCount, effects: [] };
  }

  // Parse each PCF entry
  for (let i = 0; i < Math.min(pcfCount, 50); i++) {
    const pcfOffset = pcfDataPageOffset + (i * EFFECT_DATA_SIZE);
    if (pcfOffset + EFFECT_DATA_SIZE > pcfDataPage.length) break;

    // Read EffectData_v2
    const fileNamePageIndex = readUint32(pcfDataPage, pcfOffset + 0);
    const fileNamePageOffset = readUint32(pcfDataPage, pcfOffset + 4);
    const elementsPageIndex = readUint32(pcfDataPage, pcfOffset + 8);
    const elementsPageOffset = readUint32(pcfDataPage, pcfOffset + 12);
    const numElements = Number(readUint64(pcfDataPage, pcfOffset + 16));
    const stringDictPageIndex = readUint32(pcfDataPage, pcfOffset + 24);
    const stringDictPageOffset = readUint32(pcfDataPage, pcfOffset + 28);
    const numStrings = Number(readUint64(pcfDataPage, pcfOffset + 32));

    // Read filename
    let fileName = `Effect ${i}`;
    const fileNamePage = getPageData(fileNamePageIndex);
    if (fileNamePage && fileNamePageOffset < fileNamePage.length) {
      const readName = readString(fileNamePage, fileNamePageOffset);
      if (readName) fileName = readName;
    }

    // Parse elements
    const elements: EffectElement[] = [];
    if (numElements > 0 && numElements < 200) {
      const elementsPage = getPageData(elementsPageIndex);
      if (elementsPage) {
        for (let j = 0; j < Math.min(numElements, 50); j++) {
          const elemOffset = elementsPageOffset + (j * ELEMENT_SIZE);
          if (elemOffset + 0x48 > elementsPage.length) break;

          // Read element name pointer
          const elemNamePageIndex = readUint32(elementsPage, elemOffset + 0);
          const elemNamePageOffset = readUint32(elementsPage, elemOffset + 4);
          
          // Read max particles (at offset 0x38)
          const maxParticles = Number(readUint64(elementsPage, elemOffset + 0x38));
          
          // Read material pointer (at offset 0x40)
          const materialPageIndex = readUint32(elementsPage, elemOffset + 0x40);
          const materialPageOffset = readUint32(elementsPage, elemOffset + 0x44);

          // Get element name
          let elemName = `Element ${j}`;
          const elemNamePage = getPageData(elemNamePageIndex);
          if (elemNamePage && elemNamePageOffset < elemNamePage.length) {
            const readElemName = readString(elemNamePage, elemNamePageOffset);
            if (readElemName) elemName = readElemName;
          }

          // Get material name
          let materialName = '';
          const materialPage = getPageData(materialPageIndex);
          if (materialPage && materialPageOffset < materialPage.length) {
            const readMaterial = readString(materialPage, materialPageOffset);
            if (readMaterial) materialName = readMaterial;
          }

          elements.push({
            index: j,
            name: elemName,
            material: materialName,
            maxParticles: maxParticles
          });
        }
      }
    }

    effects.push({
      fileName,
      elementCount: numElements,
      stringCount: numStrings,
      elements
    });
  }

  return { pcfCount, effects };
}

export const EffectPreview: React.FC<EffectPreviewProps> = ({ asset }) => {
  const { getParser } = useAssetStore();
  const [expandedEffect, setExpandedEffect] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const parsed = useMemo(() => {
    const headerData = asset.metadata?.headerData;
    if (!headerData) {
      console.log('[efct] No header data');
      return null;
    }

    let headerU8: Uint8Array;
    if (headerData instanceof Uint8Array) {
      headerU8 = headerData;
    } else {
      headerU8 = new Uint8Array(headerData as ArrayBuffer);
    }

    if (asset.containerFile) {
      const parser = getParser(asset.containerFile);
      if (parser) {
        return parseEffectAsset(
          headerU8,
          (pageIndex: number) => parser.getPageData(pageIndex)
        );
      }
    }

    return null;
  }, [asset, getParser]);

  // Filter effects
  const filteredEffects = useMemo(() => {
    if (!parsed) return [];
    if (!searchTerm) return parsed.effects;
    
    const term = searchTerm.toLowerCase();
    return parsed.effects.filter(e => 
      e.fileName.toLowerCase().includes(term) ||
      e.elements.some(el => 
        el.name.toLowerCase().includes(term) ||
        el.material.toLowerCase().includes(term)
      )
    );
  }, [parsed, searchTerm]);

  if (!parsed) {
    return (
      <div className="efct-preview">
        <div className="efct-error">
          <span className="error-icon">⚠️</span>
          <span>Could not parse effect data</span>
        </div>
      </div>
    );
  }

  return (
    <div className="efct-preview">
      <div className="efct-header">
        <div className="efct-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            <path d="M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        </div>
        <div className="efct-title">
          <h3>Particle Effect</h3>
          <span className="efct-name">{asset.name}</span>
        </div>
      </div>

      <div className="efct-content">
        {/* Properties */}
        <div className="efct-section">
          <h4>Effect Properties</h4>
          <div className="efct-properties">
            <div className="efct-property">
              <span className="prop-label">PCF Count</span>
              <span className="prop-value">{parsed.pcfCount}</span>
            </div>
            <div className="efct-property">
              <span className="prop-label">Version</span>
              <span className="prop-value">v{asset.version || 2}</span>
            </div>
          </div>
        </div>

        {/* Search */}
        {parsed.effects.length > 3 && (
          <div className="efct-section">
            <div className="efct-search">
              <input
                type="text"
                placeholder="Search effects, elements, materials..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <span className="search-count">
                  {filteredEffects.length} of {parsed.effects.length}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Effects List */}
        <div className="efct-section">
          <h4>Effects ({parsed.pcfCount})</h4>
          <div className="efct-list">
            {filteredEffects.map((effect, idx) => (
              <div 
                key={idx} 
                className={`efct-item ${expandedEffect === idx ? 'expanded' : ''}`}
              >
                <div 
                  className="efct-item-header"
                  onClick={() => setExpandedEffect(expandedEffect === idx ? null : idx)}
                >
                  <span className="efct-expand">{expandedEffect === idx ? '▼' : '▶'}</span>
                  <span className="efct-filename">{effect.fileName}</span>
                  <span className="efct-count">{effect.elementCount} elements</span>
                </div>
                
                {expandedEffect === idx && (
                  <div className="efct-item-details">
                    <div className="efct-meta">
                      <span>Strings: {effect.stringCount}</span>
                    </div>
                    
                    {effect.elements.length > 0 && (
                      <div className="efct-elements">
                        <div className="elements-header">Elements</div>
                        {effect.elements.map((elem) => (
                          <div key={elem.index} className="efct-element">
                            <div className="elem-name">{elem.name}</div>
                            <div className="elem-details">
                              {elem.maxParticles > 0 && (
                                <span className="elem-particles">
                                  Max: {elem.maxParticles.toLocaleString()}
                                </span>
                              )}
                              {elem.material && (
                                <span className="elem-material" title={elem.material}>
                                  {elem.material.split('/').pop() || elem.material}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EffectPreview;
