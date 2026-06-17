# 🌉 Equation Bridge

**Seamlessly bridge the gap between LaTeX/Markdown and Google Docs.**

Equation Bridge is a Chrome Extension (Manifest V3) designed for researchers, students, and engineers who write equations in LaTeX but need them to be **native and editable** within Google Docs. Instead of inserting static images or screenshots, this extension automates the Google Docs built-in equation editor to insert actual editable symbols.

## ✨ Features

- **LaTeX to Native Docs**: Converts LaTeX mathematical notation into native Google Docs equations.
- **Live Preview**: Integrated KaTeX rendering allows you to preview your equations in the extension popup before inserting them.
- **Direct Insertion**: Bypasses the tedious manual process of `Insert > Equation` by automating the input flow.
- **Markdown Support**: Handles Markdown-style LaTeX wrappers for easy copy-pasting from notes.

## 🛠️ Architecture

The extension utilizes a decoupled architecture to handle the bridge between the browser UI and the complex DOM of Google Docs:

- **`popup.js`**: Manages the user interface and parses input LaTeX.
- **`content.js`**: The "worker" script injected into Google Docs that interacts with the document's internal editor.
- **`background.js`**: A service worker that manages the extension lifecycle and coordinates messaging between the popup and the content script.
- **`KaTeX`**: Used for high-performance, beautiful mathematical rendering in the preview window.

## 🚀 Installation & Setup

Since this is currently in development, you can install it via Developer Mode:

1. **Clone the repository**:
   ```bash
   git clone https://github.com/nourabosen/EquationBridge.git
   ```
2. **Open Chrome Extensions**: Navigate to `chrome://extensions/`.
3. **Enable "Developer mode"**: Toggle the switch in the top right corner.
4. **Load Unpacked**: Click "Load unpacked" and select the `EquationBridge` folder.
5. **Test it**: Open a Google Doc and click the Equation Bridge icon in your toolbar.

## 📂 Project Structure

```text
EquationBridge/
├── manifest.json      # Extension configuration (MV3)
├── popup.html         # The user interface for LaTeX input
├── popup.js           # Logic for parsing and previewing equations
├── content.js         # Google Docs DOM manipulation and automation
├── background.js      # Context menu and message relay service
├── popup.css          # Visual styling for the popup
├── icons/             # Extension brand assets
└── libs/              # External dependencies (KaTeX for rendering)
```

## ⚖️ License

This project is licensed under the MIT License.
