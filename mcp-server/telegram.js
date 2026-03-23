// telegram.js — Telegram Bot integration for CoDriver approvals
// Uses long-polling (no webhook needed, works locally)

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

export async function sendApprovalRequest({ requestId, type, url, title, description }) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  const text =
    `🛑 *CoDriver needs you!*\n\n` +
    `*Type:* ${type}\n` +
    `*Page:* ${title || url}\n` +
    `${description || ''}\n\n` +
    `Solve it in Chrome, then tap Approve.`;

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Approve', callback_data: `approve:${requestId}` },
          { text: '❌ Block', callback_data: `block:${requestId}` }
        ]]
      }
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

// Long-poll for callback_query (button taps)
export function startCallbackPoller(onApprove, onBlock) {
  if (!TELEGRAM_BOT_TOKEN) return;
  let offset = 0;

  async function poll() {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${offset}&timeout=30&allowed_updates=["callback_query"]`
      );
      const data = await res.json();
      if (data.ok) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          const cb = update.callback_query;
          if (!cb) continue;

          // Answer the callback to remove loading spinner
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              callback_query_id: cb.id,
              text: cb.data.startsWith('approve') ? '✅ Approved!' : '❌ Blocked'
            })
          });

          const [action, requestId] = cb.data.split(':');
          if (action === 'approve') onApprove(requestId);
          if (action === 'block') onBlock(requestId);
        }
      }
    } catch (e) { /* ignore network errors */ }
    setTimeout(poll, 1000);
  }
  poll();
}
