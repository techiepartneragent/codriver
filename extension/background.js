/**
 * CoDriver background.js — Service Worker
 * WebSocket client that bridges the MCP server to Chrome APIs.
 * All state persisted in chrome.storage (SW can be terminated anytime).
 */

const WS_URL = 'ws://127.0.0.1:39571';
const APPROVAL_TIMEOUT_MS = 30000;
const WRITABLE_ACTIONS = ['NAVIGATE', 'CLICK', 'TYPE_TEXT', 'SEARCH'];

// POC auth token — must match server's AUTH_TOKEN
const AUTH_TOKEN = 'codriver-dev-token-2026';

let ws = null;
let reconnectTimer = null;
let authenticated = false;

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
    authenticated = false;
    setStatus('connected');
    clearTimeout(reconnectTimer);

    // Send auth token as first message
    chrome.storage.local.get('authToken').then(({ authToken }) => {
      const token = authToken || AUTH_TOKEN;
      send({ type: 'AUTH', token });
      console.log('[CoDriver] Sent auth token');
    });
  };

  ws.onmessage = async (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    console.log('[CoDriver] Received:', msg);

    // Handle auth response
    if (msg.type === 'AUTH_OK') {
      authenticated = true;
      console.log('[CoDriver] Authenticated');
      return;
    }
    if (msg.type === 'AUTH_FAIL') {
      console.error('[CoDriver] Authentication failed');
      ws.close();
      return;
    }

    if (!authenticated) {
      console.warn('[CoDriver] Ignoring message — not authenticated');
      return;
    }

    await handleCommand(msg);
  };

  ws.onerror = (err) => {
    console.warn('[CoDriver] WebSocket error', err);
  };

  ws.onclose = () => {
    console.log('[CoDriver] WebSocket disconnected');
    authenticated = false;
    setStatus('disconnected');
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 3000);
}

// ─────────────────────────────────────────────
// Keep-alive via chrome.alarms (MV3 SW can be terminated after ~30s)
// ─────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    // Accessing chrome.storage wakes the service worker
    chrome.storage.local.get('status');
    // Ensure WebSocket is connected
    connect();
    // Send ping if connected to keep WS alive
    if (ws && ws.readyState === WebSocket.OPEN) {
      send({ type: 'PING', requestId: 'ping-' + Date.now() });
    }
  }
});

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
  // Bug 1 fix: read msg.type and msg.requestId (not msg.action / msg.id)
  const { requestId, type, params = {} } = msg;

  // Read-only commands — execute immediately
  if (type === 'GET_CONTENT' || type === 'GET_URL' || type === 'GET_STRUCTURE' || type === 'GET_TABS' || type === 'SWITCH_TAB' || type === 'OPEN_TAB') {
    try {
      const result = await executeAction(type, params);
      send({ type: `${type}_RESULT`, requestId, success: true, data: result });
      await appendLog({ requestId, type, params, status: 'executed', result });
    } catch (err) {
      send({ type: `${type}_RESULT`, requestId, success: false, error: err.message });
    }
    return;
  }

  // SCREENSHOT — execute immediately (debugger shows its own warning bar)
  if (type === 'SCREENSHOT') {
    try {
      const result = await executeAction(type, params);
      send({ type: 'SCREENSHOT_RESULT', requestId, success: true, data: result });
      await appendLog({ requestId, type, params, status: 'executed' });
    } catch (err) {
      send({ type: 'SCREENSHOT_RESULT', requestId, success: false, error: err.message });
    }
    return;
  }

  // Write commands — queue for human approval
  if (WRITABLE_ACTIONS.includes(type)) {
    await queuePending({ requestId, type, params });

    // Wait for approval or timeout
    const approved = await waitForApproval(requestId);
    if (!approved) {
      send({ type: `${type}_RESULT`, requestId, success: false, blocked: true, reason: 'User denied or timed out' });
      await appendLog({ requestId, type, params, status: 'blocked' });
      return;
    }

    try {
      const result = await executeAction(type, params);
      send({ type: `${type}_RESULT`, requestId, success: true, data: result });
      await appendLog({ requestId, type, params, status: 'approved', result });
    } catch (err) {
      send({ type: `${type}_RESULT`, requestId, success: false, error: err.message });
      await appendLog({ requestId, type, params, status: 'error', error: err.message });
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

async function removePending(requestId) {
  const { pendingActions = [] } = await chrome.storage.local.get('pendingActions');
  const updated = pendingActions.filter(a => a.requestId !== requestId);
  await chrome.storage.local.set({ pendingActions: updated });
}

function waitForApproval(requestId) {
  return new Promise((resolve) => {
    const deadline = Date.now() + APPROVAL_TIMEOUT_MS;

    const checkApproval = async () => {
      const { approvals = {} } = await chrome.storage.local.get('approvals');
      if (requestId in approvals) {
        const decision = approvals[requestId];
        // Clean up
        delete approvals[requestId];
        await chrome.storage.local.set({ approvals });
        await removePending(requestId);
        resolve(decision === 'approve');
        return;
      }
      if (Date.now() > deadline) {
        await removePending(requestId);
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

async function executeAction(type, params) {
  const tab = await getActiveTab();
  const tabId = tab.id;

  switch (type) {
    case 'GET_URL':
      return { url: tab.url, title: tab.title };

    case 'GET_CONTENT': {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const clean = (el) => el ? el.innerText.trim().slice(0, 15000) : null;
          // Prefer main article content; strip nav/footer/ads
          const article =
            document.querySelector('article') ||
            document.querySelector('main') ||
            document.querySelector('[role="main"]') ||
            document.querySelector('.content, .post-content, .entry-content, .article-body');
          return {
            title: document.title,
            url: location.href,
            articleText: clean(article),
            text: document.body ? document.body.innerText.slice(0, 15000) : '',
          };
        },
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

    // Bug 2 fix: case 'TYPE_TEXT' (was 'TYPE')
    case 'TYPE_TEXT': {
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
        // Bug 3 fix (server side): return dataUrl field consistently
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

    case 'GET_STRUCTURE': {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const getText = (el) => el ? el.innerText.trim() : null;
          const getMeta = (name) => {
            const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
            return el ? el.getAttribute('content') : null;
          };
          return {
            title: document.title,
            h1: getText(document.querySelector('h1')),
            h2s: [...document.querySelectorAll('h2')].map(e => e.innerText.trim()).filter(Boolean),
            h3s: [...document.querySelectorAll('h3')].map(e => e.innerText.trim()).filter(Boolean),
            links: [...document.querySelectorAll('a[href]')]
              .slice(0, 50)
              .map(e => ({ text: e.innerText.trim(), href: e.href }))
              .filter(l => l.text),
            wordCount: (document.body?.innerText || '').split(/\s+/).filter(Boolean).length,
            publishDate: getMeta('article:published_time') || getMeta('date') || null,
            author: getMeta('author') || getText(document.querySelector('[rel="author"], .author, .byline')) || null,
            metaDescription: getMeta('description'),
          };
        },
      });
      return results[0]?.result || {};
    }

    case 'GET_TABS': {
      const tabs = await chrome.tabs.query({});
      return tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active }));
    }

    case 'SWITCH_TAB': {
      await chrome.tabs.update(params.tabId, { active: true });
      return { success: true, tabId: params.tabId };
    }

    case 'OPEN_TAB': {
      const newTab = await chrome.tabs.create({ url: params.url });
      return { success: true, tabId: newTab.id, url: params.url };
    }

    default:
      throw new Error(`Unknown action: ${type}`);
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CAPTCHA_DETECTED') {
    // Generate a single requestId for this CAPTCHA event
    const captchaRequestId = 'captcha-' + Date.now();

    // 1. Add to pending actions as CAPTCHA type
    chrome.storage.local.get(['pendingActions', 'actionLog'], (r) => {
      const pending = r.pendingActions || [];
      const log = r.actionLog || [];

      // Avoid duplicate CAPTCHA entries for same URL
      const alreadyPending = pending.some(a => a.type === 'CAPTCHA_DETECTED' && a.url === msg.url);
      if (!alreadyPending) {
        const captchaAction = {
          requestId: captchaRequestId,
          type: 'CAPTCHA_DETECTED',
          url: msg.url,
          title: msg.title,
          timestamp: Date.now(),
          status: 'waiting',
        };
        pending.unshift(captchaAction);
        log.unshift({ ...captchaAction, status: 'captcha-detected' });
        chrome.storage.local.set({ pendingActions: pending, actionLog: log });
        chrome.runtime.sendMessage({ type: 'PENDING_UPDATED' }).catch(() => {});
      }
    });

    // 2. Wait for user approval then send CAPTCHA_RESOLVED to MCP server
    waitForApproval(captchaRequestId).then(approved => {
      if (approved) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          send({ type: 'CAPTCHA_RESOLVED', url: msg.url });
        }
        appendLog({ requestId: captchaRequestId, type: 'CAPTCHA_RESOLVED', status: 'approved' });
      }
    });

    // 3. Open side panel to alert user
    if (sender && sender.tab) {
      chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
    }

    // 4. Show browser notification
    chrome.notifications.create(captchaRequestId, {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: '🛑 CoDriver: CAPTCHA Detected',
      message: 'Human needed! CAPTCHA found on ' + (msg.title || 'page') + '. Open side panel to approve.',
      priority: 2,
    });

    // 5. Send to MCP server so AI knows to pause
    if (ws && ws.readyState === WebSocket.OPEN) {
      send({
        type: 'CAPTCHA_DETECTED',
        url: msg.url,
        title: msg.title,
        requestId: captchaRequestId,
      });
    }

    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'APPROVE' || msg.type === 'BLOCK') {
    chrome.storage.local.get(['approvals', 'pendingActions']).then(({ approvals = {}, pendingActions = [] }) => {
      approvals[msg.requestId] = msg.type === 'APPROVE' ? 'approve' : 'block';
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
// Context Menus
// ─────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  // Keep-alive alarm — fires every ~20 seconds to prevent SW termination
  chrome.alarms.create('keepAlive', { periodInMinutes: 0.33 });

  chrome.contextMenus.create({
    id: 'codriver-ask',
    title: 'Ask CoDriver: "%s"',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'codriver-summarize',
    title: '🚗 Summarize this page',
    contexts: ['page'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const action =
    info.menuItemId === 'codriver-ask'
      ? { type: 'CONTEXT_QUERY', text: info.selectionText, url: info.pageUrl }
      : { type: 'CONTEXT_SUMMARIZE', url: info.pageUrl };

  chrome.storage.local.get(['actionLog'], (r) => {
    const log = r.actionLog || [];
    log.unshift({ ...action, timestamp: Date.now(), status: 'pending-user' });
    chrome.storage.local.set({ actionLog: log });
  });

  chrome.sidePanel.open({ tabId: tab.id });
});

// ─────────────────────────────────────────────
// Keyboard Shortcuts
// ─────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'approve-action') {
    const { pendingActions = [], approvals = {} } = await chrome.storage.local.get([
      'pendingActions',
      'approvals',
    ]);
    const first = pendingActions[0];
    if (first) {
      approvals[first.requestId] = 'approve';
      await chrome.storage.local.set({ approvals });
    }
  } else if (command === 'block-action') {
    const { pendingActions = [], approvals = {} } = await chrome.storage.local.get([
      'pendingActions',
      'approvals',
    ]);
    const first = pendingActions[0];
    if (first) {
      approvals[first.requestId] = 'block';
      await chrome.storage.local.set({ approvals });
    }
  } else if (command === 'open-sidepanel') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) chrome.sidePanel.open({ tabId: tab.id });
  }
});

// ─────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────

connect();
