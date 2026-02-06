# FUXA Server (Tauri)

Desktop application for managing a FUXA SCADA/HMI server instance.

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
2. Configure:
   - **Server Directory** — path to the FUXA `server/` folder
   - **Port** — server port (default: 1881)
   - **Node.js Path** — path to `node` executable (default: `node` from PATH)
3. Click **Start** to launch the FUXA server
4. Server logs appear in real-time in the log panel
5. Click **Open UI** to open the FUXA web interface in your default browser
6. Click **Stop** to shut down the server

## Notes

- The app uses the system-installed Node.js to run the FUXA server
- Server configuration is persisted between sessions
- The app manages the Node.js process lifecycle (start/stop/restart)
