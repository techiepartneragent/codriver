# CoDriver

AI browser control via your real Chrome profile — powered by MCP + WebSocket.

## Setup

### 1. Install the Chrome Extension

Load the `extension/` folder as an unpacked extension in Chrome.

### 2. Configure the MCP Server

Copy `mcp-server/claude_desktop_config.json` content into your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`) and update the path.

### 3. Environment Variables

Set these in your MCP server env (or in `claude_desktop_config.json` under `"env"`):

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | Your Telegram user ID (get from [@userinfobot](https://t.me/userinfobot)) |

Both vars are optional — if not set, Telegram notifications are silently skipped.

## Telegram Approval Flow

When a CAPTCHA or pending action is detected, CoDriver sends a Telegram message with **inline buttons**:

```
🛑 CoDriver needs you!

Type: CAPTCHA Detected
Page: https://example.com/captcha
Solve the CAPTCHA in Chrome, then tap Approve.

[✅ Approve]  [❌ Block]
```

1. Extension detects CAPTCHA → sends `CAPTCHA_DETECTED` to MCP server via WebSocket
2. MCP server sends Telegram message with inline keyboard
3. Vinod taps **✅ Approve** on Telegram
4. MCP server receives callback, sends `CAPTCHA_RESOLVED` to extension
5. Extension clears pending state, AI resumes

No webhook needed — uses long-polling, works locally.

## Auth

The WebSocket connection uses a hardcoded dev token (`codriver-dev-token-2026`). Change `AUTH_TOKEN` in `server.js` before production use.
