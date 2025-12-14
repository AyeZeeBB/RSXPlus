import { useState, useCallback, useEffect } from 'react';

// Normal recalculation modes (matches C++ eNormalExportRecalc)
export type NormalRecalcMode = 'none' | 'directx' | 'opengl';

// Texture name export modes (matches C++ eTextureExportName)  
export type TextureNameMode = 'guid' | 'real' | 'text' | 'semantic';

// Model export formats (matches C++ eModelExportSetting)
export type ModelExportFormat = 'cast' | 'rmax' | 'rmdl' | 'smd';

// Texture export formats (matches C++ eTextureExportSetting)
export type TextureExportFormat = 'png_highest' | 'png_all' | 'dds_highest' | 'dds_all' | 'dds_mipmapped' | 'json_meta';

export interface Settings {
  // General / Misc Settings
  defaultExportPath: string;
  rememberLastPath: boolean;
  showHiddenAssets: boolean;
  disableCachedNames: boolean;      // disable loading names from cache db
  
  // Export Settings (matches ExportSettings_t from C++)
  // Path settings
  exportPathsFull: boolean;         // Use full asset paths on export
  exportAssetDeps: boolean;         // Export asset dependencies
  
  // Texture settings
  textureExportFormat: TextureExportFormat;
  exportNormalRecalc: NormalRecalcMode;     // Normal map recalculation mode
  exportTextureNameMode: TextureNameMode;   // How to name exported textures
  exportMaterialTextures: boolean;          // Export textures with materials
  
  // Model settings
  modelExportFormat: ModelExportFormat;
  exportRigSequences: boolean;      // Export sequences with model/rig
  exportModelSkin: boolean;         // Export the selected skin for a model
  exportModelMatsTruncated: boolean; // Truncate material names in model files
  exportQCIFiles: boolean;          // Split QC into multiple include files
  
  // QC version targeting
  qcMajorVersion: number;
  qcMinorVersion: number;
  
  // Model physics export settings
  exportPhysicsContentsFilter: number;
  exportPhysicsFilterExclusive: boolean;
  exportPhysicsFilterAND: boolean;
  
  // Preview Settings (matches PreviewSettings_t from C++)
  previewCullDistance: number;      // Camera far plane distance
  previewMovementSpeed: number;     // Camera movement speed
  showGrid: boolean;
  showWireframe: boolean;
  modelRenderMode: 'pbr' | 'albedo';
  
  // Util Settings (matches UtilsSettings_t from C++)
  exportThreadCount: number;
  parseThreadCount: number;
  compressionLevel: number;         // 0=None, 1=SuperFast, 2=VeryFast, 3=Fast, 4=Normal
  
  // Advanced
  enableCaching: boolean;
  verboseLogging: boolean;
}

// Defaults matching C++ RSX defaults
const defaultSettings: Settings = {
  // General
  defaultExportPath: '',
  rememberLastPath: true,
  showHiddenAssets: false,
  disableCachedNames: false,
  
  // Export - Path
  exportPathsFull: true,
  exportAssetDeps: false,
  
  // Export - Texture
  textureExportFormat: 'png_highest',
  exportNormalRecalc: 'none',
  exportTextureNameMode: 'real',
  exportMaterialTextures: true,
  
  // Export - Model
  modelExportFormat: 'cast',
  exportRigSequences: true,
  exportModelSkin: true,
  exportModelMatsTruncated: false,
  exportQCIFiles: false,
  
  // QC version (default to latest)
  qcMajorVersion: 54,
  qcMinorVersion: 0,
  
  // Physics
  exportPhysicsContentsFilter: 0,
  exportPhysicsFilterExclusive: false,
  exportPhysicsFilterAND: false,
  
  // Preview (matching C++ PREVIEW_* defaults)
  previewCullDistance: 1000.0,     // PREVIEW_CULL_DEFAULT
  previewMovementSpeed: 10.0,       // PREVIEW_SPEED_DEFAULT  
  showGrid: true,
  showWireframe: false,
  modelRenderMode: 'pbr',
  
  // Util Settings
  exportThreadCount: 4,
  parseThreadCount: 4,
  compressionLevel: 4,              // Normal
  
  // Advanced
  enableCaching: true,
  verboseLogging: false,
};

const SETTINGS_KEY = 'rsx-settings';

// Global settings state
let globalSettings = { ...defaultSettings };
const settingsListeners = new Set<() => void>();

function notifySettingsListeners() {
  settingsListeners.forEach((listener) => listener());
}

export function useSettingsStore() {
  const [, forceUpdate] = useState({});
  
  // Subscribe to changes
  useEffect(() => {
    const listener = () => forceUpdate({});
    settingsListeners.add(listener);
    return () => {
      settingsListeners.delete(listener);
    };
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const userDataPath = await window.electron.getPath('userData');
      const settingsPath = `${userDataPath}/settings.json`;
      
      const exists = await window.electron.exists(settingsPath);
      if (exists) {
        const result = await window.electron.readFile(settingsPath);
        if (result.success && result.data) {
          // Convert Uint8Array to string using TextDecoder
          let jsonString: string;
          if (result.data instanceof Uint8Array) {
            jsonString = new TextDecoder().decode(result.data);
          } else if (typeof result.data === 'string') {
            jsonString = result.data;
          } else {
            // Handle serialized buffer object from IPC
            const values = Object.values(result.data) as number[];
            jsonString = new TextDecoder().decode(new Uint8Array(values));
          }
          const savedSettings = JSON.parse(jsonString);
          globalSettings = { ...defaultSettings, ...savedSettings };
          notifySettingsListeners();
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }, []);

  const saveSettings = useCallback(async () => {
    try {
      const userDataPath = await window.electron.getPath('userData');
      const settingsPath = `${userDataPath}/settings.json`;
      
      const data = new TextEncoder().encode(JSON.stringify(globalSettings, null, 2));
      await window.electron.writeFile(settingsPath, data);
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }, []);

  const updateSettings = useCallback((newSettings: Partial<Settings>) => {
    globalSettings = { ...globalSettings, ...newSettings };
    notifySettingsListeners();
  }, []);

  const resetSettings = useCallback(() => {
    globalSettings = { ...defaultSettings };
    notifySettingsListeners();
  }, []);

  return {
    settings: globalSettings,
    loadSettings,
    saveSettings,
    updateSettings,
    resetSettings,
  };
}
