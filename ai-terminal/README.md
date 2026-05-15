# Tauri + Angular

This template should help get you started developing with Tauri and Angular.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) + [Angular Language Service](https://marketplace.visualstudio.com/items?itemName=Angular.ng-template).

# AI Terminal

AI Terminal is a powerful terminal interface with AI capabilities. It allows you to interact with your terminal using natural language commands and provides an integrated AI assistant powered by Ollama.

## Features

- Natural language command interpretation
- Integrated AI assistant
- Command history and auto-completion
- Cross-platform support (macOS, Windows, Linux)

## Installation

### macOS (Homebrew)

You can install AI Terminal using Homebrew:
```bash
brew tap AiTerminalFoundation/ai-terminal
brew install ai-terminal
```

After installation, you can launch the application from Spotlight or run it from the terminal:

```bash
ai-terminal
```

### Windows

Download the latest Windows installer from the GitHub Releases page:

- `ai-terminal_*_x64-setup.exe` for the NSIS installer
- `ai-terminal_*_x64_en-US.msi` for the MSI installer

If Windows asks for WebView2, install the Microsoft Edge WebView2 Runtime. AI features require Ollama to be installed and running locally.

### Requirements

- Node.js 18+
- Rust and Cargo
- Windows builds require the Microsoft C++ Build Tools / MSVC Rust toolchain and the WebView2 Runtime
- For AI features: [Ollama](https://ollama.ai/) (macOS: `brew install ollama`; Windows: download the installer from Ollama)

## Building from Source

### Prerequisites

- Node.js 18+
- Rust and Cargo
- Tauri CLI

### macOS Universal Binary

To build a universal binary for macOS (arm64 + x86_64):

```bash
# Install dependencies
npm install

# Install create-dmg tool for packaging
brew install create-dmg

# Run the build script
chmod +x build-macos.sh
./build-macos.sh
```

This will create a universal binary DMG installer at `src-tauri/target/universal-apple-darwin/bundle/dmg/ai-terminal-[version].dmg`.

### Windows Installers

To build NSIS and MSI installers on Windows:

```powershell
npm install
npm run tauri build -- "--bundles=nsis,msi"
```

The installers are generated in:

```text
src-tauri\target\release\bundle\nsis\
src-tauri\target\release\bundle\msi\
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

AI Terminal is licensed under the MIT License - see the LICENSE file for details.
