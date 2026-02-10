/**
 * background.js — Equation Bridge service worker
 *
 * Minimal: just handles context menu creation.
 * All heavy lifting is in popup.js (debugger) and content.js (DOM queries).
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'open-equation-bridge',
    title: 'Insert equations with Equation Bridge',
    contexts: ['selection'],
    documentUrlPatterns: ['*://docs.google.com/document/*'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'open-equation-bridge') {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const t = document.createElement('div');
          t.textContent = 'Click the Equation Bridge icon in the toolbar to insert equations.';
          t.style.cssText = `
            position:fixed;top:20px;right:20px;z-index:999999;
            background:#1a73e8;color:#fff;padding:12px 20px;
            border-radius:8px;font:14px sans-serif;
            box-shadow:0 4px 12px rgba(0,0,0,.15);transition:opacity .3s;
          `;
          document.body.appendChild(t);
          setTimeout(() => { t.style.opacity = '0'; }, 3000);
          setTimeout(() => t.remove(), 3500);
        },
      });
    } catch (e) {
      console.error('[Equation Bridge]', e);
    }
  }
});
