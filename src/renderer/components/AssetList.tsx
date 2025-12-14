import React, { useState, useMemo, useCallback, useRef } from 'react';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { useAssetStore } from '../stores/assetStore';
import { Asset, AssetType } from '../types/asset';
import { getAssetTypeColor, getAssetTypeBadgeClass } from '../utils/assetUtils';
import { ExportDialog } from './ExportDialog';
import './AssetList.css';

interface AssetListProps {
  width: number;
  onWidthChange: (width: number) => void;
}

type SortField = 'type' | 'name' | 'guid' | 'file';
type SortDirection = 'asc' | 'desc';

const ROW_HEIGHT = 36;

export const AssetList: React.FC<AssetListProps> = ({ width, onWidthChange }) => {
  const { assets, selectedAsset, selectAsset, selectedAssets, toggleAssetSelection } = useAssetStore();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<AssetType | 'all'>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [showExportDialog, setShowExportDialog] = useState(false);
  const listRef = useRef<List>(null);

  const filteredAssets = useMemo(() => {
    let result = assets;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (asset) =>
          asset.name.toLowerCase().includes(query) ||
          asset.guid.toLowerCase().includes(query) ||
          asset.containerFile.toLowerCase().includes(query)
      );
    }

    // Apply type filter
    if (typeFilter !== 'all') {
      result = result.filter((asset) => asset.type === typeFilter);
    }

    // Apply sorting
    result = [...result].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'type':
          comparison = a.type.localeCompare(b.type);
          break;
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'guid':
          comparison = a.guid.localeCompare(b.guid);
          break;
        case 'file':
          comparison = a.containerFile.localeCompare(b.containerFile);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [assets, searchQuery, typeFilter, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleRowClick = (asset: Asset, event: React.MouseEvent) => {
    if (event.ctrlKey || event.metaKey) {
      toggleAssetSelection(asset.guid);
    } else {
      selectAsset(asset);
    }
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newWidth = Math.max(300, Math.min(800, startWidth + delta));
      onWidthChange(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const assetTypes = useMemo(() => {
    const typeCounts = new Map<string, number>();
    for (const asset of assets) {
      typeCounts.set(asset.type, (typeCounts.get(asset.type) || 0) + 1);
    }
    return Array.from(typeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count }));
  }, [assets]);

  // Get actual Asset objects for selected GUIDs
  const selectedAssetObjects = useMemo(() => {
    return assets.filter(a => selectedAssets.has(a.guid));
  }, [assets, selectedAssets]);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return (
      <svg className="sort-icon" viewBox="0 0 24 24" fill="currentColor">
        {sortDirection === 'asc' ? (
          <path d="M7 14l5-5 5 5H7z" />
        ) : (
          <path d="M7 10l5 5 5-5H7z" />
        )}
      </svg>
    );
  };

  return (
    <>
      <div className="asset-list" style={{ width }}>
        <div className="asset-list-header">
          <div className="asset-list-search">
            <svg className="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search assets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <select
            className="asset-list-filter"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as AssetType | 'all')}
          >
            <option value="all">All Types</option>
            {assetTypes.map(({ type, count }) => (
              <option key={type} value={type}>
                {type} ({count})
              </option>
            ))}
          </select>
        </div>

        <div className="asset-list-table-container">
          {/* Header */}
          <div className="asset-list-table-header">
            <div className="asset-header-cell type-cell sortable" onClick={() => handleSort('type')}>
              Type <SortIcon field="type" />
            </div>
            <div className="asset-header-cell name-cell sortable" onClick={() => handleSort('name')}>
              Name <SortIcon field="name" />
            </div>
            <div className="asset-header-cell guid-cell sortable" onClick={() => handleSort('guid')}>
              GUID <SortIcon field="guid" />
            </div>
            <div className="asset-header-cell file-cell sortable" onClick={() => handleSort('file')}>
              File <SortIcon field="file" />
            </div>
          </div>

          {/* Virtualized List */}
          <div className="asset-list-body">
            {filteredAssets.length > 0 ? (
              <AutoSizer>
                {({ height, width: autoWidth }) => (
                  <List
                    ref={listRef}
                    height={height || 400}
                    width={autoWidth || 500}
                    itemCount={filteredAssets.length}
                    itemSize={ROW_HEIGHT}
                    overscanCount={10}
                  >
                    {({ index, style }) => {
                      const asset = filteredAssets[index];
                      if (!asset) return <div style={style} />;
                      const isSelected = selectedAsset?.guid === asset.guid;
                      const isMultiSelected = selectedAssets.has(asset.guid);
                      return (
                        <div
                          style={style}
                          className={`asset-row ${isSelected ? 'selected' : ''} ${isMultiSelected ? 'multi-selected' : ''}`}
                          onClick={(e) => handleRowClick(asset, e)}
                        >
                          <div className="asset-cell type-cell">
                            <span className={`badge ${getAssetTypeBadgeClass(asset.type)}`}>
                              {asset.type}
                            </span>
                          </div>
                          <div className="asset-cell name-cell truncate" title={asset.name}>
                            {asset.name}
                          </div>
                          <div className="asset-cell guid-cell mono">{asset.guid}</div>
                          <div className="asset-cell file-cell truncate" title={asset.containerFile}>
                            {asset.containerFile.split(/[/\\]/).pop()}
                          </div>
                        </div>
                      );
                    }}
                  </List>
                )}
              </AutoSizer>
            ) : (
              <div className="asset-list-empty">
                {assets.length === 0 ? (
                  <>
                    <p>No assets loaded</p>
                    <p className="text-muted">Open a file to view assets</p>
                  </>
                ) : (
                  <>
                    <p>No matching assets</p>
                    <p className="text-muted">Try adjusting your search or filter</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="asset-list-footer">
          <span>{filteredAssets.length.toLocaleString()} assets</span>
          {selectedAssets.size > 0 && (
            <>
              <span>{selectedAssets.size.toLocaleString()} selected</span>
              <button 
                className="btn btn-primary btn-xs"
                onClick={() => setShowExportDialog(true)}
              >
                Export Selected
              </button>
            </>
          )}
        </div>
      </div>
      <div className="resizer" onMouseDown={handleResizeStart} />

      {/* Export Dialog */}
      {showExportDialog && selectedAssetObjects.length > 0 && (
        <ExportDialog
          assets={selectedAssetObjects}
          allAssets={assets}
          onClose={() => setShowExportDialog(false)}
        />
      )}
    </>
  );
};
