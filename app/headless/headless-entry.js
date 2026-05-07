const path = require('path');
const fs = require('fs');
const os = require('os');
const { fork } = require('child_process');

const DEFAULT_CONFIG_FILE = 'fuxa-headless.config.json';

/**
 * FUXA Headless Entry Point
 * 
 * This script is the entry point for standalone binaries.
 * It ensures the project data directory exists in the user's home folder
 * and then launches the FUXA server.
 */

function getExecutableDir() {
    if (process.pkg) {
        return path.dirname(process.execPath);
    }
    return __dirname;
}

function getConfigArg() {
    const configIndex = process.argv.findIndex(arg => arg === '--config' || arg === '-c');
    if (configIndex >= 0 && process.argv[configIndex + 1]) {
        return process.argv[configIndex + 1];
    }
    const configPrefix = '--config=';
    const prefixedArg = process.argv.find(arg => arg.startsWith(configPrefix));
    if (prefixedArg) {
        return prefixedArg.slice(configPrefix.length);
    }
    return null;
}

function getConfigPath() {
    const configArg = getConfigArg();
    if (configArg) {
        return path.resolve(process.cwd(), configArg);
    }
    if (process.env.FUXA_HEADLESS_CONFIG) {
        return path.resolve(process.cwd(), process.env.FUXA_HEADLESS_CONFIG);
    }
    const cwdConfig = path.resolve(process.cwd(), DEFAULT_CONFIG_FILE);
    if (fs.existsSync(cwdConfig)) {
        return cwdConfig;
    }
    return path.join(getExecutableDir(), DEFAULT_CONFIG_FILE);
}

function loadConfig() {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
        return { configPath, config: {} };
    }
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return { configPath, config };
    } catch (err) {
        console.error(`Failed to read headless config ${configPath}: ${err.message}`);
        process.exit(1);
    }
}

function resolveUserDir(config, configPath) {
    const configuredUserDir = config.userDir || config.workDir || config.dataDir;
    if (!configuredUserDir) {
        return path.join(os.homedir(), 'fuxa-headless-data');
    }
    if (path.isAbsolute(configuredUserDir)) {
        return configuredUserDir;
    }
    return path.resolve(path.dirname(configPath), configuredUserDir);
}

function resolveUiPort(config) {
    const port = config?.ports?.ui || config?.ports?.http || config.uiPort || config.port;
    if (port === undefined || port === null || port === '') {
        return null;
    }
    const parsedPort = Number(port);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        console.error(`Invalid ui port in headless config: ${port}`);
        process.exit(1);
    }
    return parsedPort;
}

async function bootstrap() {
    console.log('FUXA Headless starting...');
    const { configPath, config } = loadConfig();
    const fuxaDataDir = resolveUserDir(config, configPath);
    const uiPort = resolveUiPort(config);

    // 1. Determine the user data directory (similar to Electron app)
    console.log(`Headless config: ${fs.existsSync(configPath) ? configPath : 'not found, using defaults'}`);
    
    // 2. Ensure the directory exists (Electron-style)
    if (!fs.existsSync(fuxaDataDir)) {
        console.log(`Creating initial data directory: ${fuxaDataDir}`);
        try {
            fs.mkdirSync(fuxaDataDir, { recursive: true });
        } catch (err) {
            console.error(`Failed to create data directory: ${err.message}`);
            process.exit(1);
        }
    } else {
        console.log(`Using existing data directory: ${fuxaDataDir}`);
    }

    // 3. Resolve the server path
    const serverPath = path.join(__dirname, 'server', 'main.js');

    if (!fs.existsSync(serverPath)) {
        console.error(`Could not find FUXA server at: ${serverPath}`);
        process.exit(1);
    }

    // 4. Launch the server (fork like Electron does)
    const serverArgs = ['--userDir', fuxaDataDir];
    if (uiPort) {
        serverArgs.push('--port', String(uiPort));
    }
    console.log(`Launching FUXA server with userDir: ${fuxaDataDir}${uiPort ? `, uiPort: ${uiPort}` : ''}`);
    
    const serverProcess = fork(serverPath, serverArgs, {
        env: { ...process.env, userDir: fuxaDataDir, PORT: uiPort || process.env.PORT },
        stdio: 'inherit'
    });

    serverProcess.on('error', (err) => {
        console.error(`Failed to start FUXA server: ${err.message}`);
        process.exit(1);
    });

    // Keep the process running
    process.on('SIGINT', () => {
        console.log('Shutting down FUXA server...');
        serverProcess.kill('SIGTERM');
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('Shutting down FUXA server...');
        serverProcess.kill('SIGTERM');
        process.exit(0);
    });
}

bootstrap();