# CoDriver MCP Server

> Let Claude/AI use your **real Chrome browser** — with full visibility and control.

CoDriver is a local [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that bridges Claude Desktop (or any MCP client) to your Chrome browser via a companion extension. Unlike Playwright or Puppeteer, CoDriver uses your **actual Chrome profile** — you're already logged in everywhere.

---

## How It Works

```
Claude Desktop / OpenClaw
        │ stdio (JSON-RPC)
        ▼
CoDriver MCP Server (Node.js)  ←── this folder
        │ WebSocket (ws://127.0.0.1:39571)
        ▼
Chrome Extension (background.js)
        │ chrome.tabs / chrome.scripting / chrome.debugger
        ▼
Your active Chrome tab
```

---

## Available Tools

| Tool | Description |
|------|-------------|
| `navigate_to` | Navigate to any URL |
| `get_page_content` | Get page title + visible text |
| `get_current_url` | Get current tab URL and title |
| `click_element` | Click an element by CSS selector |
| `type_text` | Type text into an input field |
| `take_screenshot` | Capture a screenshot (base64 PNG) |
| `search_web` | Search Google using your real browser |

---

## Installation

### 1. Clone & install dependencies

```bash
git clone https://github.com/techiepartneragent/codriver.git
cd codriver/mcp-server
npm install
```

### 2. Install the Chrome extension

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `codriver/extension/` folder
5. You should see the CoDriver extension icon appear

### 3. Configure Claude Desktop

Edit your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the CoDriver server:

```json
{
  "mcpServers": {
    "codriver": {
      "command": "node",
      "args": ["/absolute/path/to/codriver/mcp-server/server.js"]
    }
  }
}
```

> ⚠️ Use the **absolute path** to `server.js` — relative paths won't work.

### 4. Restart Claude Desktop

The CoDriver tools will appear in Claude's tool list automatically.

---

## Usage Examples

Once set up, you can ask Claude:

- *"Navigate to amazon.com and search for wireless headphones"*
- *"Take a screenshot of the current page"*
- *"Click the Add to Cart button"*
- *"What's on this page?"*
- *"Search for the latest MCP news"*

---

## WebSocket Protocol

The MCP server communicates with the Chrome extension over a local WebSocket at `ws://127.0.0.1:39571`.

### Commands (Server → Extension)

```json
{ "type": "NAVIGATE", "requestId": "uuid", "url": "https://example.com" }
{ "type": "GET_CONTENT", "requestId": "uuid" }
{ "type": "GET_URL", "requestId": "uuid" }
{ "type": "CLICK", "requestId": "uuid", "selector": "#btn" }
{ "type": "TYPE_TEXT", "requestId": "uuid", "selector": "#input", "text": "hello" }
{ "type": "SCREENSHOT", "requestId": "uuid" }
```

### Responses (Extension → Server)

```json
{ "requestId": "uuid", "success": true, "data": { ... } }
{ "requestId": "uuid", "success": false, "error": "Element not found" }
```

---

## Security

- WebSocket binds to `127.0.0.1` only — not accessible externally
- Only one extension connection at a time
- 30-second timeout on all requests

---

## Project Status

🚧 **POC / Alpha** — working code, not production-hardened.

Planned features:
- [ ] Human approve/block side panel UI
- [ ] Session recorder & replay
- [ ] Multi-tab support
- [ ] "Ask AI to do this" context menu

---

## License

MIT
