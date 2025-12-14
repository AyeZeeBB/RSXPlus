import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Types for the exposed API
export interface FileEntry {
  name: string;
  isDirectory: boolean;
  path: string;
}

export interface FileStats {
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  created: Date;
  modified: Date;
}

export interface FileResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface OodleResult {
  success: boolean;
  data?: Buffer;
  error?: string;
  dllPath?: string;
}

export interface OodleAPI {
  init: (customDllPath?: string) => Promise<{ success: boolean; dllPath: string | null; error?: string }>;
  isAvailable: () => Promise<boolean>;
  getDllPath: () => Promise<string | null>;
  decompress: (compressedData: Uint8Array, decompressedSize: number) => Promise<OodleResult>;
}

export interface ElectronAPI {
  // Dialog operations
  openFile: () => Promise<void>;
  openFolder: () => Promise<void>;
  saveFile: (defaultPath: string, filters: Electron.FileFilter[]) => Promise<string | null>;
  selectFolder: () => Promise<string | null>;

  // File system operations
  readFile: (filePath: string) => Promise<FileResult<Buffer>>;
  readFileRange: (filePath: string, offset: number, size: number) => Promise<FileResult<Buffer>>;
  writeFile: (filePath: string, data: Buffer | Uint8Array) => Promise<FileResult<void>>;
  readDir: (dirPath: string) => Promise<FileResult<FileEntry[]>>;
  exists: (filePath: string) => Promise<boolean>;
  stat: (filePath: string) => Promise<FileResult<FileStats>>;
  mkdir: (dirPath: string) => Promise<FileResult<void>>;
  createDir: (dirPath: string) => Promise<FileResult<void>>;
  openPath: (path: string) => Promise<void>;

  // App operations
  getPath: (name: string) => Promise<string>;

  // Window operations
  minimize: () => void;
  maximize: () => void;
  close: () => void;

  // Event listeners
  onFilesOpened: (callback: (filePaths: string[]) => void) => () => void;
  onFolderOpened: (callback: (folderPath: string) => void) => () => void;
  onMenuExportSelected: (callback: () => void) => () => void;
  onMenuExportAll: (callback: () => void) => () => void;
  onMenuSettings: (callback: () => void) => () => void;
  onMenuAbout: (callback: () => void) => () => void;

  // Oodle decompression
  oodle: OodleAPI;
}

const electronAPI: ElectronAPI = {
  // Dialog operations
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  saveFile: (defaultPath, filters) => ipcRenderer.invoke('dialog:saveFile', defaultPath, filters),
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),

  // File system operations
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  readFileRange: (filePath, offset, size) => ipcRenderer.invoke('fs:readFileRange', filePath, offset, size),
  writeFile: (filePath, data) => ipcRenderer.invoke('fs:writeFile', filePath, data),
  readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath),
  exists: (filePath) => ipcRenderer.invoke('fs:exists', filePath),
  stat: (filePath) => ipcRenderer.invoke('fs:stat', filePath),
  mkdir: (dirPath) => ipcRenderer.invoke('fs:mkdir', dirPath),
  createDir: (dirPath) => ipcRenderer.invoke('fs:createDir', dirPath),
  openPath: (path) => ipcRenderer.invoke('shell:openPath', path),

  // App operations
  getPath: (name) => ipcRenderer.invoke('app:getPath', name),

  // Window operations
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),

  // Event listeners with cleanup
  onFilesOpened: (callback) => {
    const handler = (_: IpcRendererEvent, filePaths: string[]) => callback(filePaths);
    ipcRenderer.on('files:opened', handler);
    return () => ipcRenderer.removeListener('files:opened', handler);
  },
  onFolderOpened: (callback) => {
    const handler = (_: IpcRendererEvent, folderPath: string) => callback(folderPath);
    ipcRenderer.on('folder:opened', handler);
    return () => ipcRenderer.removeListener('folder:opened', handler);
  },
  onMenuExportSelected: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('menu:export-selected', handler);
    return () => ipcRenderer.removeListener('menu:export-selected', handler);
  },
  onMenuExportAll: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('menu:export-all', handler);
    return () => ipcRenderer.removeListener('menu:export-all', handler);
  },
  onMenuSettings: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('menu:settings', handler);
    return () => ipcRenderer.removeListener('menu:settings', handler);
  },
  onMenuAbout: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('menu:about', handler);
    return () => ipcRenderer.removeListener('menu:about', handler);
  },

  // Oodle decompression
  oodle: {
    init: (customDllPath) => ipcRenderer.invoke('oodle:init', customDllPath),
    isAvailable: () => ipcRenderer.invoke('oodle:isAvailable'),
    getDllPath: () => ipcRenderer.invoke('oodle:getDllPath'),
    decompress: (compressedData, decompressedSize) => 
      ipcRenderer.invoke('oodle:decompress', compressedData, decompressedSize),
  },
};

contextBridge.exposeInMainWorld('electron', electronAPI);

// Type declaration for the window object
declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
