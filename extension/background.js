/**
 * CoDriver background.js — Service Worker
 * WebSocket client that bridges the MCP server to Chrome APIs.
 * All state persisted in chrome.storage (SW can be terminated anytime).
 */

const WS_URL = 'ws://127.0.0.1:39571';
const APPROVAL_TIMEOUT_MS = 30000;
const WRITABLE_ACTIONS = ['NAVIGATE', 'CLICK', 'TYPE', 'SEARCH'];

let ws = null;
let reconnectTimer = null;

// ─────────────────────────────────────────────
// WebSocket lifecycle
// ─────────────────────────────────────────────

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('[CoDriver] WebSocket connected');
    setStatus('connected');
    clearTimeout(reconnectTimer);
  };

  ws.onmessage = async (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    console.log('[CoDriver] Received:', msg);
    await handleCommand(msg);
  };

  ws.onerror = (err) => {
    console.warn('[CoDriver] WebSocket error', err);
  };

  ws.onclose = () => {
    console.log('[CoDriver] WebSocket disconnected');
    setStatus('disconnected');
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 3000);
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

async function setStatus(status) {
  await chrome.storage.local.set({ wsStatus: status });
  // Notify any open side panels
  chrome.runtime.sendMessage({ type: 'STATUS_CHANGE', status }).catch(() => {});
}

// ─────────────────────────────────────────────
// Command dispatcher
// ─────────────────────────────────────────────

async function handleCommand(msg) {
  const { id, action, params = {} } = msg;

  // Read-only commands — execute immediately
  if (action === 'GET_CONTENT' || action === 'GET_URL') {
    try {
      const result = await executeAction(action, params);
      send({ id, success: true, data: result });
      await appendLog({ id, action, params, status: 'executed', result });
    } catch (err) {
      send({ id, success: false, error: err.message });
    }
    return;
  }

  // SCREENSHOT — execute immediately (debugger shows its own warning bar)
  if (action === 'SCREENSHOT') {
    try {
      const result = await executeAction(action, params);
      send({ id, success: true, data: result });
      await appendLog({ id, action, params, status: 'executed' });
    } catch (err) {
      send({ id, success: false, error: err.message });
    }
    return;
  }

  // Write commands — queue for human approval
  if (WRITABLE_ACTIONS.includes(action)) {
    await queuePending({ id, action, params });

    // Wait for approval or timeout
    const approved = await waitForApproval(id);
    if (!approved) {
      send({ id, success: false, blocked: true, reason: 'User denied or timed out' });
      await appendLog({ id, action, params, status: 'blocked' });
      return;
    }

    try {
      const result = await executeAction(action, params);
      send({ id, success: true, data: result });
      await appendLog({ id, action, params, status: 'approved', result });
    } catch (err) {
      send({ id, success: false, error: err.message });
      await appendLog({ id, action, params, status: 'error', error: err.message });
    }
  }
}

// ─────────────────────────────────────────────
// Approval queue helpers
// ─────────────────────────────────────────────

async function queuePending(item) {
  const { pendingActions = [] } = await chrome.storage.local.get('pendingActions');
  pendingActions.push({ ...item, queuedAt: Date.now() });
  await chrome.storage.local.set({ pendingActions });
  // Notify side panel
  chrome.runtime.sendMessage({ type: 'PENDING_UPDATED' }).catch(() => {});
}

async function removePending(id) {
  const { pendingActions = [] } = await chrome.storage.local.get('pendingActions');
  const updated = pendingActions.filter(a => a.id !== id);
  await chrome.storage.local.set({ pendingActions: updated });
}

function waitForApproval(id) {
  return new Promise((resolve) => {
    const deadline = Date.now() + APPROVAL_TIMEOUT_MS;

    const checkApproval = async () => {
      const { approvals = {} } = await chrome.storage.local.get('approvals');
      if (id in approvals) {
        const decision = approvals[id];
        // Clean up
        delete approvals[id];
        await chrome.storage.local.set({ approvals });
        await removePending(id);
        resolve(decision === 'approve');
        return;
      }
      if (Date.now() > deadline) {
        await removePending(id);
        resolve(false); // auto-block on timeout
        return;
      }
      setTimeout(checkApproval, 500);
    };

    checkApproval();
  });
}

// ─────────────────────────────────────────────
// Action executors
// ─────────────────────────────────────────────

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab found');
  return tab;
}

async function executeAction(action, params) {
  const tab = await getActiveTab();
  const tabId = tab.id;

  switch (action) {
    case 'GET_URL':
      return { url: tab.url, title: tab.title };

    case 'GET_CONTENT': {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
          title: document.title,
          url: location.href,
          text: document.body ? document.body.innerText.slice(0, 15000) : '',
        }),
      });
      return results[0]?.result || {};
    }

    case 'NAVIGATE': {
      const url = params.url.startsWith('http') ? params.url : `https://${params.url}`;
      await chrome.tabs.update(tabId, { url });
      // Wait for navigation
      await waitForNavigation(tabId);
      const updated = await chrome.tabs.get(tabId);
      return { url: updated.url, title: updated.title };
    }

    case 'CLICK': {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (selector) => {
          const el = document.querySelector(selector);
          if (!el) return { success: false, error: `Element not found: ${selector}` };
          el.click();
          return { success: true };
        },
        args: [params.selector],
      });
      const res = results[0]?.result;
      if (res && !res.success) throw new Error(res.error);
      return res;
    }

    case 'TYPE': {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (selector, text) => {
          const el = document.querySelector(selector);
          if (!el) return { success: false, error: `Element not found: ${selector}` };
          el.focus();
          el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true };
        },
        args: [params.selector, params.text],
      });
      const res = results[0]?.result;
      if (res && !res.success) throw new Error(res.error);
      return res;
    }

    case 'SCREENSHOT': {
      await chrome.debugger.attach({ tabId }, '1.3');
      try {
        const result = await chrome.debugger.sendCommand(
          { tabId },
          'Page.captureScreenshot',
          { format: 'png', quality: 80 }
        );
        return { dataUrl: `data:image/png;base64,${result.data}` };
      } finally {
        chrome.debugger.detach({ tabId }).catch(() => {});
      }
    }

    case 'SEARCH': {
      const query = encodeURIComponent(params.query || '');
      const url = `https://www.google.com/search?q=${query}`;
      await chrome.tabs.update(tabId, { url });
      await waitForNavigation(tabId);
      // Return page content
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
          title: document.title,
          url: location.href,
          text: document.body ? document.body.innerText.slice(0, 10000) : '',
        }),
      });
      return results[0]?.result || {};
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

function waitForNavigation(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 8000);
    chrome.webNavigation.onCompleted.addListener(function listener(details) {
      if (details.tabId === tabId && details.frameId === 0) {
        clearTimeout(timeout);
        chrome.webNavigation.onCompleted.removeListener(listener);
        setTimeout(resolve, 300); // small settle delay
      }
    });
  });
}

// ─────────────────────────────────────────────
// Action log
// ─────────────────────────────────────────────

async function appendLog(entry) {
  const { actionLog = [] } = await chrome.storage.local.get('actionLog');
  actionLog.unshift({ ...entry, timestamp: Date.now() });
  if (actionLog.length > 100) actionLog.length = 100; // cap at 100
  await chrome.storage.local.set({ actionLog });
  chrome.runtime.sendMessage({ type: 'LOG_UPDATED' }).catch(() => {});
}

// ─────────────────────────────────────────────
// Message handler from side panel
// ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'APPROVE' || msg.type === 'BLOCK') {
    chrome.storage.local.get('approvals').then(({ approvals = {} }) => {
      approvals[msg.id] = msg.type === 'APPROVE' ? 'approve' : 'block';
      chrome.storage.local.set({ approvals });
    });
    sendResponse({ ok: true });
  }
  if (msg.type === 'GET_STATUS') {
    chrome.storage.local.get(['wsStatus', 'pendingActions', 'actionLog']).then(sendResponse);
    return true;
  }
  return true;
});

// ─────────────────────────────────────────────
// Open side panel on toolbar click
// ─────────────────────────────────────────────

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// ─────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────

connect();
