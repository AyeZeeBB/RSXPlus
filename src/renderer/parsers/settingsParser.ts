/**
 * Settings Asset Parser (stgs)
 * 
 * Settings assets contain typed configuration data based on a layout schema.
 * The layout (stlt asset) defines the field names, types, and offsets.
 */

// Mod types that can be applied to settings
export enum SettingsModType {
  IntAdd = 0x0,
  IntMultiply = 0x1,
  FloatAdd = 0x2,
  FloatMultiply = 0x3,
  Bool = 0x4,
  Number = 0x5,  // Can be int or float depending on field type
  String = 0x6
}

export const SettingsModTypeNames: Record<number, string> = {
  [SettingsModType.IntAdd]: 'int_add',
  [SettingsModType.IntMultiply]: 'int_multiply',
  [SettingsModType.FloatAdd]: 'float_add',
  [SettingsModType.FloatMultiply]: 'float_multiply',
  [SettingsModType.Bool]: 'bool',
  [SettingsModType.Number]: 'number',
  [SettingsModType.String]: 'string',
};

// Field types in settings layout
export enum SettingsFieldType {
  Bool = 0,
  Integer = 1,
  Float = 2,
  Float2 = 3,
  Float3 = 4,
  String = 5,
  Asset = 6,
  AssetNoPrecache = 7,
  Array = 8,
  ArrayDynamic = 9,
  Invalid = 0xffff
}

export const SettingsFieldTypeNames: Record<number, string> = {
  [SettingsFieldType.Bool]: 'bool',
  [SettingsFieldType.Integer]: 'int',
  [SettingsFieldType.Float]: 'float',
  [SettingsFieldType.Float2]: 'float2',
  [SettingsFieldType.Float3]: 'float3',
  [SettingsFieldType.String]: 'string',
  [SettingsFieldType.Asset]: 'asset',
  [SettingsFieldType.AssetNoPrecache]: 'asset_noprecache',
  [SettingsFieldType.Array]: 'array',
  [SettingsFieldType.ArrayDynamic]: 'array_dynamic',
};

export interface SettingsMod {
  nameIndex: number;
  name?: string;
  type: SettingsModType;
  typeName: string;
  valueOffset: number;
  value: {
    bool?: boolean;
    int?: number;
    float?: number;
    stringOffset?: number;
    string?: string;
  };
}

export interface SettingsAssetHeader {
  version: number;
  layoutGuid: string;
  name: string;
  uniqueId: number;
  valueBufSize: number;
  singlePlayerModCount: number;
  modNameCount: number;
  modValuesCount: number;
  // Page pointers for data access
  valueDataPtr?: { index: number; offset: number };
  stringDataPtr?: { index: number; offset: number };
  modNamesPtr?: { index: number; offset: number };
  modValuesPtr?: { index: number; offset: number };
}

export interface ParsedSettingsAsset {
  header: SettingsAssetHeader;
  modNames: string[];
  modValues: SettingsMod[];
  // Raw value data for potential layout-based parsing
  valueData?: ArrayBuffer;
  stringData?: ArrayBuffer;
}

/**
 * Parse a settings asset header (v1 or v2)
 */
export function parseSettingsHeader(
  data: ArrayBuffer,
  version: number,
  pageBuffers?: Map<number, ArrayBuffer>,
  pagePointers?: Array<{ pageIndex: number; pageOffset: number }>
): ParsedSettingsAsset | null {
  if (data.byteLength < 72) {
    console.warn('Settings data too small for header');
    return null;
  }

  const view = new DataView(data);
  const decoder = new TextDecoder('utf-8');

  // Layout GUID is a uint64 at offset 0
  const layoutGuidValue = view.getBigUint64(0, true);
  const layoutGuid = `0x${layoutGuidValue.toString(16).padStart(16, '0').toUpperCase()}`;

  // Parse based on version
  // v1: 72 bytes, v2: 80 bytes (has 8 extra bytes at offset 0x20)
  const isV2 = version >= 2 || data.byteLength >= 80;
  
  let uniqueId: number;
  let valueBufSize: number;
  let singlePlayerModCount: number;
  let modNameCount: number;
  let modValuesCount: number;

  if (isV2) {
    // v2 layout (80 bytes)
    uniqueId = view.getUint32(0x28, true);
    valueBufSize = view.getUint32(0x40, true);
    singlePlayerModCount = view.getInt32(0x44, true);
    modNameCount = view.getInt32(0x48, true);
    modValuesCount = view.getInt32(0x4C, true);
  } else {
    // v1 layout (72 bytes)
    uniqueId = view.getUint32(0x20, true);
    valueBufSize = view.getInt32(0x38, true);
    singlePlayerModCount = view.getInt32(0x3C, true);
    modNameCount = view.getInt32(0x40, true);
    modValuesCount = view.getInt32(0x44, true);
  }

  // Try to read name from string pointer
  let name = '';
  // The name pointer is at offset 0x18 for both versions
  // It's a page pointer that needs to be resolved

  const header: SettingsAssetHeader = {
    version: isV2 ? 2 : 1,
    layoutGuid,
    name,
    uniqueId,
    valueBufSize,
    singlePlayerModCount,
    modNameCount,
    modValuesCount
  };

  // Parse mod names and values if we have page buffers
  const modNames: string[] = [];
  const modValues: SettingsMod[] = [];

  return {
    header,
    modNames,
    modValues
  };
}

/**
 * Parse settings layout header (stlt)
 */
export interface SettingsLayoutField {
  name: string;
  helpText?: string;
  dataType: SettingsFieldType;
  typeName: string;
  valueOffset: number;
  subLayoutIndex: number;
}

/** SubLayout for array elements */
export interface SubLayout {
  fields: SettingsLayoutField[];
  arrayValueCount: number;
  totalBufferSize: number;
}

export interface SettingsLayoutHeader {
  name: string;
  hashTableSize: number;
  fieldCount: number;
  hashStepScale: number;
  hashSeed: number;
  arrayValueCount: number;
  totalBufferSize: number;
  fields: SettingsLayoutField[];
}

/**
 * Parse settings layout with field data resolved from page buffers
 */
export function parseSettingsLayoutWithData(
  headerData: ArrayBuffer,
  getPageData: (pageIndex: number) => Uint8Array | null
): SettingsLayoutHeader | null {
  if (headerData.byteLength < 72) {
    console.warn('Settings layout data too small');
    return null;
  }

  const view = new DataView(headerData);
  const decoder = new TextDecoder('utf-8');

  // Layout header structure (72 bytes for v0)
  // Offset 0x00: char* name (page pointer)
  // Offset 0x08: SettingsField_t* fieldData (page pointer)
  // Offset 0x10: SettingsFieldMap_t* fieldMap (page pointer)
  // Offset 0x18: uint32_t hashTableSize
  // Offset 0x1C: uint32_t fieldCount
  // Offset 0x20: uint32_t extraDataSizeIndex
  // Offset 0x24: uint32_t hashStepScale
  // Offset 0x28: uint32_t hashSeed
  // Offset 0x2C: int32_t arrayValueCount
  // Offset 0x30: uint32_t totalBufferSize
  // Offset 0x34: uint32_t unk_34
  // Offset 0x38: char* stringData (page pointer)
  // Offset 0x40: SettingsLayoutHeader_v0_t* subHeaders (page pointer)

  const hashTableSize = view.getUint32(0x18, true);
  const fieldCount = view.getUint32(0x1C, true);
  const hashStepScale = view.getUint32(0x24, true);
  const hashSeed = view.getUint32(0x28, true);
  const arrayValueCount = view.getInt32(0x2C, true);
  const totalBufferSize = view.getUint32(0x30, true);

  // Parse fields using fieldData, fieldMap, and stringData
  const fields: SettingsLayoutField[] = [];

  // The pointers are page pointers - we need to resolve them
  // For now, if the data is already resolved inline (which happens after pak loading),
  // we can try to find the data following the header

  // Layout name from pointer at 0x00 (already resolved in some cases)
  let name = '';

  return {
    name,
    hashTableSize,
    fieldCount,
    hashStepScale,
    hashSeed,
    arrayValueCount,
    totalBufferSize,
    fields
  };
}

export function parseSettingsLayoutHeader(
  data: ArrayBuffer,
  stringData?: ArrayBuffer
): SettingsLayoutHeader | null {
  return parseSettingsLayoutWithData(data, () => null);
}

/**
 * Parse settings values using a layout
 */
export interface SettingsValue {
  name: string;
  type: SettingsFieldType;
  typeName: string;
  value: any;
  offset: number;
  /** For arrays: the expanded element values */
  arrayElements?: SettingsValue[][];
}

export function parseSettingsValues(
  valueData: ArrayBuffer,
  layoutFields: SettingsLayoutField[],
  stringResolver?: (offset: number) => string | null,
  subLayouts?: SubLayout[]
): SettingsValue[] {
  const values: SettingsValue[] = [];
  const view = new DataView(valueData);

  for (const field of layoutFields) {
    if (field.valueOffset >= valueData.byteLength) continue;

    let value: any = null;
    let arrayElements: SettingsValue[][] | undefined;

    try {
      switch (field.dataType) {
        case SettingsFieldType.Bool:
          value = view.getUint8(field.valueOffset) !== 0;
          break;
        
        case SettingsFieldType.Integer:
          value = view.getInt32(field.valueOffset, true);
          break;
        
        case SettingsFieldType.Float:
          value = view.getFloat32(field.valueOffset, true);
          break;
        
        case SettingsFieldType.Float2:
          value = {
            x: view.getFloat32(field.valueOffset, true),
            y: view.getFloat32(field.valueOffset + 4, true)
          };
          break;
        
        case SettingsFieldType.Float3:
          value = {
            x: view.getFloat32(field.valueOffset, true),
            y: view.getFloat32(field.valueOffset + 4, true),
            z: view.getFloat32(field.valueOffset + 8, true)
          };
          break;
        
        case SettingsFieldType.String:
        case SettingsFieldType.Asset:
        case SettingsFieldType.AssetNoPrecache:
          // These are stored as PagePtr_t (8 bytes: 4 byte index + 4 byte offset)
          // The offset part is what we use to look up in stringData
          if (stringResolver && field.valueOffset + 8 <= valueData.byteLength) {
            // Read the offset part (bytes 4-7 of the PagePtr)
            const stringOffset = view.getUint32(field.valueOffset + 4, true);
            value = stringResolver(stringOffset);
            if (value === null) {
              value = `[offset: 0x${stringOffset.toString(16)}]`;
            }
          } else {
            value = '[string pointer]';
          }
          break;
        
        case SettingsFieldType.Array:
        case SettingsFieldType.ArrayDynamic:
          {
            const subLayout = subLayouts?.[field.subLayoutIndex];
            
            if (field.dataType === SettingsFieldType.ArrayDynamic) {
              // DynamicArrayData_t: { arraySize: int32, arrayOffset: int32 }
              if (field.valueOffset + 8 <= valueData.byteLength) {
                const arraySize = view.getInt32(field.valueOffset, true);
                const arrayOffset = view.getInt32(field.valueOffset + 4, true);
                value = `[${arraySize} elements]`;
                
                // Parse array elements if we have sublayout
                if (subLayout && arraySize > 0 && arraySize < 1000) {
                  arrayElements = [];
                  const elemSize = subLayout.totalBufferSize;
                  
                  for (let i = 0; i < arraySize && i < 100; i++) {
                    const elemStart = arrayOffset + (i * elemSize);
                    if (elemStart + elemSize <= valueData.byteLength) {
                      const elemBuffer = valueData.slice(elemStart, elemStart + elemSize);
                      const elemValues = parseSettingsValues(elemBuffer, subLayout.fields, stringResolver, subLayouts);
                      arrayElements.push(elemValues);
                    }
                  }
                }
              } else {
                value = `[dynamic array]`;
              }
            } else {
              // Static array - count from sublayout
              const arrayCount = subLayout?.arrayValueCount ?? 0;
              value = `[${arrayCount} elements]`;
              
              if (subLayout && arrayCount > 0 && arrayCount < 1000) {
                arrayElements = [];
                const elemSize = subLayout.totalBufferSize;
                
                for (let i = 0; i < arrayCount && i < 100; i++) {
                  const elemStart = field.valueOffset + (i * elemSize);
                  if (elemStart + elemSize <= valueData.byteLength) {
                    const elemBuffer = valueData.slice(elemStart, elemStart + elemSize);
                    const elemValues = parseSettingsValues(elemBuffer, subLayout.fields, stringResolver, subLayouts);
                    arrayElements.push(elemValues);
                  }
                }
              }
            }
          }
          break;
        
        default:
          value = `[unknown type ${field.dataType}]`;
      }
    } catch (e) {
      value = '[read error]';
    }

    values.push({
      name: field.name,
      type: field.dataType,
      typeName: field.typeName,
      value,
      offset: field.valueOffset,
      arrayElements
    });
  }

  return values;
}

/**
 * Get user-friendly display info for a settings asset
 */
export function getSettingsDisplayInfo(parsed: ParsedSettingsAsset): {
  properties: Array<{ label: string; value: string; mono?: boolean }>;
  modSummary: string;
} {
  const properties: Array<{ label: string; value: string; mono?: boolean }> = [];
  
  properties.push({
    label: 'Version',
    value: `v${parsed.header.version}`
  });

  properties.push({
    label: 'Layout GUID',
    value: parsed.header.layoutGuid,
    mono: true
  });

  if (parsed.header.uniqueId !== 0) {
    properties.push({
      label: 'Unique ID',
      value: `0x${parsed.header.uniqueId.toString(16).toUpperCase()}`,
      mono: true
    });
  }

  properties.push({
    label: 'Value Buffer Size',
    value: `${parsed.header.valueBufSize} bytes`
  });

  const modSummary = parsed.header.modValuesCount > 0
    ? `${parsed.header.modValuesCount} modifications (${parsed.header.modNameCount} named)`
    : 'No modifications';

  return { properties, modSummary };
}

/**
 * Parse a settings layout fully using the rpak parser to resolve pointers.
 * Returns the parsed fields from the layout.
 * 
 * SettingsLayoutHeader_v0_t structure (72 bytes):
 * - 0x00: PagePtr_t name (8 bytes: index + offset)
 * - 0x08: PagePtr_t fieldData (8 bytes)
 * - 0x10: PagePtr_t fieldMap (8 bytes)
 * - 0x18: uint32_t hashTableSize
 * - 0x1C: uint32_t fieldCount
 * - 0x20: uint32_t extraDataSizeIndex
 * - 0x24: uint32_t hashStepScale
 * - 0x28: uint32_t hashSeed
 * - 0x2C: int32_t arrayValueCount
 * - 0x30: uint32_t totalBufferSize
 * - 0x34: uint32_t unk_34
 * - 0x38: PagePtr_t stringData (8 bytes)
 * - 0x40: PagePtr_t subHeaders (8 bytes)
 */
export function parseSettingsLayoutFull(
  headerData: Uint8Array,
  dataPageData: Uint8Array | undefined,
  getPageData: (pageIndex: number) => Uint8Array | null
): { fields: SettingsLayoutField[]; name: string } | null {
  if (headerData.byteLength < 72) {
    return null;
  }

  // Convert to ArrayBuffer for DataView
  const buffer = headerData.buffer.slice(
    headerData.byteOffset,
    headerData.byteOffset + headerData.byteLength
  );
  const view = new DataView(buffer);
  const decoder = new TextDecoder('utf-8');

  // Read header scalar fields
  const hashTableSize = view.getUint32(0x18, true);
  const fieldCount = view.getUint32(0x1C, true);

  // Read the PagePtr_t structures (each is 8 bytes: 4 bytes index + 4 bytes offset)
  // fieldData PagePtr at 0x08
  const fieldDataPageIndex = view.getInt32(0x08, true);
  const fieldDataPageOffset = view.getInt32(0x0C, true);
  // fieldMap PagePtr at 0x10
  const fieldMapPageIndex = view.getInt32(0x10, true);
  const fieldMapPageOffset = view.getInt32(0x14, true);
  // stringData PagePtr at 0x38
  const stringDataPageIndex = view.getInt32(0x38, true);
  const stringDataPageOffset = view.getInt32(0x3C, true);
  
  const fields: SettingsLayoutField[] = [];
  let name = '';

  console.log('[stlt] Parsing layout fields:', { 
    fieldCount, 
    hashTableSize,
    fieldData: { page: fieldDataPageIndex, offset: fieldDataPageOffset },
    fieldMap: { page: fieldMapPageIndex, offset: fieldMapPageOffset },
    stringData: { page: stringDataPageIndex, offset: stringDataPageOffset }
  });

  // Resolve page pointers to actual data
  const fieldDataBuf = getPageData(fieldDataPageIndex);
  const fieldMapBuf = getPageData(fieldMapPageIndex);
  const stringDataBuf = getPageData(stringDataPageIndex);
  
  console.log('[stlt] Resolved pages:', {
    fieldData: fieldDataBuf?.length || 0,
    fieldMap: fieldMapBuf?.length || 0,
    stringData: stringDataBuf?.length || 0
  });

  if (!fieldDataBuf || !fieldMapBuf || !stringDataBuf) {
    console.log('[stlt] Missing page data');
    return { fields, name };
  }

  // Parse fields using the C++ approach:
  // for (i = 0; i < fieldCount; i++) {
  //   map = fieldMap[i]
  //   entry = fieldData[map.fieldBucketIndex]
  // }
  if (fieldCount > 0) {
    console.log('[stlt] Parsing', fieldCount, 'fields');
    
    try {
      // SettingsField_t is 8 bytes
      const FIELD_SIZE = 8;
      // SettingsFieldMap_t is 4 bytes
      const MAP_SIZE = 4;
      
      for (let i = 0; i < fieldCount && i < 1000; i++) {
        // Read from fieldMap[i] to get the bucket index
        const mapPos = fieldMapPageOffset + (i * MAP_SIZE);
        if (mapPos + MAP_SIZE > fieldMapBuf.byteLength) {
          console.log('[stlt] Field', i, 'mapPos out of bounds:', mapPos, '>', fieldMapBuf.byteLength);
          break;
        }
        
        const mapView = new DataView(
          fieldMapBuf.buffer,
          fieldMapBuf.byteOffset + mapPos,
          MAP_SIZE
        );
        const fieldBucketIndex = mapView.getUint16(0, true);
        const helpTextIndex = mapView.getUint16(2, true);
        
        // Read from fieldData[fieldBucketIndex]
        const fieldPos = fieldDataPageOffset + (fieldBucketIndex * FIELD_SIZE);
        if (fieldPos + FIELD_SIZE > fieldDataBuf.byteLength) {
          console.log('[stlt] Field', i, 'fieldPos out of bounds:', fieldPos, '>', fieldDataBuf.byteLength);
          continue;
        }
        
        const fieldView = new DataView(
          fieldDataBuf.buffer,
          fieldDataBuf.byteOffset + fieldPos,
          FIELD_SIZE
        );
        
        const dataType = fieldView.getUint16(0, true) as SettingsFieldType;
        const nameOffset = fieldView.getUint16(2, true);
        const valueOffsetAndSub = fieldView.getUint32(4, true);
        const valueOffset = valueOffsetAndSub & 0x00FFFFFF;
        const subLayoutIndex = (valueOffsetAndSub >> 24) & 0xFF;
        
        // Read field name from stringData + nameOffset
        let fieldName = '';
        const strStart = stringDataPageOffset + nameOffset;
        if (strStart < stringDataBuf.byteLength) {
          let strEnd = strStart;
          while (strEnd < stringDataBuf.byteLength && stringDataBuf[strEnd] !== 0) {
            strEnd++;
          }
          fieldName = decoder.decode(stringDataBuf.slice(strStart, strEnd));
        }
        
        if (i < 5) {
          console.log('[stlt] Field', i, ':', { 
            fieldBucketIndex, fieldPos, dataType, 
            nameOffset, strStart, fieldName, valueOffset 
          });
        }
        
        if (fieldName) {
          fields.push({
            name: fieldName,
            dataType,
            typeName: SettingsFieldTypeNames[dataType] || `type_${dataType}`,
            valueOffset,
            subLayoutIndex
          });
        }
      }
      
      // Sort fields by value offset
      fields.sort((a, b) => a.valueOffset - b.valueOffset);
      
      console.log('[stlt] Successfully parsed', fields.length, 'fields');
      
    } catch (e) {
      console.warn('Failed to parse layout fields:', e);
    }
  }
  
  // Parse subHeaders for array element layouts (at offset 0x40)
  const subLayouts: SubLayout[] = [];
  const subHeadersPageIndex = view.getInt32(0x40, true);
  const subHeadersPageOffset = view.getInt32(0x44, true);
  
  if (subHeadersPageIndex >= 0) {
    const subHeadersBuf = getPageData(subHeadersPageIndex);
    if (subHeadersBuf && subHeadersBuf.length > 0) {
      // Each sub-header is 72 bytes (same structure as main header)
      const SUB_HEADER_SIZE = 72;
      let subIdx = 0;
      let subOffset = subHeadersPageOffset;
      
      // Parse sub-layouts until we can't read anymore or hit a reasonable limit
      while (subOffset + SUB_HEADER_SIZE <= subHeadersBuf.byteLength && subIdx < 32) {
        try {
          const subView = new DataView(
            subHeadersBuf.buffer,
            subHeadersBuf.byteOffset + subOffset,
            SUB_HEADER_SIZE
          );
          
          // Read key fields from sub-header
          const subFieldCount = subView.getUint32(0x1C, true);
          const subArrayValueCount = subView.getInt32(0x2C, true);
          const subTotalBufferSize = subView.getUint32(0x30, true);
          
          // If fieldCount is 0 or looks invalid, stop
          if (subFieldCount === 0 || subFieldCount > 10000) {
            break;
          }
          
          // Read sub-layout's PagePtrs for fieldData, fieldMap, stringData
          const subFieldDataPageIndex = subView.getInt32(0x08, true);
          const subFieldDataPageOffset = subView.getInt32(0x0C, true);
          const subFieldMapPageIndex = subView.getInt32(0x10, true);
          const subFieldMapPageOffset = subView.getInt32(0x14, true);
          const subStringDataPageIndex = subView.getInt32(0x38, true);
          const subStringDataPageOffset = subView.getInt32(0x3C, true);
          
          const subFieldDataBuf = getPageData(subFieldDataPageIndex);
          const subFieldMapBuf = getPageData(subFieldMapPageIndex);
          const subStringDataBuf = getPageData(subStringDataPageIndex);
          
          const subFields: SettingsLayoutField[] = [];
          
          if (subFieldDataBuf && subFieldMapBuf && subStringDataBuf) {
            const FIELD_SIZE = 8;
            const MAP_SIZE = 4;
            
            for (let i = 0; i < subFieldCount && i < 1000; i++) {
              const mapPos = subFieldMapPageOffset + (i * MAP_SIZE);
              if (mapPos + MAP_SIZE > subFieldMapBuf.byteLength) break;
              
              const mapView2 = new DataView(subFieldMapBuf.buffer, subFieldMapBuf.byteOffset + mapPos, MAP_SIZE);
              const fieldBucketIndex = mapView2.getUint16(0, true);
              
              const fieldPos = subFieldDataPageOffset + (fieldBucketIndex * FIELD_SIZE);
              if (fieldPos + FIELD_SIZE > subFieldDataBuf.byteLength) continue;
              
              const fieldView2 = new DataView(subFieldDataBuf.buffer, subFieldDataBuf.byteOffset + fieldPos, FIELD_SIZE);
              const dataType = fieldView2.getUint16(0, true) as SettingsFieldType;
              const nameOffset = fieldView2.getUint16(2, true);
              const valueOffsetAndSub = fieldView2.getUint32(4, true);
              const valueOffset = valueOffsetAndSub & 0x00FFFFFF;
              const subLayoutIdx = (valueOffsetAndSub >> 24) & 0xFF;
              
              let fieldName = '';
              const strStart = subStringDataPageOffset + nameOffset;
              if (strStart < subStringDataBuf.byteLength) {
                let strEnd = strStart;
                while (strEnd < subStringDataBuf.byteLength && subStringDataBuf[strEnd] !== 0) {
                  strEnd++;
                }
                fieldName = decoder.decode(subStringDataBuf.slice(strStart, strEnd));
              }
              
              if (fieldName) {
                subFields.push({
                  name: fieldName,
                  dataType,
                  typeName: SettingsFieldTypeNames[dataType] || `type_${dataType}`,
                  valueOffset,
                  subLayoutIndex: subLayoutIdx
                });
              }
            }
            
            subFields.sort((a, b) => a.valueOffset - b.valueOffset);
          }
          
          subLayouts.push({
            fields: subFields,
            arrayValueCount: subArrayValueCount,
            totalBufferSize: subTotalBufferSize
          });
          
          console.log('[stlt] Parsed sublayout', subIdx, ':', subFields.length, 'fields, elemSize:', subTotalBufferSize);
          
          subOffset += SUB_HEADER_SIZE;
          subIdx++;
        } catch (e) {
          console.warn('Error parsing sublayout', subIdx, ':', e);
          break;
        }
      }
    }
  }
  
  return {
    fields,
    name,
    subLayouts
  };
}

/**
 * Parse settings values from a stgs asset using fields from its layout
 * 
 * stgs header structure (v1, 72 bytes):
 * - 0x00: uint64 layoutGuid
 * - 0x08: PagePtr_t valueData
 * - 0x10: PagePtr_t name
 * - 0x18: PagePtr_t stringData
 * - 0x20: uint32 uniqueID
 * - 0x24: padding
 * - 0x28: PagePtr_t modNames
 * - 0x30: PagePtr_t modValues
 * - 0x38: int valueBufSize
 * - 0x3C: int singlePlayerModCount
 * - 0x40: int modNameCount
 * - 0x44: int modValuesCount
 */
export function parseSettingsValuesFull(
  stgsHeaderData: Uint8Array,
  stgsDataPageData: Uint8Array | undefined,
  stgsVersion: number,
  layoutFields: SettingsLayoutField[],
  getPageData: (pageIndex: number) => Uint8Array | null,
  subLayouts?: SubLayout[]
): SettingsValue[] {
  if (stgsHeaderData.byteLength < 72 || layoutFields.length === 0) {
    console.log('[stgs] Cannot parse values: headerData=', stgsHeaderData.byteLength, 'fields=', layoutFields.length);
    return [];
  }

  const buffer = stgsHeaderData.buffer.slice(
    stgsHeaderData.byteOffset,
    stgsHeaderData.byteOffset + stgsHeaderData.byteLength
  );
  const view = new DataView(buffer);
  const decoder = new TextDecoder('utf-8');

  // Read the valueData PagePtr at offset 0x08
  const valueDataPageIndex = view.getInt32(0x08, true);
  const valueDataPageOffset = view.getInt32(0x0C, true);
  
  // Read the stringData PagePtr at offset 0x18
  const stringDataPageIndex = view.getInt32(0x18, true);
  const stringDataPageOffset = view.getInt32(0x1C, true);
  
  console.log('[stgs] PagePtrs:', { 
    valueData: { page: valueDataPageIndex, offset: valueDataPageOffset },
    stringData: { page: stringDataPageIndex, offset: stringDataPageOffset }
  });
  
  // Resolve the page pointers
  const valueDataBuf = getPageData(valueDataPageIndex);
  const stringDataBuf = getPageData(stringDataPageIndex);
  
  if (!valueDataBuf || valueDataBuf.length === 0) {
    console.log('[stgs] Failed to get valueData page', valueDataPageIndex);
    return [];
  }
  
  // Parse values starting from valueDataPageOffset within the resolved page
  if (valueDataPageOffset >= valueDataBuf.byteLength) {
    console.log('[stgs] valueDataPageOffset out of bounds:', valueDataPageOffset, '>=', valueDataBuf.byteLength);
    return [];
  }
  
  console.log('[stgs] Parsing values from page', valueDataPageIndex, 'offset', valueDataPageOffset, 
    'with', layoutFields.length, 'fields, stringData:', stringDataBuf?.length || 0, 'bytes');
  
  const valueBuffer = valueDataBuf.buffer.slice(
    valueDataBuf.byteOffset + valueDataPageOffset,
    valueDataBuf.byteOffset + valueDataBuf.byteLength
  );
  
  // Create string resolver using the stringData buffer
  // The offset from valueData is already an absolute offset within the stringData page
  // (NOT relative to stringDataPageOffset)
  let stringResolver: ((offset: number) => string | null) | undefined;
  if (stringDataBuf && stringDataBuf.length > 0) {
    console.log('[stgs] String data available:', stringDataBuf.length, 'bytes, pageOffset:', stringDataPageOffset);
    stringResolver = (offset: number): string | null => {
      // offset is already an absolute offset within the stringData page
      const strStart = offset;
      if (strStart < 0 || strStart >= stringDataBuf.byteLength) {
        console.log('[stgs] String offset out of bounds:', offset, '>=', stringDataBuf.byteLength);
        return null;
      }
      let strEnd = strStart;
      while (strEnd < stringDataBuf.byteLength && stringDataBuf[strEnd] !== 0) {
        strEnd++;
      }
      const result = decoder.decode(stringDataBuf.slice(strStart, strEnd));
      console.log('[stgs] Resolved string at offset', offset, ':', result.substring(0, 50));
      return result;
    };
  } else {
    console.log('[stgs] No stringData available! page:', stringDataPageIndex, 'buf:', stringDataBuf?.length);
  }
  
  return parseSettingsValues(valueBuffer, layoutFields, stringResolver, subLayouts);
}
