/**
 * Type declarations for the electron preload bridge
 */

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

  // Shell operations
  openPath: (path: string) => Promise<void>;

  // App operations
  getPath: (name: string) => Promise<string>;

  // Window operations
  minimize: () => void;
  maximize: () => void;
  close: () => void;

  // Event listeners (return cleanup function)
  onFilesOpened: (callback: (filePaths: string[]) => void) => () => void;
  onFolderOpened: (callback: (folderPath: string) => void) => () => void;
  onMenuExportSelected: (callback: () => void) => () => void;
  onMenuExportAll: (callback: () => void) => () => void;
  onMenuSettings: (callback: () => void) => () => void;
  onMenuAbout: (callback: () => void) => () => void;

  // Oodle decompression
  oodle: OodleAPI;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

// Make this file a module
export {};
