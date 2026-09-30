# YouTube Diagnostics Safari Workbench

This is the Safari Web Extension payload for the local YouTube diagnostics workbench. It is embedded in the macOS host app and is intentionally isolated under `workbench/`; it is not part of the Fyoutube production packages. The JavaScript uses the `globalThis.browser || globalThis.chrome` compatibility shim because Safari and Chromium expose the WebExtension API under different globals.

## What it captures

- Page-world `console.debug`, `info`, `log`, `warn`, `error`, `dir`, `table`, `trace`, grouping, timers, counters, assertions, and clear calls.
- `window` errors and unhandled promise rejections.
- SPA history and YouTube navigation events.
- A structured DOM snapshot at startup, after navigation, and when **Capture DOM + code** is pressed. This includes element tags, IDs, classes, ARIA data, selected attributes, layout rectangles, visibility, and selector matches. The button also downloads the current `document.documentElement.outerHTML` as a separate `.html` source file instead of duplicating huge HTML fragments throughout the JSONL log.
- Media lifecycle records for every YouTube `<video>`/`<audio>` element (`loadstart`, metadata/readiness, play/pause, waiting/stalled, seeking, ended, and time updates) with `currentSrc`, ready/network state, timing, errors, and inline playback properties.
- WebKit/Safari runtime records for `visibilitychange`, `webkitvisibilitychange`, fullscreen transitions, `playsInline`, `webkitPlaysInline`, `webkitPresentationMode`, `webkitDisplayingFullscreen`, AirPlay target state, and `navigator.audioSession.type`. The DOM snapshot also reports whether Fyoutube attached the video and enabled its inline-playback path.
- Aggregated DOM mutations and interaction targets for clicks, changes, and inputs. Text/search input values are recorded to make reproduction easier; password fields and keystrokes are omitted.

The popup stores records per tab and downloads them as newline-delimited JSON (`.jsonl`) or HTML into the browser's normal Downloads folder. Safari uses its downloads API when available and avoids navigating to a `blob:` URL.

## Run in Safari

1. Open the `YouTube Diagnostics Safari.xcodeproj` host project in Xcode and run the **YouTube Diagnostics Safari** scheme with a development team selected.
2. Enable **YouTube Diagnostics Safari** in Safari → Settings → Extensions and allow access to YouTube.
3. Reload any YouTube tabs so the hook starts at `document_start`.
4. Open the extension popup while on YouTube.
5. Reproduce the issue. If the page becomes unstable, press **Pause capture** before opening Web Inspector.
6. Press **Capture DOM + code** when you want both the element map and current HTML source, then press **Download JSONL** for the event log.

The downloaded `.jsonl` file can be uploaded here for analysis. I cannot automatically read files from your Chromium profile through this chat; you need to download and attach the log.

The sibling `workbench/youtube-diagnostics` folder remains the Chromium MV3 diagnostic helper. This Safari project is the native macOS host needed to install the same diagnostics payload into Safari.

## Practical limits

This captures page code that runs after the hook is installed. It cannot recover DevTools console entries from before installation, and it does not capture network requests or the private internal state of DevTools. The element map is deliberately chunked and the full HTML is saved separately so a large YouTube DOM does not block the tab. Review the files before sharing them; password fields are the only form values intentionally omitted.
