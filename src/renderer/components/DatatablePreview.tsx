import React, { useMemo, useState } from 'react';
import { Asset } from '../types/asset';
import { useAssetStore } from '../stores/assetStore';
import './DatatablePreview.css';

interface DatatablePreviewProps {
  asset: Asset;
}

// Column types enum matching C++ DatatableColumType_t
enum DatatableColumnType {
  Bool = 0,
  Int = 1,
  Float = 2,
  Vector = 3,
  String = 4,
  Asset = 5,
  AssetNoPrecache = 6,
}

const COLUMN_TYPE_NAMES: Record<number, string> = {
  [DatatableColumnType.Bool]: 'bool',
  [DatatableColumnType.Int]: 'int',
  [DatatableColumnType.Float]: 'float',
  [DatatableColumnType.Vector]: 'vector',
  [DatatableColumnType.String]: 'string',
  [DatatableColumnType.Asset]: 'asset',
  [DatatableColumnType.AssetNoPrecache]: 'asset_noprecache',
};

// Size of each column type in row data
const COLUMN_TYPE_SIZES: Record<number, number> = {
  [DatatableColumnType.Bool]: 4,  // padded bool
  [DatatableColumnType.Int]: 4,
  [DatatableColumnType.Float]: 4,
  [DatatableColumnType.Vector]: 12,  // 3 floats
  [DatatableColumnType.String]: 8,   // pointer
  [DatatableColumnType.Asset]: 8,    // pointer
  [DatatableColumnType.AssetNoPrecache]: 8,  // pointer
};

interface DatatableColumn {
  name: string;
  type: DatatableColumnType;
  rowOffset: number;
}

interface DatatableRow {
  values: (string | number | boolean | number[])[];
}

interface ParsedDatatable {
  numColumns: number;
  numRows: number;
  rowStride: number;
  columns: DatatableColumn[];
  rows: DatatableRow[];
  version: string;
}

/**
 * DatatableAssetHeader_v0_t (32 bytes / 0x20):
 * - 0x00: int numColumns
 * - 0x04: int numRows
 * - 0x08: PagePtr columns (8 bytes)
 * - 0x10: PagePtr rows (8 bytes)
 * - 0x18: int rowStride
 * - 0x1C: int unk
 * 
 * DatatableAssetHeader_v1_t (40 bytes / 0x28):
 * - 0x00: int numColumns
 * - 0x04: int numRows
 * - 0x08: PagePtr columns (8 bytes)
 * - 0x10: PagePtr rows (8 bytes)
 * - 0x18: char unk[8]
 * - 0x20: int rowStride
 * - 0x24: int unk
 * 
 * DatatableAssetColumn_v0_t (16 bytes / 0x10):
 * - 0x00: PagePtr name (8 bytes)
 * - 0x08: int type
 * - 0x0C: int rowOffset
 * 
 * DatatableAssetColumn_v1_1_t (24 bytes / 0x18):
 * - 0x00: PagePtr name (8 bytes)
 * - 0x08: char unk[8]
 * - 0x10: int type
 * - 0x14: int rowOffset
 */

const HEADER_SIZE_V0 = 0x20;
const HEADER_SIZE_V1 = 0x28;
const COLUMN_SIZE_V0 = 0x10;
const COLUMN_SIZE_V1_1 = 0x18;

// Version change dates from C++
const DTBL_CHANGE_DATE = BigInt('0x1d692d897275335');   // 25/09/2020 01:10:00 (v1.0 -> v1.1)
const DTBL_CHANGE_DATE2 = BigInt('0x1da975b0a106ef2');  // 25/04/2024 21:53:42 (v1.1 -> v1.0)

function readString(
  pageData: Uint8Array | null,
  offset: number,
  maxLen: number = 256
): string {
  if (!pageData || offset < 0 || offset >= pageData.length) {
    return '';
  }
  
  let end = offset;
  while (end < pageData.length && end < offset + maxLen && pageData[end] !== 0) {
    end++;
  }
  
  const bytes = pageData.slice(offset, end);
  try {
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

function parseDatatableFull(
  headerData: Uint8Array,
  assetVersion: number,
  createdTime: bigint | undefined,
  getPageData: (pageIndex: number) => Uint8Array | null
): ParsedDatatable | null {
  // Determine header version based on asset version
  const isV1Header = assetVersion === 1;
  const headerSize = isV1Header ? HEADER_SIZE_V1 : HEADER_SIZE_V0;
  
  if (headerData.byteLength < headerSize) {
    console.log('[dtbl] Header too small:', headerData.byteLength, 'expected:', headerSize);
    return null;
  }

  const buffer = headerData.buffer.slice(
    headerData.byteOffset,
    headerData.byteOffset + headerData.byteLength
  );
  const view = new DataView(buffer);
  
  // Read header
  const numColumns = view.getInt32(0x00, true);
  const numRows = view.getInt32(0x04, true);
  
  // Columns PagePtr at 0x08
  const columnsPageIndex = view.getInt32(0x08, true);
  const columnsPageOffset = view.getInt32(0x0C, true);
  
  // Rows PagePtr at 0x10
  const rowsPageIndex = view.getInt32(0x10, true);
  const rowsPageOffset = view.getInt32(0x14, true);
  
  // Row stride location depends on header version
  const rowStride = isV1Header 
    ? view.getInt32(0x20, true) 
    : view.getInt32(0x18, true);
  
  console.log('[dtbl] Header:', {
    numColumns,
    numRows,
    columnsPageIndex,
    columnsPageOffset,
    rowsPageIndex,
    rowsPageOffset,
    rowStride,
    assetVersion,
    isV1Header
  });
  
  if (numColumns <= 0 || numColumns > 10000 || numRows < 0 || numRows > 100000) {
    console.log('[dtbl] Invalid column/row count');
    return null;
  }
  
  // Determine column struct version for v1 header
  // v1 header can have either v0 columns (16 bytes) or v1.1 columns (24 bytes)
  let columnSize = COLUMN_SIZE_V0;
  let versionStr = `v${assetVersion}`;
  
  if (isV1Header && createdTime !== undefined) {
    if (createdTime > DTBL_CHANGE_DATE && createdTime < DTBL_CHANGE_DATE2) {
      columnSize = COLUMN_SIZE_V1_1;
      versionStr = 'v1.1';
    }
  }
  
  console.log('[dtbl] Using column size:', columnSize, 'version:', versionStr);
  
  // Get columns page data
  const columnsBuf = getPageData(columnsPageIndex);
  const columns: DatatableColumn[] = [];
  
  if (columnsBuf && columnsBuf.length > 0) {
    console.log('[dtbl] Columns page:', columnsBuf.length, 'bytes');
    
    for (let i = 0; i < numColumns; i++) {
      const offset = columnsPageOffset + (i * columnSize);
      
      if (offset + columnSize > columnsBuf.byteLength) {
        console.log('[dtbl] Column', i, 'offset out of bounds');
        break;
      }
      
      // Read name PagePtr
      const namePageIndex = columnsBuf[offset] | 
                           (columnsBuf[offset + 1] << 8) | 
                           (columnsBuf[offset + 2] << 16) | 
                           (columnsBuf[offset + 3] << 24);
      const namePageOffset = columnsBuf[offset + 4] | 
                            (columnsBuf[offset + 5] << 8) | 
                            (columnsBuf[offset + 6] << 16) | 
                            (columnsBuf[offset + 7] << 24);
      
      // Type and rowOffset location depends on column version
      let type: number;
      let rowOffset: number;
      
      if (columnSize === COLUMN_SIZE_V1_1) {
        // v1.1: type at 0x10, rowOffset at 0x14
        type = columnsBuf[offset + 0x10] | 
               (columnsBuf[offset + 0x11] << 8) | 
               (columnsBuf[offset + 0x12] << 16) | 
               (columnsBuf[offset + 0x13] << 24);
        rowOffset = columnsBuf[offset + 0x14] | 
                   (columnsBuf[offset + 0x15] << 8) | 
                   (columnsBuf[offset + 0x16] << 16) | 
                   (columnsBuf[offset + 0x17] << 24);
      } else {
        // v0: type at 0x08, rowOffset at 0x0C
        type = columnsBuf[offset + 0x08] | 
               (columnsBuf[offset + 0x09] << 8) | 
               (columnsBuf[offset + 0x0A] << 16) | 
               (columnsBuf[offset + 0x0B] << 24);
        rowOffset = columnsBuf[offset + 0x0C] | 
                   (columnsBuf[offset + 0x0D] << 8) | 
                   (columnsBuf[offset + 0x0E] << 16) | 
                   (columnsBuf[offset + 0x0F] << 24);
      }
      
      // Resolve column name
      let name = `Column${i}`;
      if (namePageIndex >= 0) {
        const nameBuf = getPageData(namePageIndex);
        if (nameBuf) {
          name = readString(nameBuf, namePageOffset) || `Column${i}`;
        }
      }
      
      console.log('[dtbl] Column', i, ':', { name, type, rowOffset });
      
      columns.push({
        name,
        type: type as DatatableColumnType,
        rowOffset
      });
    }
  } else {
    console.log('[dtbl] Failed to get columns page');
    return null;
  }
  
  // Get rows page data
  const rowsBuf = getPageData(rowsPageIndex);
  const rows: DatatableRow[] = [];
  
  if (rowsBuf && rowsBuf.length > 0 && rowStride > 0) {
    console.log('[dtbl] Rows page:', rowsBuf.length, 'bytes, stride:', rowStride);
    
    // Limit rows for preview to prevent performance issues
    const maxPreviewRows = Math.min(numRows, 500);
    
    for (let rowIdx = 0; rowIdx < maxPreviewRows; rowIdx++) {
      const rowStart = rowsPageOffset + (rowIdx * rowStride);
      
      if (rowStart + rowStride > rowsBuf.byteLength) {
        console.log('[dtbl] Row', rowIdx, 'offset out of bounds');
        break;
      }
      
      const values: (string | number | boolean | number[])[] = [];
      
      for (const column of columns) {
        const valueOffset = rowStart + column.rowOffset;
        
        try {
          switch (column.type) {
            case DatatableColumnType.Bool: {
              const val = rowsBuf[valueOffset] !== 0;
              values.push(val);
              break;
            }
            
            case DatatableColumnType.Int: {
              const val = rowsBuf[valueOffset] | 
                         (rowsBuf[valueOffset + 1] << 8) | 
                         (rowsBuf[valueOffset + 2] << 16) | 
                         (rowsBuf[valueOffset + 3] << 24);
              values.push(val);
              break;
            }
            
            case DatatableColumnType.Float: {
              const floatBytes = new Uint8Array([
                rowsBuf[valueOffset],
                rowsBuf[valueOffset + 1],
                rowsBuf[valueOffset + 2],
                rowsBuf[valueOffset + 3]
              ]);
              const floatView = new DataView(floatBytes.buffer);
              values.push(floatView.getFloat32(0, true));
              break;
            }
            
            case DatatableColumnType.Vector: {
              const vec: number[] = [];
              for (let c = 0; c < 3; c++) {
                const floatBytes = new Uint8Array([
                  rowsBuf[valueOffset + c * 4],
                  rowsBuf[valueOffset + c * 4 + 1],
                  rowsBuf[valueOffset + c * 4 + 2],
                  rowsBuf[valueOffset + c * 4 + 3]
                ]);
                const floatView = new DataView(floatBytes.buffer);
                vec.push(floatView.getFloat32(0, true));
              }
              values.push(vec);
              break;
            }
            
            case DatatableColumnType.String:
            case DatatableColumnType.Asset:
            case DatatableColumnType.AssetNoPrecache: {
              // String/Asset is a PagePtr
              const strPageIndex = rowsBuf[valueOffset] | 
                                  (rowsBuf[valueOffset + 1] << 8) | 
                                  (rowsBuf[valueOffset + 2] << 16) | 
                                  (rowsBuf[valueOffset + 3] << 24);
              const strPageOffset = rowsBuf[valueOffset + 4] | 
                                   (rowsBuf[valueOffset + 5] << 8) | 
                                   (rowsBuf[valueOffset + 6] << 16) | 
                                   (rowsBuf[valueOffset + 7] << 24);
              
              if (strPageIndex >= 0) {
                const strBuf = getPageData(strPageIndex);
                if (strBuf) {
                  const str = readString(strBuf, strPageOffset);
                  values.push(str);
                } else {
                  values.push('');
                }
              } else {
                values.push('');
              }
              break;
            }
            
            default:
              values.push(`[unknown type ${column.type}]`);
          }
        } catch (e) {
          console.log('[dtbl] Error reading value:', e);
          values.push('[error]');
        }
      }
      
      rows.push({ values });
    }
  } else {
    console.log('[dtbl] Failed to get rows page or invalid stride');
  }
  
  return {
    numColumns,
    numRows,
    rowStride,
    columns,
    rows,
    version: versionStr
  };
}

export const DatatablePreview: React.FC<DatatablePreviewProps> = ({ asset }) => {
  const { getParser } = useAssetStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  
  const parsed = useMemo(() => {
    const headerData = asset.metadata?.headerData;
    if (!headerData) {
      console.log('[dtbl] No header data available');
      return null;
    }
    
    let headerU8: Uint8Array;
    if (headerData instanceof Uint8Array) {
      headerU8 = headerData;
    } else {
      headerU8 = new Uint8Array(headerData as ArrayBuffer);
    }
    
    console.log('[dtbl] Header data size:', headerU8.length, 'containerFile:', asset.containerFile);
    
    // Get parser from asset store using containerFile
    if (asset.containerFile) {
      const parser = getParser(asset.containerFile);
      console.log('[dtbl] Got parser:', !!parser);
      if (parser) {
        // Get created time from rpak header for version detection
        let createdTime: bigint | undefined;
        try {
          // Try to get header info if available
          const header = (parser as any).header;
          if (header?.createdTime) {
            createdTime = BigInt(header.createdTime);
          }
        } catch {
          // Ignore
        }
        
        return parseDatatableFull(
          headerU8,
          asset.version || 0,
          createdTime,
          (pageIndex: number) => parser.getPageData(pageIndex)
        );
      }
    }
    
    console.log('[dtbl] No parser available');
    return null;
  }, [asset, getParser]);

  // Filter and sort rows
  const filteredRows = useMemo(() => {
    if (!parsed) return [];
    
    let rows = [...parsed.rows];
    
    // Apply search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      rows = rows.filter(row => 
        row.values.some(val => {
          const str = Array.isArray(val) 
            ? `(${val.join(', ')})` 
            : String(val);
          return str.toLowerCase().includes(term);
        })
      );
    }
    
    // Apply sort
    if (sortColumn !== null && parsed.columns[sortColumn]) {
      rows.sort((a, b) => {
        const aVal = a.values[sortColumn];
        const bVal = b.values[sortColumn];
        
        let cmp = 0;
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          cmp = aVal - bVal;
        } else if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
          cmp = (aVal ? 1 : 0) - (bVal ? 1 : 0);
        } else {
          cmp = String(aVal).localeCompare(String(bVal));
        }
        
        return sortDirection === 'asc' ? cmp : -cmp;
      });
    }
    
    return rows;
  }, [parsed, searchTerm, sortColumn, sortDirection]);

  const handleHeaderClick = (colIdx: number) => {
    if (sortColumn === colIdx) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(colIdx);
      setSortDirection('asc');
    }
  };

  const formatValue = (value: string | number | boolean | number[], type: DatatableColumnType): React.ReactNode => {
    if (Array.isArray(value)) {
      return <span className="dtbl-vector">({value.map(v => v.toFixed(2)).join(', ')})</span>;
    }
    
    if (typeof value === 'boolean') {
      return <span className={`dtbl-bool ${value ? 'true' : 'false'}`}>{value ? 'true' : 'false'}</span>;
    }
    
    if (typeof value === 'number') {
      if (type === DatatableColumnType.Float) {
        return <span className="dtbl-float">{value.toFixed(4)}</span>;
      }
      return <span className="dtbl-int">{value}</span>;
    }
    
    if (type === DatatableColumnType.Asset || type === DatatableColumnType.AssetNoPrecache) {
      return <span className="dtbl-asset">{value || '(empty)'}</span>;
    }
    
    return <span className="dtbl-string">{value || '(empty)'}</span>;
  };

  if (!parsed) {
    return (
      <div className="dtbl-preview">
        <div className="dtbl-error">
          <span className="error-icon">⚠️</span>
          <span>Could not parse datatable</span>
        </div>
      </div>
    );
  }

  return (
    <div className="dtbl-preview">
      <div className="dtbl-header">
        <div className="dtbl-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="3" y1="15" x2="21" y2="15" />
            <line x1="9" y1="3" x2="9" y2="21" />
            <line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </div>
        <div className="dtbl-title">
          <h3>Data Table</h3>
          <span className="dtbl-name">{asset.name}</span>
        </div>
      </div>

      <div className="dtbl-info">
        <div className="dtbl-stat">
          <span className="stat-label">Columns</span>
          <span className="stat-value">{parsed.numColumns}</span>
        </div>
        <div className="dtbl-stat">
          <span className="stat-label">Rows</span>
          <span className="stat-value">{parsed.numRows}</span>
        </div>
        <div className="dtbl-stat">
          <span className="stat-label">Row Stride</span>
          <span className="stat-value">{parsed.rowStride} bytes</span>
        </div>
        <div className="dtbl-stat">
          <span className="stat-label">Version</span>
          <span className="stat-value">{parsed.version}</span>
        </div>
      </div>

      <div className="dtbl-search">
        <input
          type="text"
          placeholder="Search table..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm && (
          <span className="search-results">
            {filteredRows.length} of {parsed.rows.length} rows
          </span>
        )}
      </div>

      <div className="dtbl-table-container">
        <table className="dtbl-table">
          <thead>
            <tr>
              <th className="row-num">#</th>
              {parsed.columns.map((col, idx) => (
                <th 
                  key={idx} 
                  onClick={() => handleHeaderClick(idx)}
                  className={sortColumn === idx ? `sorted ${sortDirection}` : ''}
                >
                  <div className="th-content">
                    <span className="col-name">{col.name}</span>
                    <span className="col-type">{COLUMN_TYPE_NAMES[col.type] || 'unknown'}</span>
                  </div>
                  {sortColumn === idx && (
                    <span className="sort-indicator">
                      {sortDirection === 'asc' ? '▲' : '▼'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                <td className="row-num">{rowIdx}</td>
                {row.values.map((val, colIdx) => (
                  <td key={colIdx}>
                    {formatValue(val, parsed.columns[colIdx]?.type)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {parsed.rows.length < parsed.numRows && (
        <div className="dtbl-truncated">
          Showing {parsed.rows.length} of {parsed.numRows} rows
        </div>
      )}
    </div>
  );
};

export default DatatablePreview;
