import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { initOodle, isOodleAvailable, decompressOodle, getOodleDllPath, cleanupOodle } from './oodleDecompress';

let mainWindow: BrowserWindow | null = null;

// Check if we're in dev mode with Vite running
const isDev = process.env.VITE_DEV_SERVER === 'true';

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#1a1a2e',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1a2e',
      symbolColor: '#ffffff',
      height: 32,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // Load built files
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    // Open DevTools for debugging
    mainWindow.webContents.openDevTools();
  }

  // Register keyboard shortcut for DevTools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
      mainWindow?.webContents.toggleDevTools();
    }
  });

  // Create application menu
  createMenu();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open File...',
          accelerator: 'CmdOrCtrl+O',
          click: () => handleOpenFile(),
        },
        {
          label: 'Open Folder...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => handleOpenFolder(),
        },
        { type: 'separator' },
        {
          label: 'Export Selected',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow?.webContents.send('menu:export-selected'),
        },
        {
          label: 'Export All',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => mainWindow?.webContents.send('menu:export-all'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('menu:settings'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About RSX',
          click: () => mainWindow?.webContents.send('menu:about'),
        },
        {
          label: 'Documentation',
          click: () => {
            require('electron').shell.openExternal('https://github.com/r-ex/rsx');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function handleOpenFile(): Promise<void> {
  if (!mainWindow) return;

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open File',
    filters: [
      { name: 'All Supported Files', extensions: ['rpak', 'starpak', 'mbnk', 'bsp', 'mdl', 'bpk'] },
      { name: 'RPak Files', extensions: ['rpak'] },
      { name: 'StarPak Files', extensions: ['starpak'] },
      { name: 'Audio Banks', extensions: ['mbnk'] },
      { name: 'BSP Maps', extensions: ['bsp'] },
      { name: 'Models', extensions: ['mdl'] },
      { name: 'Bluepoint Pak', extensions: ['bpk'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    mainWindow.webContents.send('files:opened', result.filePaths);
  }
}

async function handleOpenFolder(): Promise<void> {
  if (!mainWindow) return;

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Folder',
    properties: ['openDirectory'],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    mainWindow.webContents.send('folder:opened', result.filePaths[0]);
  }
}

// IPC Handlers
ipcMain.handle('dialog:openFile', handleOpenFile);
ipcMain.handle('dialog:openFolder', handleOpenFolder);

ipcMain.handle('dialog:saveFile', async (_, defaultPath: string, filters: Electron.FileFilter[]) => {
  if (!mainWindow) return null;

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save File',
    defaultPath,
    filters,
  });

  return result.canceled ? null : result.filePath;
});

ipcMain.handle('dialog:selectFolder', async () => {
  if (!mainWindow) return null;

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Export Folder',
    properties: ['openDirectory', 'createDirectory'],
  });

  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('fs:readFile', async (_, filePath: string) => {
  try {
    const buffer = await fs.promises.readFile(filePath);
    return { success: true, data: buffer };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('fs:readFileRange', async (_, filePath: string, offset: number, size: number) => {
  try {
    // Use createReadStream for large file support (handles >2GB files)
    const chunks: Buffer[] = [];
    
    return new Promise((resolve) => {
      const stream = fs.createReadStream(filePath, {
        start: offset,
        end: offset + size - 1,
        highWaterMark: 64 * 1024, // 64KB chunks
      });
      
      stream.on('data', (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      
      stream.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ success: true, data: buffer });
      });
      
      stream.on('error', (error: Error) => {
        resolve({ success: false, error: error.message });
      });
    });
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('fs:writeFile', async (_, filePath: string, data: Buffer) => {
  try {
    await fs.promises.writeFile(filePath, data);
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('fs:readDir', async (_, dirPath: string) => {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return {
      success: true,
      data: entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        path: path.join(dirPath, entry.name),
      })),
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('fs:exists', async (_, filePath: string) => {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('fs:stat', async (_, filePath: string) => {
  try {
    const stats = await fs.promises.stat(filePath);
    return {
      success: true,
      data: {
        size: stats.size,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        created: stats.birthtime,
        modified: stats.mtime,
      },
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('fs:mkdir', async (_, dirPath: string) => {
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('fs:createDir', async (_, dirPath: string) => {
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('shell:openPath', async (_, pathToOpen: string) => {
  try {
    await shell.openPath(pathToOpen);
  } catch (error) {
    console.error('Failed to open path:', error);
  }
});

ipcMain.handle('app:getPath', (_, name: string) => {
  return app.getPath(name as any);
});

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window:close', () => {
  mainWindow?.close();
});

// Oodle decompression handlers
ipcMain.handle('oodle:init', async (_, customDllPath?: string) => {
  try {
    const success = initOodle(customDllPath);
    return { success, dllPath: getOodleDllPath() };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('oodle:isAvailable', () => {
  return isOodleAvailable();
});

ipcMain.handle('oodle:getDllPath', () => {
  return getOodleDllPath();
});

ipcMain.handle('oodle:decompress', async (_, compressedData: Uint8Array, decompressedSize: number) => {
  try {
    // Ensure Oodle is initialized
    if (!isOodleAvailable()) {
      initOodle();
    }
    
    if (!isOodleAvailable()) {
      return { success: false, error: 'Oodle not available' };
    }
    
    const result = decompressOodle(compressedData, decompressedSize);
    if (result) {
      return { success: true, data: result };
    } else {
      return { success: false, error: 'Decompression failed' };
    }
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

// App lifecycle
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
