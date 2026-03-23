import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
// ─── CAPTCHA State ───────────────────────────────────────────────────────────
let captchaDetected = false;
let captchaUrl = null;



const WS_PORT = 39571;
let extensionSocket = null;
const pendingRequests = new Map(); // requestId → { resolve, reject, timer }

const wss = new WebSocketServer({ host: '127.0.0.1', port: WS_PORT });

wss.on('listening', () => {
  process.stderr.write(`[CoDriver] WebSocket server listening on ws://127.0.0.1:${WS_PORT}\n`);
});

// Bug 4: Auth token — hardcoded for POC
const AUTH_TOKEN = 'codriver-dev-token-2026';
process.stderr.write(`[CoDriver] Auth token: ${AUTH_TOKEN}\n`);

wss.on('connection', (ws) => {
  process.stderr.write('[CoDriver] Chrome extension connected — awaiting auth\n');
  let authenticated = false;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // Handle auth handshake (first message must be AUTH)
      if (!authenticated) {
        if (msg.type === 'AUTH' && msg.token === AUTH_TOKEN) {
          if (extensionSocket && extensionSocket.readyState === WebSocket.OPEN) {
            // Already have an extension connected — reject this one
            ws.send(JSON.stringify({ type: 'AUTH_FAIL', reason: 'Extension already connected' }));
            ws.close();
          } else {
            authenticated = true;
            extensionSocket = ws;
            ws.send(JSON.stringify({ type: 'AUTH_OK' }));
            process.stderr.write('[CoDriver] Extension authenticated\n');
          }
        } else {
          ws.send(JSON.stringify({ type: 'AUTH_FAIL', reason: 'Invalid token' }));
          process.stderr.write('[CoDriver] Extension auth failed — closing\n');
          ws.close();
        }
        return;
      }

      const pending = pendingRequests.get(msg.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRequests.delete(msg.requestId);
        if (msg.success) {
          pending.resolve(msg.data ?? {});
        } else {
          pending.reject(new Error(msg.error || 'Extension returned failure'));
        }
      } else {
        // Handle unsolicited messages from extension
        switch (msg.type) {
          case 'PING':
            ws.send(JSON.stringify({ type: 'PONG', requestId: msg.requestId }));
            break;
          case 'CAPTCHA_DETECTED':
            captchaDetected = true;
            captchaUrl = msg.url;
            process.stderr.write(`[CoDriver] CAPTCHA detected at: ${msg.url}\n`);
            break;
          case 'CAPTCHA_RESOLVED':
            captchaDetected = false;
            captchaUrl = null;
            process.stderr.write('[CoDriver] CAPTCHA resolved — resuming AI\n');
            break;
          default:
            break;
        }
      }
    } catch (e) {
      process.stderr.write(`[CoDriver] WS parse error: ${e.message}\n`);
    }
  });

  ws.on('close', () => {
    process.stderr.write('[CoDriver] Chrome extension disconnected\n');
    extensionSocket = null;
    // Reject all pending requests
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Extension disconnected'));
      pendingRequests.delete(id);
    }
  });

  ws.on('error', (err) => {
    process.stderr.write(`[CoDriver] WS error: ${err.message}\n`);
  });
});

/**
 * Send a command to the Chrome extension and wait for response.
 * @param {string} type - Command type (e.g. "NAVIGATE")
 * @param {object} params - Command parameters
 * @param {number} timeoutMs - Timeout in milliseconds (default 30s)
 */
function sendToExtension(type, params = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    // Check for CAPTCHA block first
    if (captchaDetected) {
      return reject(new Error(
        `CAPTCHA detected at ${captchaUrl}. Human approval needed. Check the CoDriver side panel.`
      ));
    }

    if (!extensionSocket || extensionSocket.readyState !== 1) {
      return reject(new Error(
        'CoDriver Chrome extension is not connected. ' +
        'Please install the extension and make sure it\'s active.'
      ));
    }

    const requestId = uuidv4();
    const message = { type, requestId, ...params };

    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Request timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve, reject, timer });
    extensionSocket.send(JSON.stringify(message));
  });
}

// ─── Tool Imports ────────────────────────────────────────────────────────────

import { navigateTool } from './tools/navigate.js';
import { getContentTool } from './tools/get_content.js';
import { getStructureTool } from './tools/get_structure.js';
import { clickTool } from './tools/click.js';
import { typeTextTool } from './tools/type_text.js';
import { screenshotTool } from './tools/screenshot.js';
import { searchTool } from './tools/search.js';
import { getUrlTool } from './tools/get_url.js';
import { listTabsTool } from './tools/list_tabs.js';
import { switchToTabTool } from './tools/switch_to_tab.js';
import { openNewTabTool } from './tools/open_new_tab.js';

const TOOLS = [
  navigateTool,
  getContentTool,
  getStructureTool,
  clickTool,
  typeTextTool,
  screenshotTool,
  searchTool,
  getUrlTool,
  listTabsTool,
  switchToTabTool,
  openNewTabTool,
];

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'codriver', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = TOOLS.find((t) => t.name === name);

  if (!tool) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    const result = await tool.execute(args ?? {}, sendToExtension);
    return { content: [{ type: 'text', text: result }] };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write('[CoDriver] MCP server started on stdio\n');
