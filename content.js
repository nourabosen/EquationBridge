/**
 * content.js — DOM query helper for Equation Bridge
 *
 * This content script runs on docs.google.com/document/* pages.
 * It does NOT dispatch any events or type anything.
 * Its ONLY job is to answer DOM queries from the popup:
 *   - Is this a Google Docs page?
 *   - Where is a given menu item on screen? (returns viewport coordinates)
 *
 * All actual input (keyboard, mouse) is handled by the popup via
 * chrome.debugger (Input.dispatchKeyEvent / Input.dispatchMouseEvent),
 * which produces real browser-level events that Google Docs accepts.
 */
(() => {
  'use strict';

  /** Check that we're on a Google Docs editing page. */
  function isGoogleDocs() {
    return !!(
      document.querySelector('.kix-appview-editor') ||
      document.querySelector('.docs-editor')
    );
  }

  /**
   * Get the centre-of-element viewport coordinates for a DOM element.
   * Returns { x, y } or null.
   */
  function centreOf(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }

  /**
   * Find a visible .goog-menuitem whose label includes `needle` (case-insensitive).
   * Returns the DOM element or null.
   */
  function findMenuItem(needle) {
    const items = document.querySelectorAll('.goog-menuitem');
    const lower = needle.toLowerCase();
    for (const item of items) {
      const label = item.querySelector('.goog-menuitem-content');
      if (!label) continue;
      if (label.textContent.trim().toLowerCase().includes(lower) && item.offsetParent !== null) {
        return item;
      }
    }
    return null;
  }

  /**
   * Find the editor writing area and return its centre coordinates.
   * Used so the popup can click into the document to ensure focus.
   */
  function getEditorPosition() {
    // Try the page content area (the actual writing surface)
    const page = document.querySelector('.kix-page-content-wrapper');
    if (page) return centreOf(page);
    // Fallback to the editor container
    const editor = document.querySelector('.kix-appview-editor');
    return centreOf(editor);
  }

  // -----------------------------------------------------------------------
  // Message handler
  // -----------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // --- Ping ---
    if (msg.action === 'ping') {
      sendResponse({ alive: true, isGoogleDocs: isGoogleDocs() });
      return;
    }

    // --- Get position of a named element ---
    if (msg.action === 'getPosition') {
      let pos = null;

      switch (msg.query) {
        case 'insertMenu': {
          const el = document.getElementById('docs-insert-menu');
          pos = centreOf(el);
          break;
        }
        case 'menuItem': {
          const el = findMenuItem(msg.label);
          pos = centreOf(el);
          break;
        }
        case 'editor': {
          pos = getEditorPosition();
          break;
        }
      }

      sendResponse(pos);
      return;
    }

    // --- Check if equation toolbar is visible ---
    if (msg.action === 'isEquationToolbarOpen') {
      // The equation toolbar appears when an equation is being edited.
      // It typically has the class 'docs-equation-toolbar' or similar.
      const toolbar = document.querySelector('.docs-equation-toolbar');
      // Also check for the "New equation" text in the toolbar
      const kixEq = document.querySelector('.kix-equation-toolbar');
      sendResponse({ open: !!(toolbar || kixEq) });
      return;
    }
    // --- Focus the editor without clicking (preserves selection) ---
    if (msg.action === 'focusEditor') {
      const idoc = document.querySelector('.docs-texteventtarget-iframe')?.contentDocument;
      if (idoc) {
        const target = idoc.querySelector('[contenteditable="true"]') || idoc.body;
        target.focus();
        sendResponse(true);
      } else {
        sendResponse(false);
      }
      return;
    }
  });

  console.log('[Equation Bridge] Content script loaded.');
})();
