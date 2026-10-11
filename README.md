# ChatGPT Conversation Exporter

Version **1.0**

A Google Chrome extension that collects prompts and responses from the open ChatGPT conversation, downloads an HTML copy, and opens a dedicated tab for PDF printing.

Useful for keeping study notes, reviewing research discussions, and archiving conversations in a readable format.

## Features

- Collects both user prompts and ChatGPT responses.
- Scans from the beginning to the end of the conversation to capture messages loaded through virtual scrolling.
- Opens a separate extension page for printing, isolating the conversation from the original site's print styles.
- Uses Chrome's print dialog to save the conversation as a PDF.
- Downloads an HTML copy and provides buttons for exporting it again.
- Removes message action controls and relaxes collapsed content styles.
- Preserves line breaks, headings, code blocks, lists, tables, and image URLs where available.
- Converts KaTeX formulas containing MathML into native MathML to reduce reliance on external formula styles and fonts.

The extension interface currently uses Japanese labels. Installation and usage instructions are provided below in English.

## Requirements

- Google Chrome 112 or later.
- A conversation open on `https://chatgpt.com/` or `https://chat.openai.com/`.

Node.js is only needed to run the development tests; it is not needed to use the extension.

## Installation

1. Download this repository as a ZIP or clone it.
2. Extract the ZIP, if applicable.
3. Open `chrome://extensions/` in Chrome.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the folder that directly contains `manifest.json`.
7. Pin **ChatGPT Conversation Exporter** from Chrome's extensions menu.

If replacing a previous local build, disable it first to avoid running two copies. Alternatively, replace every extension file in the existing installation folder, then click **Reload** on the extension card. Reload the ChatGPT conversation page after updating.

This repository contains an unpacked extension. Installing it from the Chrome Web Store is not part of this workflow.

## Usage

1. Open the conversation you want to save.
2. Wait until ChatGPT finishes generating its response.
3. Click the extension icon.
4. Wait while the extension scans the conversation. Avoid changing conversations or scrolling manually during collection.
5. An HTML file is downloaded, and a separate conversation-only tab opens.
6. In the print dialog, select **Save as PDF**, then click **Save**.
7. If the print dialog does not open automatically, click **PDF保存** in the dedicated tab.
8. Return to the original conversation tab and click **画面を元に戻す**, or press **Esc**, to restore the original interface.

The final PDF filename, destination, and save action are controlled by Chrome's print dialog. The extension does not silently generate or download a PDF file.

### Button labels

- **PDF保存** — open the PDF print dialog.
- **HTML保存** — download another HTML copy.
- **両方保存 (HTML+PDF)** — download HTML and open another print tab.
- **画面を元に戻す (Esc)** — restore the original ChatGPT interface.

## Troubleshooting

### The print preview is blank

Make sure you are printing the dedicated conversation tab rather than the original ChatGPT page. Check that the prompts and responses are visible in that tab, then click **PDF保存** again.

As a fallback, open the downloaded HTML file in Chrome and press **Ctrl+P** to save it as a PDF.

### No print tab opens

Reload the extension and the ChatGPT page, then try again. The original page displays an error if the conversation cannot be transferred. Very large conversations, especially those containing canvas-derived images, can exceed Chrome's temporary storage quota. The downloaded HTML remains available as a fallback if the transfer fails after HTML export.

### Messages or images are missing

Allow the conversation to finish loading and try again. Check the earliest and latest messages and the collected message count before relying on the export. Images may require a valid URL or an active login session.

## Scope and limitations

- Exports the readable messages in the currently open conversation branch, not every conversation in your account.
- Does not recover deleted messages or alternate branches hidden by edits or regenerated responses.
- Does not extract the complete contents of attached PDFs or other attachments.
- Does not compare the collected messages against a server-side message count. Completeness cannot be guaranteed when the site does not load older messages.
- Stops with an error if its scroll scan limit is reached, rather than claiming that collection is complete.
- References image URLs rather than embedding every image. Saved HTML is not guaranteed to remain fully usable offline.
- Formula, diagram, interactive component, and embedded content layouts may differ from the original page. Images can expire or fail to load.
- ChatGPT UI changes may require updates to the message selectors.

## Privacy and permissions

Conversation collection happens in your browser. The extension does not upload conversation text to an external export service and does not call the ChatGPT API.

Conversation data is temporarily stored in the extension's `chrome.storage.session` area to pass it to the print tab. The corresponding data is removed when that tab closes. This temporary storage is also cleared when the browser exits. Downloaded HTML and PDF files remain under your control.

Exported content can reference remote images. Opening or printing the export may request those images from their original hosts.

Requested permissions:

- `activeTab`: access the active page after you click the extension icon.
- `scripting`: inject the collection script into that page.
- `storage`: temporarily transfer the collected conversation to the print tab.

No persistent host permissions are declared.

## Project structure

```text
chatgpt-conversation-exporter/
├── manifest.json
├── background.js
├── print-chat.js
├── print.html
├── print-view.js
├── print-view.css
├── icons/
├── tests/
├── package.json
└── README.md
```

## Development and validation

Install the development dependencies and run the tests:

```sh
npm install
npm test
```

The automated suite contains 10 tests covering message order and roles, virtual scrolling in both directions, MathML conversion, UI restoration, print-tab data transfer, repeated printing, and failure handling. DOM tests use jsdom; they do not exercise Chrome's actual print preview.

JavaScript syntax checks and the automated suite passed during preparation of this release. The extension was not verified against a live ChatGPT session or a Windows Chrome print preview in that environment. Start with a short conversation, then check a longer one for its first message, last message, and message count.

The extension manifest uses version `1.0`. The development package uses `1.0.0` to follow npm's version format.

## Acknowledgment

This is an independent project and is not affiliated with or endorsed by OpenAI or Google.
