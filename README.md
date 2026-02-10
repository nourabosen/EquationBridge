# Equation Bridge – Markdown/LaTeX → Google Docs Editable Equations

A Chrome Extension (Manifest V3) that reads Markdown with LaTeX equations and inserts them as **native, editable equations** into Google Docs using the built-in equation editor (Insert > Equation).

## How It Works

Unlike image-based approaches, this extension **automates Google Docs' own equation editor**:

1. It parses your Markdown to separate text from LaTeX equations.
2. For plain text → it types it directly into the document.
3. For equations → it opens **Insert > Symbols > Equations**, converts your LaTeX into the keystrokes the equation editor understands, and types them character by character.

The result is a native Google Docs equation object you can click and edit later.

## Installation

1. Clone or download this folder.
2. Open Chrome → `chrome://extensions/`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** → select this folder.
5. The extension icon appears in the toolbar.

## Usage

1. Open a **Google Docs** document in Chrome.
2. Place your cursor where you want the content inserted.
3. Click the **Equation Bridge** extension icon.
4. Paste your Markdown/LaTeX source text (or click **Load from Clipboard**).
5. Click **Parse & Preview** to see the detected text and equation segments.
6. Choose an insertion mode:
   - **Auto-Insert**: Processes all segments automatically (fast, experimental).
   - **Step-by-Step**: Walks through each segment one at a time (more reliable).
7. Click **Insert into Google Docs**.

## Supported LaTeX

The extension translates standard LaTeX into Google Docs equation editor input:

| LaTeX                       | What happens                                    |
| --------------------------- | ----------------------------------------------- |
| `\alpha`, `\beta`, `\gamma` | Types command + Space → converts to Greek letter |
| `\frac{a}{b}`               | Opens fraction template, fills numerator/denominator |
| `\sqrt{x}`                  | Opens square root template, fills content        |
| `x^{2}`, `x_{i}`           | Superscript / subscript                          |
| `\sum`, `\int`, `\prod`     | Big operators                                    |
| `\text{Hello}`              | Inserts plain text within the equation           |
| `\leq`, `\geq`, `\neq` …   | Relational operators                             |
| `\sin`, `\cos`, `\log` …    | Function names                                   |

## Project Structure

```
equ-to-doc/
├── manifest.json      # MV3 manifest with content script for docs.google.com
├── popup.html         # Extension popup UI
├── popup.css          # Popup styles
├── popup.js           # Markdown parser, preview, communication with content script
├── content.js         # Injected into Google Docs – automates the equation editor
├── background.js      # Service worker for context menu & message relay
├── icons/             # Extension icons
└── libs/
    ├── katex/         # KaTeX (for equation preview in the popup)
    └── html2canvas.min.js  # (legacy, kept for potential future use)
```

## Important Notes

- **Google Docs must be the active tab** when you click "Insert into Google Docs".
- **Reload the Google Docs page** after installing/updating the extension so the content script loads.
- The auto-insert mode uses `execCommand('insertText')` and synthetic keyboard events. This works on most Google Docs setups but results may vary. Use Step-by-Step mode if auto has issues.
- The extension only works on `docs.google.com/document/*` pages.

## Troubleshooting

| Problem | Solution |
| ------- | -------- |
| "Content script not responding" | Reload the Google Docs page, then reopen the popup. |
| Equations not rendering correctly | Try Step-by-Step mode. Some complex LaTeX may need manual adjustment. |
| Menu not found | Make sure the Google Docs UI is fully loaded and in Editing mode (not Suggesting or Viewing). The extension navigates Insert > Symbols > Equations. |
