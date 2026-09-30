# YouTube/WebKit log archive

This folder is the local evidence archive for future FYP agents. Read the newest Safari/WebKit notes and snapshots before changing navigation, Shorts suppression, player ownership, or WebKit media behavior.

## Safari/WebKit captures

- `webkit-safari-capture-notes-2026-09-29.txt` — authoritative cross-capture notes: page routes, visible player ownership, WebKit flags, and the observed Shorts/Playables DOM.
- `webkit-safari-home-snapshot-2026-09-29.txt` — raw Home-page Safari/WebKit snapshot.
- `webkit-safari-watch-snapshot-2026-09-29.txt` — raw watch/player Safari/WebKit snapshot.
- `webkit-safari-video-log-2026-09-29.txt` — raw Safari video-page HTML/log capture supplied during playback testing.

These files were copied from the user-provided Safari captures into this workbench so future agents can inspect them without relying on chat attachments.

## Existing diagnostics captures

- `youtube-diagnostics-2026-09-29T04-48-33-682Z.jsonl` — structured diagnostics event stream with DOM snapshots and mutation samples.
- `youtube-dom-2026-09-29T04-48-31-117Z.html` — corresponding serialized DOM capture.

## Important evidence for Shorts removal

The Safari captures show Shorts returning through SPA lifecycle and mutation activity as:

- `ytd-guide-entry-renderer` with the visible label `Shorts`.
- Guide content under `#guide`, `ytd-guide-renderer`, and `#items`.
- Reel/Shorts component families such as `ytd-reel-shelf-renderer`, `ytm-reel-shelf-renderer`, and `ytm-shorts-lockup-view-model`.
- Playables under `ytd-rich-section-renderer` → `ytd-rich-shelf-renderer`, with `/playables` links and a `View all` link.

Search the archive with:

```sh
rg -n -i "shorts|playables|reel|ytm-shorts|yt-navigate-finish" workbench/logs
```

The source implementation that consumes this evidence is `youtube-mobile-background.user.js`; its isolated-world fallback is `firefox-extension/content.template.js`. Generated bundles and release ZIPs are not authoritative until the source-only changes are rebuilt.
