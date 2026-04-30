# AI Terminal

A Tauri + Angular terminal application with integrated AI capabilities.
 ![AI Terminal Demo](demo.gif)
## Features

- Natural language command interpretation
- Integrated AI assistant
- Command history and auto-completion
- Cross-platform support (macOS, Windows, Linux)
- Modern UI built with Tauri and Angular

## Requirements

- Node.js 18+
- Rust and Cargo
- Windows builds require the Microsoft C++ Build Tools / MSVC Rust toolchain and the WebView2 Runtime
- For AI features: [Ollama](https://ollama.ai/) (macOS: `brew install ollama`; Windows: download the installer from Ollama)

## Development Setup

1. Clone the repository:
   ```
   git clone https://github.com/your-username/ai-terminal.git
   cd ai-terminal
   ```

2. Install dependencies and run the project:
   ```
   cd ai-terminal
   npm install
   npm run tauri dev
   ```

## Installation

### macOS (Homebrew)

You can install AI Terminal using Homebrew:

```bash
brew tap AiTerminalFoundation/ai-terminal
brew install --cask ai-terminal
```

After installation, you can launch the application from Spotlight or run it from the terminal:

```bash
ai-terminal
```

### Windows

Download the latest Windows installer from the GitHub Releases page:

- `ai-terminal_*_x64-setup.exe` for the NSIS installer
- `ai-terminal_*_x64_en-US.msi` for the MSI installer

If Windows asks for WebView2, install the Microsoft Edge WebView2 Runtime and launch AI Terminal again. AI features also require Ollama to be installed and running locally.

### Building Windows from Source

Install Node.js 18+, Rust with the MSVC toolchain, Microsoft C++ Build Tools, and the WebView2 Runtime. Then run:

```powershell
cd ai-terminal
npm install
npm run tauri build -- --bundles nsis,msi
```

Windows installers are generated in:

```text
src-tauri\target\release\bundle\nsis\
src-tauri\target\release\bundle\msi\
```

## Quick Guide to Using Ollama to Download `macsdeve/BetterBash3` Model

### Linux

1. **Install Ollama**

Open your terminal and run:

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

2. **Download the Model**

Run the following command:

```bash
ollama pull macsdeve/BetterBash3
```

### macOS

1. **Download Ollama**

- Visit [Ollama download page](https://ollama.com/download/mac).
- Click **Download for macOS**.

2. **Install Ollama**

- Open the downloaded `.zip` file from your `Downloads` folder.
- Drag the `Ollama.app` into your `Applications` folder.
- Open `Ollama.app` and follow any prompts.

3. **Download the Model**

Open Terminal and execute:

```bash
ollama pull macsdeve/BetterBash3
```

### Windows

1. **Download Ollama**

- Visit [Ollama download page](https://ollama.com/download/windows).
- Download and run the Windows installer.

2. **Download the Model**

Open PowerShell and execute:

```powershell
ollama pull macsdeve/BetterBash3
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[MIT License](LICENSE)
