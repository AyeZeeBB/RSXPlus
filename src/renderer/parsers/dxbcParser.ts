/**
 * DXBC (DirectX Bytecode) Parser
 * Parses shader bytecode to extract resource bindings (texture slot names)
 */

import { BinaryReader } from '../utils/binaryUtils';

// DXBC FourCC values
const DXBC_FOURCC = 0x43425844; // 'DXBC'
const RDEF_FOURCC = 0x46454452; // 'RDEF'

// D3D_SHADER_INPUT_TYPE
export enum ShaderInputType {
  CBUFFER = 0,
  TBUFFER = 1,
  TEXTURE = 2,
  SAMPLER = 3,
  UAV_RWTYPED = 4,
  STRUCTURED = 5,
  UAV_RWSTRUCTURED = 6,
  BYTEADDRESS = 7,
  UAV_RWBYTEADDRESS = 8,
  UAV_APPEND_STRUCTURED = 9,
  UAV_CONSUME_STRUCTURED = 10,
  UAV_RWSTRUCTURED_WITH_COUNTER = 11,
}

export interface ResourceBinding {
  name: string;
  type: ShaderInputType;
  bindPoint: number;
  bindCount: number;
}

export interface DXBCParseResult {
  isValid: boolean;
  resourceBindings: Map<number, ResourceBinding>;
}

/**
 * Parse DXBC shader bytecode and extract resource bindings
 */
export function parseDXBC(data: Uint8Array): DXBCParseResult {
  const result: DXBCParseResult = {
    isValid: false,
    resourceBindings: new Map(),
  };

  if (data.length < 32) {
    return result;
  }

  const reader = new BinaryReader(data);

  // Read DXBC header
  const fourCC = reader.readUint32();
  if (fourCC !== DXBC_FOURCC) {
    return result;
  }

  // Skip hash (16 bytes) and version (4 bytes)
  reader.skip(20);

  const containerSize = reader.readUint32();
  const blobCount = reader.readUint32();

  if (containerSize > data.length || blobCount > 100) {
    return result;
  }

  result.isValid = true;

  // Read blob offsets
  const blobOffsets: number[] = [];
  for (let i = 0; i < blobCount; i++) {
    blobOffsets.push(reader.readUint32());
  }

  // Find and parse RDEF blob
  for (const offset of blobOffsets) {
    if (offset + 8 > data.length) continue;

    reader.seek(offset);
    const blobFourCC = reader.readUint32();
    const blobSize = reader.readUint32();

    if (blobFourCC === RDEF_FOURCC) {
      // Parse RDEF blob
      const rdefStart = offset + 8;
      if (rdefStart + blobSize > data.length) continue;

      parseRDEF(data, rdefStart, result.resourceBindings);
      break;
    }
  }

  return result;
}

/**
 * Parse RDEF (Resource Definition) chunk
 */
function parseRDEF(data: Uint8Array, rdefStart: number, bindings: Map<number, ResourceBinding>): void {
  const reader = new BinaryReader(data);
  reader.seek(rdefStart);

  // RDEF header
  const constBufferCount = reader.readUint32();
  const constBufferOffset = reader.readUint32();
  const boundResourceCount = reader.readUint32();
  const boundResourceOffset = reader.readUint32();

  // Skip rest of header (version info, etc.)
  // We only need resource bindings

  // Parse bound resources
  for (let i = 0; i < boundResourceCount; i++) {
    const resourceOffset = rdefStart + boundResourceOffset + (i * 32); // Each resource binding is 32 bytes
    if (resourceOffset + 32 > data.length) break;

    reader.seek(resourceOffset);

    const nameOffset = reader.readUint32();
    const type = reader.readUint32() as ShaderInputType;
    const returnType = reader.readUint32();
    const dimension = reader.readUint32();
    const numSamples = reader.readUint32();
    const bindPoint = reader.readUint32();
    const bindCount = reader.readUint32();
    const flags = reader.readUint32();

    // Read name string
    const nameStringOffset = rdefStart + nameOffset;
    const name = readNullTerminatedString(data, nameStringOffset);

    bindings.set(bindPoint, {
      name,
      type,
      bindPoint,
      bindCount,
    });
  }
}

/**
 * Read null-terminated string from buffer
 */
function readNullTerminatedString(data: Uint8Array, offset: number): string {
  let end = offset;
  while (end < data.length && data[end] !== 0) {
    end++;
  }
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(data.slice(offset, end));
}

/**
 * Extract texture binding names from shader bytecode
 * Returns a map of bind point -> texture name
 */
export function extractTextureBindings(shaderData: Uint8Array): Map<number, string> {
  const result = new Map<number, string>();
  const parsed = parseDXBC(shaderData);

  if (!parsed.isValid) {
    return result;
  }

  for (const [bindPoint, binding] of parsed.resourceBindings) {
    if (binding.type === ShaderInputType.TEXTURE) {
      result.set(bindPoint, binding.name);
    }
  }

  return result;
}
