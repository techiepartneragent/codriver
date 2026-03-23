import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

// ─── WebSocket Bridge ────────────────────────────────────────────────────────

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
          authenticated = true;
          ws.send(JSON.stringify({ type: 'AUTH_OK' }));
          process.stderr.write('[CoDriver] Extension authenticated\n');
          // Set as active socket only after auth
          extensionSocket = ws;
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
import { clickTool } from './tools/click.js';
import { typeTextTool } from './tools/type_text.js';
import { screenshotTool } from './tools/screenshot.js';
import { searchTool } from './tools/search.js';
import { getUrlTool } from './tools/get_url.js';

const TOOLS = [
  navigateTool,
  getContentTool,
  clickTool,
  typeTextTool,
  screenshotTool,
  searchTool,
  getUrlTool,
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
