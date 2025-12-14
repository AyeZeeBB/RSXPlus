/**
 * Oodle Decompression - Renderer Side Wrapper
 * 
 * This module provides Oodle decompression functionality in the renderer process
 * by calling the main process via IPC. The main process handles the actual FFI
 * calls to the Oodle DLL.
 */

// Cache for Oodle availability check
let oodleInitialized = false;
let oodleAvailable: boolean | null = null;

/**
 * Initialize Oodle with an optional custom DLL path
 * @param customDllPath Optional path to a custom Oodle DLL
 * @returns Object with success status and DLL path
 */
export async function initOodle(customDllPath?: string): Promise<{ success: boolean; dllPath: string | null; error?: string }> {
  try {
    const result = await window.electron.oodle.init(customDllPath);
    oodleInitialized = true;
    oodleAvailable = result.success;
    return result;
  } catch (error) {
    console.error('Failed to initialize Oodle:', error);
    oodleInitialized = true;
    oodleAvailable = false;
    return { success: false, dllPath: null, error: (error as Error).message };
  }
}

/**
 * Check if Oodle is available for decompression
 * @returns true if Oodle DLL is loaded and ready
 */
export async function isOodleAvailable(): Promise<boolean> {
  // Use cached value if already checked
  if (oodleAvailable !== null) {
    return oodleAvailable;
  }
  
  try {
    oodleAvailable = await window.electron.oodle.isAvailable();
    return oodleAvailable ?? false;
  } catch (error) {
    console.error('Failed to check Oodle availability:', error);
    oodleAvailable = false;
    return false;
  }
}

/**
 * Get the path to the loaded Oodle DLL
 * @returns Path to the DLL or null if not loaded
 */
export async function getOodleDllPath(): Promise<string | null> {
  try {
    return await window.electron.oodle.getDllPath();
  } catch (error) {
    console.error('Failed to get Oodle DLL path:', error);
    return null;
  }
}

/**
 * Decompress data using Oodle
 * @param compressedData The compressed data as Uint8Array
 * @param decompressedSize The expected size of the decompressed data
 * @returns Decompressed data as Uint8Array, or null on failure
 */
export async function decompressOodle(compressedData: Uint8Array, decompressedSize: number): Promise<Uint8Array | null> {
  try {
    // Ensure Oodle is initialized
    if (!oodleInitialized) {
      await initOodle();
    }
    
    if (!oodleAvailable) {
      console.warn('Oodle not available for decompression');
      return null;
    }
    
    const result = await window.electron.oodle.decompress(compressedData, decompressedSize);
    
    if (result.success && result.data) {
      // Convert to Uint8Array - data comes as ArrayBuffer-like from IPC
      // Use ArrayBuffer check instead of Buffer (Buffer not available in renderer)
      if (result.data instanceof Uint8Array) {
        return result.data;
      }
      // Handle ArrayBuffer or array-like objects
      return new Uint8Array(result.data as ArrayBuffer | ArrayLike<number>);
    } else {
      console.error('Oodle decompression failed:', result.error);
      return null;
    }
  } catch (error) {
    console.error('Oodle decompression error:', error);
    return null;
  }
}

/**
 * Decompress texture data that uses Oodle compression
 * This is a convenience wrapper for texture-specific decompression
 * @param compressedData The compressed texture data
 * @param compressedSize The size of the compressed data
 * @param decompressedSize The expected decompressed size
 * @returns Decompressed texture data as Uint8Array
 */
export async function decompressOodleTexture(
  compressedData: Uint8Array,
  compressedSize: number,
  decompressedSize: number
): Promise<Uint8Array | null> {
  // Slice to exact compressed size if needed
  const dataToDecompress = compressedData.length > compressedSize 
    ? compressedData.slice(0, compressedSize)
    : compressedData;
    
  return decompressOodle(dataToDecompress, decompressedSize);
}

/**
 * Reset Oodle state (useful for reinitializing with a different DLL)
 */
export function resetOodleState(): void {
  oodleInitialized = false;
  oodleAvailable = null;
}
