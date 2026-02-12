/**
 * popup.js — Equation Bridge (v3)
 *
 * Orchestrates everything:
 *   1. Parse Markdown → segments (text + equations).
 *   2. Preview with KaTeX.
 *   3. Attach chrome.debugger to the Google Docs tab.
 *   4. Drive all input (mouse clicks + keyboard typing) through the
 *      Chrome DevTools Protocol (Input.dispatchKeyEvent / MouseEvent),
 *      which produces real browser-level events that Google Docs accepts.
 *   5. Detach debugger when done.
 */
document.addEventListener('DOMContentLoaded', () => {
  // =======================================================================
  // DOM references
  // =======================================================================
  const inputText = document.getElementById('input-text');
  const loadBtn = document.getElementById('load-btn');
  const parseBtn = document.getElementById('parse-btn');
  const stepInput = document.getElementById('step-input');
  const stepPreview = document.getElementById('step-preview');
  const stepRunning = document.getElementById('step-running');
  const segmentsList = document.getElementById('segments-list');
  const backBtn = document.getElementById('back-btn');
  const insertBtn = document.getElementById('insert-btn');
  const runStatus = document.getElementById('run-status');
  const runProgress = document.getElementById('run-progress');
  const runDoneBtn = document.getElementById('run-done-btn');
  const globalStatus = document.getElementById('global-status');

  let parsedSegments = [];
  let activeTabId = null;
  let dbgAttached = false;

  // =======================================================================
  // Section visibility
  // =======================================================================
  function showSection(section) {
    [stepInput, stepPreview, stepRunning].forEach(s => s.classList.add('hidden'));
    section.classList.remove('hidden');
  }

  function flash(msg, type = 'info', duration = 4000) {
    globalStatus.textContent = msg;
    globalStatus.className = 'global-status visible ' + type;
    clearTimeout(flash._t);
    flash._t = setTimeout(() => globalStatus.classList.remove('visible'), duration);
  }

  function setRunStatus(msg) {
    runStatus.textContent = msg;
  }

  // =======================================================================
  // Clipboard load
  // =======================================================================
  loadBtn.addEventListener('click', async () => {
    try {
      inputText.value = await navigator.clipboard.readText();
      flash('Loaded from clipboard.', 'success');
    } catch {
      flash('Clipboard access denied — paste manually.', 'error');
    }
  });

  // =======================================================================
  // Markdown → Segments parser
  // =======================================================================
  function parseMarkdown(text) {
    const segments = [];
    const regex = /\$\$([\s\S]*?)\$\$|\$([^\n$\\]*(?:\\.[^\n$\\]*)*)\$/g;
    let last = 0, m;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > last) segments.push({ type: 'text', content: text.substring(last, m.index) });
      if (m[1] !== undefined) segments.push({ type: 'equation', content: m[1].trim(), display: true });
      else if (m[2] !== undefined) segments.push({ type: 'equation', content: m[2].trim(), display: false });
      last = regex.lastIndex;
    }
    if (last < text.length) segments.push({ type: 'text', content: text.substring(last) });
    // merge adjacent text
    const merged = [];
    for (const s of segments) {
      if (s.type === 'text' && merged.length && merged[merged.length - 1].type === 'text')
        merged[merged.length - 1].content += s.content;
      else merged.push(s);
    }
    return merged;
  }

  // =======================================================================
  // Parse & Preview
  // =======================================================================
  parseBtn.addEventListener('click', () => {
    const raw = inputText.value.trim();
    if (!raw) { flash('Enter or paste some text first.', 'error'); return; }
    parsedSegments = parseMarkdown(raw);
    if (!parsedSegments.length) { flash('Nothing parsed.', 'error'); return; }
    renderPreview();
    showSection(stepPreview);
  });

  function renderPreview() {
    segmentsList.innerHTML = '';
    let eqN = 0, txN = 0;
    for (const seg of parsedSegments) {
      const div = document.createElement('div');
      div.className = 'seg-item ' + seg.type;
      const lbl = document.createElement('div');
      lbl.className = 'seg-label';
      if (seg.type === 'text') {
        txN++;
        lbl.textContent = `Text #${txN}`;
        div.appendChild(lbl);
        const c = document.createElement('div');
        c.textContent = seg.content.length > 200 ? seg.content.slice(0, 200) + '…' : seg.content;
        div.appendChild(c);
      } else {
        eqN++;
        lbl.textContent = `Equation #${eqN} (${seg.display ? 'display' : 'inline'})`;
        div.appendChild(lbl);
        const pv = document.createElement('div');
        pv.className = 'katex-preview';
        try { katex.render(seg.content, pv, { displayMode: seg.display, throwOnError: false }); }
        catch { pv.textContent = seg.content; }
        div.appendChild(pv);
        const raw = document.createElement('div');
        raw.className = 'seg-raw';
        raw.textContent = seg.content;
        div.appendChild(raw);
      }
      segmentsList.appendChild(div);
    }
  }

  backBtn.addEventListener('click', () => showSection(stepInput));

  // =======================================================================
  // chrome.debugger helpers (Promised wrappers)
  // =======================================================================
  function dbgAttach(tabId) {
    return new Promise((resolve, reject) => {
      chrome.debugger.attach({ tabId }, '1.3', () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else { dbgAttached = true; resolve(); }
      });
    });
  }
  function dbgDetach(tabId) {
    return new Promise(resolve => {
      if (!dbgAttached) { resolve(); return; }
      chrome.debugger.detach({ tabId }, () => { dbgAttached = false; resolve(); });
    });
  }
  function dbgSend(tabId, method, params = {}) {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, method, params, res => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(res);
      });
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // =======================================================================
  // Content-script messaging
  // =======================================================================
  function csMsg(msg) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(activeTabId, msg, resp => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(resp);
      });
    });
  }

  // =======================================================================
  // Debugger-level input primitives
  // =======================================================================
  //
  // KEY INSIGHT: We use CDP event type 'keyDown' (NOT 'rawKeyDown').
  //
  //   - 'rawKeyDown' dispatches ONLY the raw keydown DOM event.
  //     Chrome does NOT generate keypress, beforeinput, or input events.
  //     Google Docs IGNORES raw keydown because it listens for input events.
  //
  //   - 'keyDown' tells Chrome to process the key through its FULL input
  //     pipeline, generating keypress + beforeinput + input events.
  //     This is identical to a physical keyboard press.
  //
  // =======================================================================

  /** Virtual-key-code lookup (US keyboard layout). */
  function charToVK(ch) {
    const c = ch.toUpperCase().charCodeAt(0);
    if (c >= 65 && c <= 90) return c;
    if (c >= 48 && c <= 57) return c;
    const map = {
      ' ': 32, '`': 192, '~': 192, '-': 189, '_': 189, '=': 187, '+': 187,
      '[': 219, '{': 219, ']': 221, '}': 221, '\\': 220, '|': 220,
      ';': 186, ':': 186, "'": 222, '"': 222, ',': 188, '<': 188,
      '.': 190, '>': 190, '/': 191, '?': 191,
      '!': 49, '@': 50, '#': 51, '$': 52, '%': 53, '^': 54, '&': 55, '*': 56, '(': 57, ')': 48,
    };
    return map[ch] || 0;
  }
  function charToCode(ch) {
    const u = ch.toUpperCase();
    if (/^[A-Z]$/.test(u)) return 'Key' + u;
    if (/^[0-9]$/.test(ch)) return 'Digit' + ch;
    const map = {
      ' ': 'Space', '`': 'Backquote', '~': 'Backquote', '-': 'Minus', '_': 'Minus',
      '=': 'Equal', '+': 'Equal', '[': 'BracketLeft', '{': 'BracketLeft',
      ']': 'BracketRight', '}': 'BracketRight', '\\': 'Backslash', '|': 'Backslash',
      ';': 'Semicolon', ':': 'Semicolon', "'": "Quote", '"': 'Quote',
      ',': 'Comma', '<': 'Comma', '.': 'Period', '>': 'Period',
      '/': 'Slash', '?': 'Slash',
      '!': 'Digit1', '@': 'Digit2', '#': 'Digit3', '$': 'Digit4', '%': 'Digit5',
      '^': 'Digit6', '&': 'Digit7', '*': 'Digit8', '(': 'Digit9', ')': 'Digit0',
    };
    return map[ch] || '';
  }
  function needsShift(ch) {
    return /[A-Z~!@#$%^&*()_+{}|:"<>?]/.test(ch);
  }

  /**
   * Type a single printable character.
   * Uses 'keyDown' so Chrome runs its full input pipeline
   * (generates keypress + beforeinput + input DOM events).
   */
  async function typeChar(ch) {
    const vk = charToVK(ch);
    const code = charToCode(ch);
    const mod = needsShift(ch) ? 8 : 0;

    await dbgSend(activeTabId, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: ch,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers: mod,
      text: ch,
      unmodifiedText: ch,
    });
    await sleep(60);

    await dbgSend(activeTabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: ch,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers: mod,
    });
    await sleep(80);
  }

  /**
   * Press a non-printable / structural key (Space, Tab, Enter, Escape, arrows).
   * Longer delays because GDocs needs time for UI updates (e.g. converting
   * \sum to ∑ after Space, opening subscript box after _, etc.).
   */
  async function pressKey(key, code, vk, modifiers = 0, text = undefined) {
    await dbgSend(activeTabId, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers,
      text,
      unmodifiedText: text,
    });
    await sleep(80);

    await dbgSend(activeTabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers,
    });
    await sleep(350);
  }

  async function pressSpace() { await pressKey(' ', 'Space', 32, 0, ' '); }
  async function pressBackspace() { await pressKey('Backspace', 'Backspace', 8); }
  async function pressTab() { await pressKey('Tab', 'Tab', 9); }
  async function pressEnter() { await pressKey('Enter', 'Enter', 13, 0, '\r'); }
  async function pressEscape() { await pressKey('Escape', 'Escape', 27); }
  async function pressRight() { await pressKey('ArrowRight', 'ArrowRight', 39); }
  async function pressCtrlB() { await pressKey('b', 'KeyB', 66, 2); }
  async function pressCtrlI() { await pressKey('i', 'KeyI', 73, 2); }
  async function pressLeft() { await pressKey('ArrowLeft', 'ArrowLeft', 37); }
  async function pressDelete() { await pressKey('Delete', 'Delete', 46); }

  // --- Mouse ---
  async function debugClick(x, y) {
    await dbgSend(activeTabId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1,
    });
    await sleep(50);
    await dbgSend(activeTabId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
    });
    await sleep(100);
  }
  async function debugHover(x, y) {
    await dbgSend(activeTabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y,
    });
    await sleep(80);
  }

  // =======================================================================
  // Menu navigation: Insert → Symbols → Equations
  // =======================================================================

  async function getPos(query, label) {
    const pos = await csMsg({ action: 'getPosition', query, label });
    return pos; // { x, y } or null
  }

  /**
   * Open the equation editor via Insert → Symbols → Equations.
   * Falls back to Insert → Equation (older GDocs).
   */
  async function openEquationEditor() {
    // 1. Click Insert menu
    const insertPos = await getPos('insertMenu');
    if (!insertPos) throw new Error('Cannot find the Insert menu.');
    await debugClick(insertPos.x, insertPos.y);
    await sleep(900);

    // 2. Hover over "Symbols" to expand submenu
    let symbolsPos = await getPos('menuItem', 'Symbols');
    if (!symbolsPos) symbolsPos = await getPos('menuItem', 'Special characters');

    if (symbolsPos) {
      await debugHover(symbolsPos.x, symbolsPos.y);
      await sleep(700);

      // 3. Click "Equations" in the submenu
      let eqPos = await getPos('menuItem', 'Equations');
      if (!eqPos) eqPos = await getPos('menuItem', 'Equation');
      if (eqPos) {
        await debugClick(eqPos.x, eqPos.y);
        await sleep(700);
        return;
      }

      // Submenu didn't have it — try clicking Symbols directly
      await debugClick(symbolsPos.x, symbolsPos.y);
      await sleep(700);
      eqPos = await getPos('menuItem', 'Equations');
      if (!eqPos) eqPos = await getPos('menuItem', 'Equation');
      if (eqPos) {
        await debugClick(eqPos.x, eqPos.y);
        await sleep(700);
        return;
      }
    }

    // Fallback: direct "Equation" item (older GDocs)
    let directEq = await getPos('menuItem', 'Equation');
    if (directEq) {
      await debugClick(directEq.x, directEq.y);
      await sleep(700);
      return;
    }

    // Close whatever menu is open and report failure
    await pressEscape();
    throw new Error(
      'Could not find Insert → Symbols → Equations.\n' +
      'Make sure Google Docs is in Editing mode (not Suggesting/Viewing).'
    );
  }

  async function closeEquationEditor() {
    await pressRight();
    await pressRight();
    await sleep(200);
  }

  async function focusEditor() {
    // Focus the editor programmatically (preserves selection)
    await csMsg({ action: 'focusEditor' });
    await sleep(200);
  }

  // =======================================================================
  // LaTeX → action list translator
  // =======================================================================

  const TEMPLATE_CMDS = new Set(['\\frac']);
  const SINGLE_TMPL = new Set([
    '\\sqrt', '\\cbrt', '\\hat', '\\bar', '\\vec', '\\tilde', '\\dot', '\\ddot',
    '\\overline', '\\underline', '\\widehat', '\\widetilde', '\\overrightarrow',
  ]);

  // SIMPLE_CMDS set - only one definition
  const SIMPLE_CMDS = new Set([
    '\\alpha', '\\beta', '\\gamma', '\\delta', '\\epsilon', '\\varepsilon',
    '\\zeta', '\\eta', '\\theta', '\\vartheta', '\\iota', '\\kappa',
    '\\lambda', '\\mu', '\\nu', '\\xi', '\\pi', '\\varpi',
    '\\rho', '\\varrho', '\\sigma', '\\varsigma', '\\tau',
    '\\upsilon', '\\phi', '\\varphi', '\\chi', '\\psi', '\\omega',
    '\\Gamma', '\\Delta', '\\Theta', '\\Lambda', '\\Xi', '\\Pi',
    '\\Sigma', '\\Upsilon', '\\Phi', '\\Psi', '\\Omega',
    '\\sum', '\\prod', '\\coprod', '\\int', '\\iint', '\\iiint',
    '\\oint', '\\bigcup', '\\bigcap', '\\bigoplus', '\\bigotimes',
    '\\leq', '\\geq', '\\neq', '\\approx', '\\equiv', '\\sim',
    '\\simeq', '\\cong', '\\propto', '\\ll', '\\gg', '\\subset',
    '\\supset', '\\subseteq', '\\supseteq', '\\in', '\\notin',
    '\\ni', '\\mid', '\\parallel', '\\perp',
    '\\leftarrow', '\\rightarrow', '\\leftrightarrow',
    '\\Leftarrow', '\\Rightarrow', '\\Leftrightarrow',
    '\\uparrow', '\\downarrow', '\\mapsto',
    '\\infty', '\\partial', '\\nabla', '\\forall', '\\exists',
    '\\neg', '\\cdot', '\\cdots', '\\ldots', '\\vdots', '\\ddots',
    '\\times', '\\div', '\\pm', '\\mp', '\\circ', '\\bullet',
    '\\star', '\\dagger', '\\oplus', '\\otimes',
    '\\ell', '\\hbar', '\\Re', '\\Im', '\\wp', '\\aleph',
    '\\sin', '\\cos', '\\tan', '\\cot', '\\sec', '\\csc',
    '\\arcsin', '\\arccos', '\\arctan', '\\sinh', '\\cosh', '\\tanh',
    '\\log', '\\ln', '\\exp', '\\lim', '\\min', '\\max',
    '\\sup', '\\inf', '\\det', '\\dim', '\\ker', '\\gcd',
    '\\deg', '\\hom', '\\arg',
    '\\quad', '\\qquad',
  ]);

  // Operators that auto-enter a subscript/limit mode in GDocs
  const SUM_LIKE = new Set([
    '\\sum', '\\prod', '\\coprod', '\\int', '\\iint', '\\iiint',
    '\\oint', '\\bigcup', '\\bigcap', '\\bigoplus', '\\bigotimes', '\\lim'
  ]);

  // latexToActions function - only one definition
  function latexToActions(latex) {
    const A = [];
    let i = 0;
    const pushT = ch => A.push({ a: 'type', v: ch });
    const pushSp = () => A.push({ a: 'space' });
    const pushTb = () => A.push({ a: 'tab' });
    const pushRt = () => A.push({ a: 'right' });

    function braceGroup(p) {
      if (p >= latex.length || latex[p] !== '{') return null;
      let d = 0, s = p + 1, j = p;
      while (j < latex.length) {
        if (latex[j] === '{') d++;
        else if (latex[j] === '}') {
          d--;
          if (!d) break;
        }
        j++;
      }
      return { content: latex.substring(s, j), end: j + 1 };
    }

    function readArg(p) {
      if (p >= latex.length) return { content: '', end: p };
      if (latex[p] === '{') return braceGroup(p);
      if (latex[p] === '\\') {
        let j = p + 1;
        while (j < latex.length && /[a-zA-Z]/.test(latex[j])) j++;
        return { content: latex.substring(p, j), end: j };
      }
      return { content: latex[p], end: p + 1 };
    }

    while (i < latex.length) {
      // Skip whitespace - equations don't need spaces
      if (latex[i] === ' ' || latex[i] === '\t') {
        i++;
        continue;
      }

      if (latex[i] === '\\') {
        let j = i + 1;
        // Handle single-character escaped symbols
        if (j < latex.length && !/[a-zA-Z]/.test(latex[j])) {
          const sc = latex.substring(i, j + 1);
          if (sc === '\\\\') A.push({ a: 'enter' });
          else if (sc === '\\{') pushT('(');
          else if (sc === '\\}') pushT(')');
          else pushT(latex[j]);
          i = j + 1;
          continue;
        }

        // Read the full command
        while (j < latex.length && /[a-zA-Z]/.test(latex[j])) j++;
        const cmd = latex.substring(i, j);
        i = j;

        // Skip unsupported commands
        if (['\\left', '\\right', '\\displaystyle', '\\textstyle'].includes(cmd)) {
          continue;
        }

        // Text commands
        if (['\\text', '\\mathrm', '\\textrm', '\\textit', '\\textbf',
          '\\mathbf', '\\mathit', '\\mathcal', '\\mathbb'].includes(cmd)) {
          const g = braceGroup(i);
          if (g) {
            pushT('"');
            for (const c of g.content) pushT(c);
            pushT('"');
            i = g.end;
          }
          continue;
        }

        // \frac{a}{b}
        if (cmd === '\\frac') {
          // Type the command and press space to convert
          for (const c of cmd) pushT(c);
          pushSp();

          const a1 = braceGroup(i);
          if (a1) {
            A.push(...latexToActions(a1.content));
            i = a1.end;
          }

          pushTb(); // Tab to denominator

          const a2 = braceGroup(i);
          if (a2) {
            A.push(...latexToActions(a2.content));
            i = a2.end;
          }

          pushRt(); // Right arrow to exit fraction
          continue;
        }

        // \sqrt{x}
        if (SINGLE_TMPL.has(cmd)) {
          for (const c of cmd) pushT(c);
          pushSp(); // Space to convert command

          const g = braceGroup(i);
          if (g) {
            A.push(...latexToActions(g.content));
            i = g.end;
          }

          pushRt(); // Right arrow to exit
          continue;
        }

        // Simple symbols: \alpha, \sum, etc.
        if (SIMPLE_CMDS.has(cmd)) {
          // Type the command
          for (const c of cmd) pushT(c);
          pushSp(); // Space to convert

          if (SUM_LIKE.has(cmd)) {
            // Special handling for operators like \sum:
            // GDocs behavior: \sum enters the lower limit (subscript) automatically.
            // We use Right Arrow to navigate to upper limit and then out.

            // 1. Handle Subscript (Lower Limit)
            // Check if next significant char is '_' or if it's implicit (e.g. \sum{...})
            let hasSub = false;
            let k = i;
            while (k < latex.length && (latex[k] === ' ' || latex[k] === '\t')) k++;

            if (k < latex.length && latex[k] === '_') {
              hasSub = true;
              i = k + 1; // Consume '_'
              // Check for brace group
              if (i < latex.length && latex[i] === '{') {
                const g = braceGroup(i);
                if (g) {
                  A.push(...latexToActions(g.content));
                  i = g.end;
                }
              } else {
                // Single char arg
                const a = readArg(i);
                A.push(...latexToActions(a.content));
                i = a.end;
              }
              pushRt(); // Move to superscript
            } else if (k < latex.length && latex[k] === '{' && cmd !== '\\lim') {
              // Implicit subscript case \sum{...} (except \lim generally behaves differently or same?)
              // Actually \sum{...} is non-standard LaTeX but common user input for \sum_{...}
              // Let's support it if GDocs supports it
              hasSub = true;
              i = k; // Point to '{'
              const g = braceGroup(i);
              if (g) {
                A.push(...latexToActions(g.content));
                i = g.end;
              }
              pushRt();
            } else {
              // No subscript provided. 
              // If GDocs automatically enters sub, we must Right Arrow to skip it.
              pushRt();
            }

            // 2. Handle Superscript (Upper Limit)
            let hasSup = false;
            k = i;
            while (k < latex.length && (latex[k] === ' ' || latex[k] === '\t')) k++;

            if (k < latex.length && latex[k] === '^') {
              hasSup = true;
              i = k + 1; // Consume '^'
              if (i < latex.length && latex[i] === '{') {
                const g = braceGroup(i);
                if (g) {
                  A.push(...latexToActions(g.content));
                  i = g.end;
                }
              } else {
                const a = readArg(i);
                A.push(...latexToActions(a.content));
                i = a.end;
              }
              pushRt(); // Exit operator
            } else {
              // No superscript provided.
              // If GDocs automatically entered slots, might need Right Arrow to exit?
              // Or to skip empty super?
              pushRt();
            }
            continue; // Done with this command
          }

          // Fallback for standard symbols (\alpha, \beta etc.)
          // They just continue to the next loop iteration where '_' and '^' are handled normally.
          continue;
        }

        // Unknown command - type it and press space to try conversion
        for (const c of cmd) pushT(c);
        pushSp();

        // Handle arguments if any
        if (i < latex.length && latex[i] === '{') {
          const g = braceGroup(i);
          if (g) {
            A.push(...latexToActions(g.content));
            i = g.end;
            pushRt();
          }
        }
        continue;
      }

      // Subscript
      if (latex[i] === '_') {
        i++;
        pushT('_');

        // Check if the next character is {
        if (i < latex.length && latex[i] === '{') {
          const g = braceGroup(i);
          if (g) {
            A.push(...latexToActions(g.content));
            i = g.end;
          }
        } else {
          // Single character subscript
          const a = readArg(i);
          A.push(...latexToActions(a.content));
          i = a.end;
        }

        pushRt(); // Right arrow to exit subscript
        continue;
      }

      // Superscript
      if (latex[i] === '^') {
        i++;
        pushT('^');

        // Check if the next character is {
        if (i < latex.length && latex[i] === '{') {
          const g = braceGroup(i);
          if (g) {
            A.push(...latexToActions(g.content));
            i = g.end;
          }
        } else {
          // Single character superscript
          const a = readArg(i);
          A.push(...latexToActions(a.content));
          i = a.end;
        }

        pushRt(); // Right arrow to exit superscript
        continue;
      }

      // Skip braces
      if (latex[i] === '{' || latex[i] === '}') {
        i++;
        continue;
      }

      // Regular character
      pushT(latex[i]);
      i++;
    }

    return A;
  }

  // =======================================================================
  // Execute an action list via the debugger
  // =======================================================================
  async function execActions(actions) {
    for (const a of actions) {
      switch (a.a) {
        case 'type': await typeChar(a.v); break;
        case 'space': await pressSpace(); break;
        case 'tab': await pressTab(); break;
        case 'right': await pressRight(); break;
        case 'enter': await pressEnter(); break;
        case 'backspace': await pressBackspace(); break;
        case 'left': await pressLeft(); break;
        case 'delete': await pressDelete(); break;
      }
    }
  }

  // =======================================================================
  // Plain-text insertion (with basic Markdown bold/italic)
  // =======================================================================

  /** Parse a single line into runs with bold/italic flags. */
  function mdRuns(line) {
    line = line.replace(/^#{1,6}\s+/, '');
    const runs = [], re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
    let last = 0, m;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) runs.push({ t: line.substring(last, m.index), b: false, i: false });
      if (m[2] !== undefined) runs.push({ t: m[2], b: true, i: true });
      else if (m[3] !== undefined) runs.push({ t: m[3], b: true, i: false });
      else if (m[4] !== undefined) runs.push({ t: m[4], b: false, i: true });
      else if (m[5] !== undefined) runs.push({ t: m[5], b: false, i: false });
      last = m.index + m[0].length;
    }
    if (last < line.length) runs.push({ t: line.substring(last), b: false, i: false });
    return runs;
  }

  async function insertText(text) {
    const lines = text.split('\n');
    for (let li = 0; li < lines.length; li++) {
      const runs = mdRuns(lines[li]);
      for (const r of runs) {
        if (!r.t) continue;
        if (r.b) await pressCtrlB();
        if (r.i) await pressCtrlI();
        for (const ch of r.t) await typeChar(ch);
        if (r.i) await pressCtrlI();
        if (r.b) await pressCtrlB();
      }
      if (li < lines.length - 1) await pressEnter();
    }
  }

  // =======================================================================
  // Main insertion flow
  // =======================================================================
  insertBtn.addEventListener('click', async () => {
    // Resolve the active Google Docs tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.includes('docs.google.com/document')) {
      flash('Active tab is not a Google Docs document.', 'error');
      return;
    }
    activeTabId = tab.id;

    // Check content script
    try {
      const pong = await csMsg({ action: 'ping' });
      if (!pong?.alive) throw new Error('Content script not loaded.');
      if (!pong.isGoogleDocs) throw new Error('Page is not Google Docs.');
    } catch (err) {
      flash(err.message + '\nReload the Google Docs page and try again.', 'error', 6000);
      return;
    }

    // Switch to the running UI
    showSection(stepRunning);
    runDoneBtn.classList.add('hidden');
    runProgress.value = 0;
    setRunStatus('Attaching debugger…');

    try {
      // Attach debugger
      await dbgAttach(activeTabId);
      setRunStatus('Debugger attached. Focusing editor…');
      await focusEditor();

      const total = parsedSegments.length;

      for (let i = 0; i < total; i++) {
        const seg = parsedSegments[i];
        runProgress.value = Math.round(((i) / total) * 100);

        if (seg.type === 'text') {
          setRunStatus(`Segment ${i + 1}/${total}: inserting text…`);
          await insertText(seg.content);
        } else {
          setRunStatus(`Segment ${i + 1}/${total}: opening equation editor…`);
          await openEquationEditor();

          setRunStatus(`Segment ${i + 1}/${total}: typing equation…`);
          const actions = latexToActions(seg.content);
          await execActions(actions);

          setRunStatus(`Segment ${i + 1}/${total}: closing equation editor…`);
          await closeEquationEditor();
          await sleep(250);
        }
      }

      runProgress.value = 100;
      setRunStatus('Done — all segments inserted!');
    } catch (err) {
      setRunStatus('Error: ' + err.message);
      console.error(err);
    } finally {
      // Always detach
      try { await dbgDetach(activeTabId); } catch { /* ignore */ }
      runDoneBtn.classList.remove('hidden');
    }
  });

  runDoneBtn.addEventListener('click', () => showSection(stepInput));

  // =======================================================================
  showSection(stepInput);
});