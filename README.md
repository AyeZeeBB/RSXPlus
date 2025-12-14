# RSX Electron

reSource Xtractor (RSX) - An asset extraction tool for games made with the Respawn Source Engine (Titanfall, Titanfall 2, Apex Legends).

This is the Electron port of RSX, featuring a modern web-based UI built with React and TypeScript.

## Features

- 📦 **RPak Support** - Parse and extract assets from RPak files
- 🎮 **Multiple Game Support** - Titanfall, Titanfall 2, Apex Legends
- 🎨 **Modern UI** - Custom-built React interface with dark theme
- 🔍 **Asset Preview** - 3D model preview with Three.js
- 📁 **Batch Export** - Export multiple assets at once
- ⚡ **Fast** - Optimized file parsing with Web Workers

## Supported Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| RPak | `.rpak` | Respawn Pak files |
| StarPak | `.starpak` | Streaming data |
| MBNK | `.mbnk` | Miles Audio Bank |
| MDL | `.mdl` | Source Engine Models |
| BSP | `.bsp` | Map files |
| BPK | `.bpk` | Bluepoint Pak |

## Asset Types

- **Models** (mdl_, arig, aseq, etc.)
- **Textures** (txtr, uimg, etc.)
- **Materials** (matl, msnp)
- **Audio** (asrc, aevt)
- **Shaders** (shdr, shds)
- **UI** (ui, rtk, etc.)
- **Data** (dtbl, stgs, rson, etc.)
- **Maps** (rmap, llyr)

## Development

### Prerequisites

- Node.js 18+
- npm or yarn

### Setup

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Package for distribution
npm run package
```

### Project Structure

```
rsx_electron/
├── src/
│   ├── main/           # Electron main process
│   │   ├── main.ts     # Main entry point
│   │   └── preload.ts  # Preload script for IPC
│   ├── renderer/       # React frontend
│   │   ├── components/ # UI components
│   │   ├── stores/     # State management
│   │   ├── parsers/    # File format parsers
│   │   ├── types/      # TypeScript types
│   │   ├── utils/      # Utility functions
│   │   └── styles/     # CSS styles
│   └── shared/         # Shared code
├── package.json
├── tsconfig.json
├── tsconfig.main.json
└── vite.config.ts
```

## Architecture

### Main Process
Handles file system operations, native dialogs, and window management through Electron's Node.js environment.

### Renderer Process
React-based UI that runs in a Chromium-based web environment. Communicates with the main process via IPC.

### File Parsing
Binary file parsing is done in the renderer using TypeScript implementations based on the original C++ codebase.

### 3D Preview
Uses Three.js for rendering 3D model previews with orbit controls.

## Contributing

Contributions are welcome! Please read the original RSX repository's guidelines for more information.

## License

AGPL-3.0 - See [LICENSE](LICENSE) for details.

---

**Disclaimer:** By using this software, you acknowledge that the software is provided "as is", without any representations, warranties, conditions, or liabilities, to the extent permitted by law.
