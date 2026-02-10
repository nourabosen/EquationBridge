# Equation Bridge – Markdown/LaTeX → Google Docs Editable Equations

Building a Chrome Extension (Manifest V3) that reads Markdown with LaTeX equations and inserts them as **native, editable equations** into Google Docs using the built-in equation editor (Insert > Symbols > Equation).

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
