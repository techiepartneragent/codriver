/**
 * CoDriver content.js — Content Script
 * Lightweight helper injected into all pages.
 * Responds to background script messages for content extraction,
 * click, and type operations.
 */

// ─────────────────────────────────────────────
// CAPTCHA Detection
// ─────────────────────────────────────────────

// Detect common CAPTCHA patterns on page
function detectCaptcha() {
  const signals = [
    document.querySelector('iframe[src*="recaptcha"]'),
    document.querySelector('iframe[src*="hcaptcha"]'),
    document.querySelector('.g-recaptcha'),
    document.querySelector('.h-captcha'),
    document.querySelector('[data-sitekey]'),
    document.querySelector('iframe[title*="captcha" i]'),
    document.querySelector('iframe[title*="challenge" i]'),
  ];
  return signals.some(Boolean);
}

let captchaReported = false;

function checkForCaptcha() {
  if (captchaReported) return; // already reported for this page
  if (detectCaptcha()) {
    captchaReported = true; // set flag immediately
    chrome.runtime.sendMessage({ type: 'CAPTCHA_DETECTED', url: location.href, title: document.title });
  }
}

// Run on load
checkForCaptcha();

// Debounced observer - wait 500ms after DOM settles before checking
let debounceTimer = null;
const captchaObserver = new MutationObserver(() => {
  if (captchaReported) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(checkForCaptcha, 500);
});
captchaObserver.observe(document.body, { childList: true, subtree: true });

// ─────────────────────────────────────────────
// Message listener
// ─────────────────────────────────────────────

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

      case 'GET_STRUCTURE': {
        const getText = (el) => el ? el.innerText.trim() : null;
        const getMeta = (name) => {
          const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
          return el ? el.getAttribute('content') : null;
        };
        sendResponse({
          success: true,
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
        });
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
