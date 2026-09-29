# YouTube Diagnostics Workbench

This is a small local Chromium MV3 extension for investigating YouTube behavior. It is intentionally isolated under `workbench/` and is tracked with the branch as an internal tool. It uses Chromium APIs only.

## What it captures

- Page-world `console.debug`, `info`, `log`, `warn`, `error`, `dir`, `table`, `trace`, grouping, timers, counters, assertions, and clear calls.
- `window` errors and unhandled promise rejections.
- SPA history and YouTube navigation events.
- A structured DOM snapshot at startup, after navigation, and when **Capture DOM + code** is pressed. This includes element tags, IDs, classes, ARIA data, selected attributes, layout rectangles, visibility, and selector matches. The button also downloads the current `document.documentElement.outerHTML` as a separate `.html` source file instead of duplicating huge HTML fragments throughout the JSONL log.
- Aggregated DOM mutations and interaction targets for clicks, changes, and inputs. Text/search input values are recorded to make reproduction easier; password fields and keystrokes are omitted.

The popup stores records per tab and downloads them as newline-delimited JSON (`.jsonl`).

## Install in Chromium

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this folder: `workbench/youtube-diagnostics`.
5. Reload any YouTube tabs so the hook starts at `document_start`.
6. Open the extension popup while on YouTube.
7. Reproduce the issue. If the page becomes unstable, press **Pause capture** before opening DevTools/Inspect.
8. Press **Capture DOM + code** when you want both the element map and current HTML source, then press **Download JSONL** for the event log.

The downloaded `.jsonl` file can be uploaded here for analysis. I cannot automatically read files from your Chromium profile through this chat; you need to download and attach the log.

## Practical limits

This captures page code that runs after the hook is installed. It cannot recover DevTools console entries from before installation, and it does not capture network requests or the private internal state of DevTools. The element map is deliberately chunked and the full HTML is saved separately so a large YouTube DOM does not block the tab. Review the files before sharing them; password fields are the only form values intentionally omitted.
