// FUXA Client — Connection Manager
// Uses localStorage as fallback if Tauri Store plugin is not available.

const STORAGE_KEY = 'fuxa-recent-servers';
const MAX_RECENT = 10;

let recentServers = [];

// ── Persistence ──
function loadRecent() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    recentServers = raw ? JSON.parse(raw) : [];
  } catch {
    recentServers = [];
  }
}

function saveRecent() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recentServers));
}

function addRecent(url) {
  recentServers = recentServers.filter(u => u !== url);
  recentServers.unshift(url);
  if (recentServers.length > MAX_RECENT) recentServers.length = MAX_RECENT;
  saveRecent();
}

function removeRecent(url) {
  recentServers = recentServers.filter(u => u !== url);
  saveRecent();
  renderRecent();
}

// ── UI ──
function renderRecent() {
  const section = document.getElementById('recentSection');
  const list = document.getElementById('recentList');
  if (!recentServers.length) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  list.innerHTML = '';
  recentServers.forEach(url => {
    const item = document.createElement('div');
    item.className = 'recent-item';
    item.innerHTML = `
      <span class="url">${escapeHtml(url)}</span>
      <button class="remove-btn" title="Remove">&times;</button>
    `;
    item.querySelector('.url').addEventListener('click', () => {
      document.getElementById('serverUrl').value = url;
      connectToServer();
    });
    item.querySelector('.remove-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      removeRecent(url);
    });
    list.appendChild(item);
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function showError(msg) {
  const el = document.getElementById('errorMsg');
  if (msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function setLoading(loading) {
  const btn = document.getElementById('connectBtn');
  const text = btn.querySelector('.btn-text');
  const spinner = btn.querySelector('.btn-spinner');
  btn.disabled = loading;
  document.getElementById('serverUrl').disabled = loading;
  if (loading) {
    text.textContent = 'Connecting...';
    spinner.classList.remove('hidden');
  } else {
    text.textContent = 'Connect';
    spinner.classList.add('hidden');
  }
}

// ── Connection ──
async function checkServer(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(url + '/api/version', {
      signal: controller.signal,
      mode: 'no-cors'
    });
    return true;
  } catch {
    // no-cors mode always returns opaque response; try direct
    try {
      const resp = await fetch(url + '/api/version', { signal: controller.signal });
      return resp.ok;
    } catch {
      return false;
    }
  } finally {
    clearTimeout(timeout);
  }
}

window.connectToServer = async function () {
  showError('');
  let url = document.getElementById('serverUrl').value.trim();
  if (!url) {
    showError('Please enter a server URL');
    return;
  }
  // Auto-prepend http:// if no scheme
  if (!/^https?:\/\//i.test(url)) {
    url = 'http://' + url;
  }
  // Remove trailing slash
  url = url.replace(/\/+$/, '');

  setLoading(true);
  try {
    // Save to recent
    addRecent(url);
    // Load FUXA server UI in fullscreen iframe
    showFuxaFrame(url);
  } catch (err) {
    showError('Could not connect: ' + err.message);
    setLoading(false);
  }
};

function showFuxaFrame(url) {
  document.getElementById('app').style.display = 'none';

  // Create overlay with back button + iframe
  let overlay = document.getElementById('fuxaOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'fuxaOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;background:var(--bg);z-index:1000;';

    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 8px;background:var(--card-bg);border-bottom:1px solid var(--border);flex-shrink:0;';

    const backBtn = document.createElement('button');
    backBtn.className = 'btn';
    backBtn.style.cssText = 'padding:4px 12px;font-size:12px;';
    backBtn.innerHTML = '&larr; Disconnect';
    backBtn.onclick = hideFuxaFrame;

    const urlLabel = document.createElement('span');
    urlLabel.style.cssText = 'color:var(--text-muted);font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    urlLabel.textContent = url;

    toolbar.appendChild(backBtn);
    toolbar.appendChild(urlLabel);
    overlay.appendChild(toolbar);

    const iframe = document.createElement('iframe');
    iframe.id = 'fuxaFrame';
    iframe.style.cssText = 'flex:1;border:none;width:100%;';
    iframe.src = url;
    overlay.appendChild(iframe);

    document.body.appendChild(overlay);
  } else {
    const iframe = document.getElementById('fuxaFrame');
    iframe.src = url;
    overlay.style.display = 'flex';
  }
}

function hideFuxaFrame() {
  const overlay = document.getElementById('fuxaOverlay');
  if (overlay) overlay.style.display = 'none';
  document.getElementById('app').style.display = '';
  setLoading(false);
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  loadRecent();
  renderRecent();

  // Pre-fill with most recent
  if (recentServers.length) {
    document.getElementById('serverUrl').value = recentServers[0];
  }

  // Enter key to connect
  document.getElementById('serverUrl').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connectToServer();
  });

  // Focus input
  document.getElementById('serverUrl').focus();
});
