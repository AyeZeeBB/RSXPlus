# RSXPlus

<p align="center">
  <strong>A modern Electron-based asset viewer and extractor for Respawn Source Engine games</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#supported-games">Supported Games</a> •
  <a href="#installation">Installation</a> •
  <a href="#development">Development</a> •
  <a href="#credits">Credits</a>
</p>

---

## About

RSXPlus is a cross-platform desktop application for viewing and extracting assets from games built on the Respawn Source Engine. Built with Electron, React, and TypeScript, it provides a modern UI experience with real-time asset previews.

This project is based on the original [RSX (reSource Xtractor)](https://github.com/r-ex/rsx) by r-ex.

## Features

- **Multi-Game Support** - Titanfall, Titanfall 2, and Apex Legends
- **RPak Parsing** - Full support for Respawn's pak file format
- **Real-Time Previews**
  - 3D model viewer with orbit controls (Three.js)
  - Texture viewer with mip levels, channels, and zoom
  - Material viewer with PBR texture slots
  - Audio playback (coming soon)
- **Multiple Export Formats**
  - Models: OBJ, SMD, Cast, RMAX
  - Textures: PNG, DDS, TGA
  - Materials: JSON with texture references
- **StarPak Streaming** - Load high-resolution textures from streaming paks
- **Modern Dark UI** - Clean, customizable interface
- **Fast & Efficient** - Optimized binary parsing

## Supported Games

| Game | Status |
|------|--------|
| Apex Legends | Full Support |
| Titanfall 2 | Full Support |
| Titanfall | Partial Support |

## Supported Asset Types

| Category | Types |
|----------|-------|
| **Models** | mdl_, arig, aseq |
| **Textures** | txtr, uimg |
| **Materials** | matl, msnp |
| **Audio** | asrc, aevt |
| **Shaders** | shdr, shds |
| **UI** | ui, rtk |
| **Data** | dtbl, stgs, rson |
| **Maps** | rmap, llyr |

## Installation

### Pre-built Releases

Download the latest release from the [Releases](../../releases) page.

### Building from Source

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/rsxplus.git
cd rsxplus

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Start the application
npm start
```

## Development

### Prerequisites

- Node.js 18+
- npm

### Project Structure

```
rsxplus/
├── src/
│   ├── main/           # Electron main process
│   │   ├── main.ts     # Entry point, IPC handlers
│   │   ├── preload.ts  # Context bridge for renderer
│   │   └── oodleDecompress.ts  # Native Oodle integration
│   └── renderer/       # React frontend
│       ├── components/ # UI components (previews, panels)
│       ├── parsers/    # Binary file parsers
│       ├── stores/     # Zustand state management
│       ├── services/   # Export services
│       ├── utils/      # Helper utilities
│       └── styles/     # CSS styles
├── dist/               # Build output
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### Key Technologies

- **Electron** - Cross-platform desktop framework
- **React** - UI library
- **TypeScript** - Type-safe JavaScript
- **Vite** - Fast build tool
- **Three.js** - 3D rendering
- **Zustand** - State management

## Credits

### Original RSX Project

This project is based on and inspired by the original **[RSX (reSource Xtractor)](https://github.com/r-ex/rsx)** created by the r-ex team. Their incredible work reverse-engineering Respawn's file formats made this project possible.

**Original RSX Contributors:**
- [Rika](https://github.com/rikadesho) - Lead developer
- [rexx](https://github.com/r-ex) - Core contributor
- And all other contributors to the original project

### RSXPlus

- Built with ❤️ using modern web technologies

## License

This project is licensed under **AGPL-3.0** - see the [LICENSE](LICENSE) file for details.

This is in accordance with the original RSX project's license.

---

<p align="center">
  <sub>
    <strong>Disclaimer:</strong> This software is provided "as is", without warranty of any kind. 
    This tool is intended for legitimate purposes such as modding, research, and personal use.
    Please respect game developers and their intellectual property.
  </sub>
</p>
