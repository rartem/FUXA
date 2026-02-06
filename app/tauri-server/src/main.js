// FUXA Server Manager — Frontend Logic
// All process management via Rust commands (invoke) + Tauri events for streaming.

const STORAGE_KEY = 'fuxa-server-config';
const MAX_LOG_LINES = 2000;

let logLines = [];
let serverRunning = false;

// ── Tauri API (via window.__TAURI__ global) ──
function invoke(cmd, args) {
  if (window.__TAURI__ && window.__TAURI__.core) {
    return window.__TAURI__.core.invoke(cmd, args);
  }
  return Promise.reject('Tauri API not available');
}

function listen(event, handler) {
  if (window.__TAURI__ && window.__TAURI__.event) {
    return window.__TAURI__.event.listen(event, handler);
  }
  return Promise.resolve(function() {});
}

// ── Config persistence ──
function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

function getConfig() {
  return {
    serverDir: document.getElementById('serverDir').value.trim(),
    port: parseInt(document.getElementById('portInput').value) || 1881,
    nodeExe: document.getElementById('nodeExe').value.trim() || 'node',
  };
}

function applyConfig(cfg) {
  if (cfg.serverDir) document.getElementById('serverDir').value = cfg.serverDir;
  if (cfg.port) document.getElementById('portInput').value = cfg.port;
  if (cfg.nodeExe) document.getElementById('nodeExe').value = cfg.nodeExe;
}

// ── Logging ──
function appendLog(text, type) {
  var output = document.getElementById('logOutput');
  var placeholder = output.querySelector('.log-placeholder');
  if (placeholder) placeholder.remove();

  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line.trim()) continue;
    var el = document.createElement('span');
    el.className = 'log-line';
    if (type) {
      el.className += ' log-' + type;
    } else {
      if (line.indexOf('[ERR]') >= 0 || line.toLowerCase().indexOf('error') >= 0) {
        el.className += ' log-err';
      } else if (line.indexOf('[WRN]') >= 0 || line.toLowerCase().indexOf('warn') >= 0) {
        el.className += ' log-warn';
      } else if (line.indexOf('[INF]') >= 0 || line.indexOf('started') >= 0 || line.indexOf('running') >= 0) {
        el.className += ' log-info';
      }
    }
    el.textContent = line + '\n';
    output.appendChild(el);
    logLines.push(el);
  }

  while (logLines.length > MAX_LOG_LINES) {
    var old = logLines.shift();
    if (old.parentNode) old.parentNode.removeChild(old);
  }

  output.scrollTop = output.scrollHeight;
}

window.clearLog = function () {
  document.getElementById('logOutput').innerHTML = '<div class="log-placeholder">Server log will appear here...</div>';
  logLines = [];
};

// ── UI State ──
function setServerStatus(status) {
  var badge = document.getElementById('statusBadge');
  var startBtn = document.getElementById('startBtn');
  var stopBtn = document.getElementById('stopBtn');
  var restartBtn = document.getElementById('restartBtn');
  var openBtn = document.getElementById('openBtn');

  badge.className = 'badge';
  if (status === 'running') {
    badge.textContent = 'Running';
    badge.classList.add('badge-running');
    startBtn.disabled = true;
    stopBtn.disabled = false;
    restartBtn.disabled = false;
    openBtn.disabled = false;
    serverRunning = true;
  } else if (status === 'starting') {
    badge.textContent = 'Starting...';
    badge.classList.add('badge-starting');
    startBtn.disabled = true;
    stopBtn.disabled = false;
    restartBtn.disabled = true;
    openBtn.disabled = true;
  } else {
    badge.textContent = 'Stopped';
    badge.classList.add('badge-stopped');
    startBtn.disabled = false;
    stopBtn.disabled = true;
    restartBtn.disabled = true;
    openBtn.disabled = true;
    serverRunning = false;
  }
}

// ── Server Process Management (via Rust invoke) ──
window.startServer = async function () {
  var cfg = getConfig();
  saveConfig(cfg);

  if (!cfg.serverDir) {
    appendLog('Error: Please specify the server directory.', 'err');
    return;
  }

  setServerStatus('starting');
  appendLog('Starting FUXA server on port ' + cfg.port + '...', 'info');
  appendLog('  Directory: ' + cfg.serverDir, 'info');
  appendLog('  Node: ' + cfg.nodeExe, 'info');

  try {
    var pid = await invoke('start_server', {
      serverDir: cfg.serverDir,
      port: cfg.port,
      nodeExe: cfg.nodeExe,
    });
    appendLog('Server process spawned (PID: ' + pid + ')', 'info');
    setTimeout(function () {
      if (serverRunning || document.getElementById('statusBadge').textContent === 'Starting...') {
        setServerStatus('running');
      }
    }, 2000);
  } catch (err) {
    appendLog('Failed to start server: ' + err, 'err');
    setServerStatus('stopped');
  }
};

window.stopServer = async function () {
  appendLog('Stopping server...', 'warn');
  try {
    await invoke('stop_server');
    appendLog('Server stopped.', 'info');
    setServerStatus('stopped');
  } catch (err) {
    appendLog('Stop error: ' + err, 'err');
    setServerStatus('stopped');
  }
};

window.restartServer = async function () {
  appendLog('Restarting server...', 'warn');
  await window.stopServer();
  await new Promise(function (r) { setTimeout(r, 1500); });
  await window.startServer();
};

window.openInBrowser = function () {
  var port = document.getElementById('portInput').value || '1881';
  var url = 'http://localhost:' + port;
  window.open(url, '_blank');
};

// ── Init ──
document.addEventListener('DOMContentLoaded', function () {
  // Load saved config
  var cfg = loadConfig();
  applyConfig(cfg);

  if (!cfg.serverDir) {
    document.getElementById('serverDir').value = 'D:\\scada\\FUXA\\server';
  }

  setServerStatus('stopped');

  // Bind buttons
  document.getElementById('startBtn').addEventListener('click', function() { window.startServer(); });
  document.getElementById('stopBtn').addEventListener('click', function() { window.stopServer(); });
  document.getElementById('restartBtn').addEventListener('click', function() { window.restartServer(); });
  document.getElementById('openBtn').addEventListener('click', function() { window.openInBrowser(); });
  document.getElementById('clearLogBtn').addEventListener('click', function() { window.clearLog(); });

  // Listen for Tauri events from Rust
  listen('server-stdout', function (event) {
    appendLog(event.payload);
  });

  listen('server-stderr', function (event) {
    appendLog(event.payload, 'err');
  });

  listen('server-exit', function (event) {
    appendLog('Server process exited with code ' + event.payload, event.payload === 0 ? 'info' : 'err');
    setServerStatus('stopped');
  });
});
