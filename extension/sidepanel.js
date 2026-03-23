/**
 * CoDriver sidepanel.js — Side Panel Logic
 * Polls chrome.storage for pending actions + action log.
 * Handles approve/block decisions, mode toggle, live status.
 */

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const pendingList = document.getElementById('pendingList');
const pendingBadge = document.getElementById('pendingBadge');
const logList = document.getElementById('logList');
const clearLogBtn = document.getElementById('clearLogBtn');
const modeButtons = document.querySelectorAll('.mode-btn');

let currentMode = 'copilot';

// ─────────────────────────────────────────────
// Mode toggle
// ─────────────────────────────────────────────

modeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    modeButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.dataset.mode;
    chrome.storage.local.set({ coDriverMode: currentMode });
  });
});

// ─────────────────────────────────────────────
// Status display
// ─────────────────────────────────────────────

function updateStatus(status) {
  statusDot.className = 'status-dot';
  if (status === 'connected') {
    statusDot.classList.add('connected');
    statusText.textContent = 'Connected';
  } else if (status === 'connecting') {
    statusDot.classList.add('connecting');
    statusText.textContent = 'Connecting…';
  } else {
    statusText.textContent = 'Disconnected';
  }
}

// ─────────────────────────────────────────────
// Pending actions rendering
// ─────────────────────────────────────────────

function describeAction(action, params) {
  switch (action) {
    case 'NAVIGATE': return `Navigate to <code>${params.url || ''}</code>`;
    case 'CLICK': return `Click element <code>${params.selector || ''}</code>`;
    case 'TYPE': return `Type <code>${(params.text || '').slice(0, 40)}${(params.text || '').length > 40 ? '…' : ''}</code> into <code>${params.selector || ''}</code>`;
    case 'SEARCH': return `Search for <code>${params.query || ''}</code>`;
    default: return `${action} ${JSON.stringify(params)}`;
  }
}

function actionIcon(status) {
  switch (status) {
    case 'approved': return '✅';
    case 'blocked': return '🚫';
    case 'executed': return '⚡';
    case 'error': return '⚠️';
    default: return '⏳';
  }
}

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function renderPending(pending) {
  if (!pending || pending.length === 0) {
    pendingList.innerHTML = '<div class="empty-state">No pending AI actions</div>';
    pendingBadge.classList.add('hidden');
    return;
  }

  pendingBadge.textContent = pending.length;
  pendingBadge.classList.remove('hidden');

  pendingList.innerHTML = pending.map(item => `
    <div class="pending-card highlight" data-id="${item.id}">
      <div class="pending-action-label">${item.action}</div>
      <div class="pending-desc">${describeAction(item.action, item.params)}</div>
      <div class="pending-timer">Queued ${timeAgo(item.queuedAt)} · auto-blocks in 30s</div>
      <div class="action-btns">
        <button class="btn btn-approve" data-id="${item.id}">✅ Approve</button>
        <button class="btn btn-block" data-id="${item.id}">❌ Block</button>
      </div>
    </div>
  `).join('');

  // Attach click handlers
  pendingList.querySelectorAll('.btn-approve').forEach(btn => {
    btn.addEventListener('click', () => sendDecision(btn.dataset.id, 'APPROVE'));
  });
  pendingList.querySelectorAll('.btn-block').forEach(btn => {
    btn.addEventListener('click', () => sendDecision(btn.dataset.id, 'BLOCK'));
  });
}

function sendDecision(id, type) {
  chrome.runtime.sendMessage({ type, id });
  // Optimistically remove from UI
  const card = pendingList.querySelector(`[data-id="${id}"]`);
  if (card) {
    card.style.opacity = '0.4';
    card.style.pointerEvents = 'none';
  }
}

// ─────────────────────────────────────────────
// Action log rendering
// ─────────────────────────────────────────────

function renderLog(log) {
  if (!log || log.length === 0) {
    logList.innerHTML = '<div class="empty-state">No actions yet</div>';
    return;
  }

  logList.innerHTML = log.slice(0, 50).map(entry => `
    <div class="log-entry log-status-${entry.status}">
      <span class="log-icon">${actionIcon(entry.status)}</span>
      <div class="log-body">
        <div class="log-action">${entry.action}</div>
        <div class="log-detail">${getLogDetail(entry)}</div>
      </div>
      <span class="log-time">${timeAgo(entry.timestamp)}</span>
    </div>
  `).join('');
}

function getLogDetail(entry) {
  const { action, params, error } = entry;
  if (error) return `Error: ${error}`;
  if (action === 'NAVIGATE') return params.url || '';
  if (action === 'CLICK') return params.selector || '';
  if (action === 'TYPE') return `"${(params.text || '').slice(0, 40)}" → ${params.selector}`;
  if (action === 'SEARCH') return params.query || '';
  if (action === 'GET_URL') return '';
  if (action === 'GET_CONTENT') return 'page content retrieved';
  if (action === 'SCREENSHOT') return 'screenshot taken';
  return JSON.stringify(params || {}).slice(0, 60);
}

// ─────────────────────────────────────────────
// Poll & refresh
// ─────────────────────────────────────────────

async function refresh() {
  const data = await chrome.storage.local.get(['wsStatus', 'pendingActions', 'actionLog', 'coDriverMode']);
  updateStatus(data.wsStatus || 'disconnected');
  renderPending(data.pendingActions || []);
  renderLog(data.actionLog || []);

  // Restore saved mode
  if (data.coDriverMode) {
    modeButtons.forEach(b => {
      b.classList.toggle('active', b.dataset.mode === data.coDriverMode);
    });
    currentMode = data.coDriverMode;
  }
}

// Poll every 1.5s (cheap storage reads)
refresh();
setInterval(refresh, 1500);

// Also respond to background push messages
chrome.runtime.onMessage.addListener((msg) => {
  if (['STATUS_CHANGE', 'PENDING_UPDATED', 'LOG_UPDATED'].includes(msg.type)) {
    refresh();
  }
});

// Clear log button
clearLogBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({ actionLog: [] });
  renderLog([]);
});
