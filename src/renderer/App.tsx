import React, { useState, useEffect, useCallback } from 'react';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { AssetList } from './components/AssetList';
import { PreviewPanel } from './components/PreviewPanel';
import { StatusBar } from './components/StatusBar';
import { SettingsPage } from './components/SettingsPage';
import { AboutModal } from './components/AboutModal';
import { ExportDialog } from './components/ExportDialog';
import { useAssetStore } from './stores/assetStore';
import { useSettingsStore } from './stores/settingsStore';
import './styles/App.css';

type AppPage = 'main' | 'settings';

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<AppPage>('main');
  const [showAbout, setShowAbout] = useState(false);
  const [showExportAll, setShowExportAll] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(250);
  const [assetListWidth, setAssetListWidth] = useState(450);

  const { loadFiles, loadFolder, selectedAsset, selectedAssets, assets } = useAssetStore();
  const { loadSettings } = useSettingsStore();

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Set up IPC event listeners
  useEffect(() => {
    const cleanupFns: (() => void)[] = [];

    cleanupFns.push(
      window.electron.onFilesOpened((filePaths) => {
        loadFiles(filePaths);
      })
    );

    cleanupFns.push(
      window.electron.onFolderOpened((folderPath) => {
        loadFolder(folderPath);
      })
    );

    cleanupFns.push(
      window.electron.onMenuSettings(() => {
        setCurrentPage('settings');
      })
    );

    cleanupFns.push(
      window.electron.onMenuAbout(() => {
        setShowAbout(true);
      })
    );

    // Export menu handlers
    cleanupFns.push(
      window.electron.onMenuExportSelected(() => {
        // Export selected assets
        if (selectedAssets.size > 0) {
          setShowExportAll(true);
        } else if (selectedAsset) {
          // Fall back to single selected asset
          setShowExportAll(true);
        }
      })
    );

    cleanupFns.push(
      window.electron.onMenuExportAll(() => {
        // Export all loaded assets
        if (assets.length > 0) {
          setShowExportAll(true);
        }
      })
    );

    return () => {
      cleanupFns.forEach((fn) => fn());
    };
  }, [loadFiles, loadFolder, selectedAssets, selectedAsset, assets]);

  const handleOpenFile = useCallback(() => {
    window.electron.openFile();
  }, []);

  const handleOpenFolder = useCallback(() => {
    window.electron.openFolder();
  }, []);

  const handleOpenSettings = useCallback(() => {
    setCurrentPage('settings');
  }, []);

  const handleExportAll = useCallback(() => {
    if (assets.length > 0) {
      setShowExportAll(true);
    }
  }, [assets]);

  // Settings page
  if (currentPage === 'settings') {
    return (
      <div className="app">
        <TitleBar />
        <SettingsPage onBack={() => setCurrentPage('main')} />
      </div>
    );
  }

  // Main app
  return (
    <div className="app">
      <TitleBar />
      
      <div className="app-content">
        <Sidebar 
          width={sidebarWidth} 
          onWidthChange={setSidebarWidth}
          onOpenFile={handleOpenFile}
          onOpenFolder={handleOpenFolder}
          onOpenSettings={handleOpenSettings}
          onExportAll={handleExportAll}
        />
        
        <AssetList 
          width={assetListWidth} 
          onWidthChange={setAssetListWidth} 
        />
        
        <PreviewPanel asset={selectedAsset} />
      </div>

      <StatusBar />

      {showAbout && (
        <AboutModal onClose={() => setShowAbout(false)} />
      )}

      {/* Export All Dialog - triggered from menu */}
      {showExportAll && (
        <ExportDialog
          assets={
            selectedAssets.size > 0 
              ? assets.filter(a => selectedAssets.has(a.guid))
              : (selectedAsset ? [selectedAsset] : assets)
          }
          allAssets={assets}
          onClose={() => setShowExportAll(false)}
        />
      )}
    </div>
  );
};

export default App;
