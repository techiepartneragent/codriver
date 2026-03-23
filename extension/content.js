/**
 * CoDriver content.js — Content Script
 * Lightweight helper injected into all pages.
 * Responds to background script messages for content extraction,
 * click, and type operations.
 */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  try {
    switch (msg.type) {
      case 'GET_CONTENT': {
        sendResponse({
          success: true,
          title: document.title,
          url: location.href,
          text: document.body ? document.body.innerText.slice(0, 15000) : '',
          html: document.documentElement.outerHTML.slice(0, 50000),
        });
        break;
      }

      case 'CLICK': {
        const el = document.querySelector(msg.selector);
        if (!el) {
          sendResponse({ success: false, error: `Element not found: ${msg.selector}` });
          break;
        }
        el.click();
        sendResponse({ success: true });
        break;
      }

      case 'TYPE': {
        const el = document.querySelector(msg.selector);
        if (!el) {
          sendResponse({ success: false, error: `Element not found: ${msg.selector}` });
          break;
        }
        el.focus();
        el.value = msg.text || '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        sendResponse({ success: true });
        break;
      }

      default:
        sendResponse({ success: false, error: `Unknown message type: ${msg.type}` });
    }
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }

  // Return true to keep the channel open for async sendResponse
  return true;
});
