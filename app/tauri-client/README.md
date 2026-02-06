# FUXA Client (Tauri)

Desktop client for connecting to a remote FUXA SCADA/HMI server.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://rustup.rs/) >= 1.70
- Windows: WebView2 (pre-installed on Windows 10/11)

## Development

```bash
npm install
npm run tauri:dev
```

## Build

```bash
npm run tauri:build
```

The installer will be in `src-tauri/target/release/bundle/`.

## Usage

1. Launch the app
2. Enter the FUXA server URL (e.g. `http://192.168.1.100:1881`)
3. Click **Connect**
4. The FUXA UI loads inside the app window
5. Click **← Disconnect** to return to the connection dialog

Recent connections are saved automatically.
