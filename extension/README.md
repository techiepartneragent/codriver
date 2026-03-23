# 🚗 CoDriver — Browser Co-Pilot

> **AI + Human shared browser control.** Let Claude/AI use your real Chrome browser — with an approve/block button for every action.

CoDriver is the missing piece in AI browser automation: a **human-in-the-loop Chrome extension** that lets AI assistants control your browser while keeping you fully in control. Every write action (navigate, click, type) requires your approval before it executes.

---

## Why CoDriver?

| Feature | BrowserMCP | Playwright MCP | **CoDriver** |
|---------|-----------|---------------|--------------|
| Real Chrome profile (logged in) | ✅ | ❌ | ✅ |
| Human approve/block UI | ❌ | ❌ | **✅** |
| Live action log | ❌ | ❌ | **✅** |
| Co-pilot mode | ❌ | ❌ | **✅** |

The [MCP specification itself](https://modelcontextprotocol.io/specification/2025-06-18/) says:
> *"There **SHOULD** always be a human in the loop with the ability to deny tool invocations."*

CoDriver is the only browser MCP tool that actually implements this.

---

## Architecture

```
Claude Desktop / OpenClaw (MCP Client)
        │  stdio JSON-RPC
CoDriver MCP Server (Node.js)
        │  WebSocket ws://127.0.0.1:39571
Chrome Extension (MV3 Service Worker)
        │  chrome.tabs / chrome.scripting / chrome.debugger
Active Chrome Tab + Side Panel (approve/block UI)
```

---

## Extension Structure

```
extension/
├── manifest.json       MV3 manifest
├── background.js       Service worker — WebSocket client, command dispatcher
├── sidepanel.html      Dark-themed approve/block UI
├── sidepanel.js        Side panel logic, polling, decisions
├── content.js          Lightweight content script (page ops)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Install (Developer Mode)

### 1. Install the Chrome Extension

1. Clone this repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select the `extension/` folder
6. Click the CoDriver icon in the toolbar to open the side panel

### 2. Start the MCP Server

```bash
npm install
node server/index.js
```

The server starts a WebSocket listener on `ws://127.0.0.1:39571` and the extension will auto-connect.

### 3. Configure Claude Desktop

Add to `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "codriver": {
      "command": "node",
      "args": ["/path/to/codriver/server/index.js"]
    }
  }
}
```

Restart Claude Desktop. You'll see CoDriver tools available in Claude.

---

## Supported Actions

| Action | Approval Required | Description |
|--------|-------------------|-------------|
| `NAVIGATE` | ✅ Yes | Navigate to a URL |
| `CLICK` | ✅ Yes | Click an element by CSS selector |
| `TYPE` | ✅ Yes | Type text into an input field |
| `SEARCH` | ✅ Yes | Google search query |
| `GET_CONTENT` | ❌ No (read-only) | Get page title + text |
| `GET_URL` | ❌ No (read-only) | Get current tab URL |
| `SCREENSHOT` | ❌ No | Capture screenshot |

---

## Side Panel UI

- **🟢 Connected** / **🔴 Disconnected** — live WebSocket status
- **Mode toggle:** Human 🧑 / Co-Pilot 🤝 / AI 🤖
- **Pending Actions** — shows queued AI actions with Approve ✅ / Block ❌ buttons
- **Action Log** — scrollable history of all actions (approved, blocked, executed)

Write actions **auto-block after 30 seconds** if not responded to.

---

## Development

```bash
# Clone
git clone https://github.com/techiepartneragent/codriver.git
cd codriver

# Install (server dependencies, when server/ is added)
npm install

# Load extension in Chrome Developer Mode
# extension/ folder → chrome://extensions → Load unpacked
```

---

## Roadmap

- [x] Chrome MV3 extension with approve/block UI
- [x] WebSocket bridge to MCP server
- [x] Dark-themed side panel with live action log
- [ ] MCP server (Node.js + @modelcontextprotocol/sdk)
- [ ] Session recorder + replay
- [ ] "Ask AI to do this" right-click context menu
- [ ] Multi-tab support
- [ ] Chrome Web Store listing

---

## License

MIT — built by [TechiPartner](https://techiepartner.com/)
