// telegram.js — Telegram Bot integration for CoDriver approvals
// Uses long-polling (no webhook needed, works locally)

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

export async function sendApprovalRequest({ requestId, type, url, title, description }) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  const text = `🛑 *CoDriver needs you!*\n\n` +
    `*Type:* ${type}\n` +
    `*Page:* ${title || url}\n` +
    `${description || ''}\n\n` +
    `Reply *approve* to resume AI, or *block* to cancel.`;

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'Markdown'
    })
  });
}

export async function sendNotification(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' })
  });
}

// Long-poll for text message replies (approve / block)
export function startCallbackPoller(onApprove, onBlock) {
  if (!TELEGRAM_BOT_TOKEN) return;
  let offset = 0;

  async function poll() {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${offset}&timeout=30&allowed_updates=["message"]`
      );
      const data = await res.json();
      if (data.ok) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          const msg = update.message;
          if (!msg || !msg.text) continue;
          // Only accept from the configured chat
          if (String(msg.chat.id) !== String(TELEGRAM_CHAT_ID)) continue;

          const text = msg.text.trim().toLowerCase();
          if (text === 'approve') onApprove('pending');
          else if (text === 'block') onBlock('pending');
        }
      }
    } catch (e) { /* ignore */ }
    setTimeout(poll, 1000);
  }
  poll();
}
