# FIX-BRANCH — `fix/search-menus`

> Combined cleaning checklist after merging `fix/inline-quality-gear` (2.1.6) + `fix/search-overlay-ui` (2.1.7).
> Ship version: **2.2.0**. Baseline: 2.1.9 `6b29d53`. Masthead-forced search placement was rejected and replaced.

---

## Agent contract

1. Read this file + `HANDOFF.md` + `ARCHITECTURE.md` before editing.
2. Source of truth: `youtube-mobile-background.user.js` → `./rebuild-extension.sh`.
3. Mirror toolbar + search hide/icons in `firefox-extension/content.template.js`.
4. Webpage strip stays centered **transport-only**: rewind / play-pause / forward / pip / fullscreen. No speed, no gear, no Captions / More. Captions stay native YouTube CC. Speed/quality via native `.ytp-settings-button`.
5. Prefer the **playback-speed apply pattern** (apply now + retry at 120ms, no native UI click) only if a custom menu is reintroduced later.
6. Do **not** re-add in-player clock/timer or gear overlays on the video.
7. Search placement (2.2.0):
   - **Home:** half-width chip over the first feed video thumbnail.
   - **Watch:** rectangular pill below the inline transport strip (must not cover player chrome).
   - Overlay: Lucide X + “Searching for something?” + input; keep backdrop/ease + recents/suggestions; strip Ask YouTube / voice / AI.
   - **Do not** revive masthead top-right fixed search (user rejected; caused FOUC).
8. Loading jump: early critical CSS + **skeleton placeholders** matching final Home chip / Watch strip+pill footprints until real UI is mounted (`data-fyp-ui-ready`).
9. After each issue is addressed, update the Status column below.
10. **Before starting the next issue, ask the user** whether to continue on:
   - **this branch** (`fix/search-menus`),
   - a **separate branch**,
   - or **stop**.

---

## Status table

| ID | Issue | Status | Notes / suggested fix |
|----|-------|--------|------------------------|
| M1 | Caption dropdown vanishes / subtitle tap does nothing | **Fixed in 2.1.3 (superseded UI in 2.1.5)** | Webpage Captions button removed in 2.1.5; native CC remains. |
| M2 | Playback speed option taps feel like they vanish / fail | **Superseded in 2.1.9** | Strip speed timer removed; use native player settings. |
| M3 | Quality missing from ⋮ More menu | **Superseded in 2.1.9** | Strip quality gear removed; use native `.ytp-settings-button`. |
| M4 | Prior 2.2.x work made player menus disappear entirely | **Avoided** | Stay on speed-pattern menus only if reintroduced; no native-search ownership. |
| M5 | Cannot scroll Captions / More dropdowns | **Fixed in 2.1.4** | Option `pointerup`/`touchend` + pan-y scrolling preserved for strip menus. |
| M6 | Need Lucide-style up-arrow collapse control | **Fixed in 2.1.4** | Collapse chevron kept on speed/quality menus (code retained, strip buttons gone). |
| M7 | Captions broken — native vs menu fight | **Fixed in 2.1.5** | Webpage captions menu removed; native `.ytp-subtitles-button` is the path. |
| M8 | Center webpage transport strip | **Fixed in 2.1.9 / kept in 2.2.0** | Transport-only centered strip; buttons enlarged in 2.2.0. |
| M9 | Native speed timer + quality gear icons | **Fixed in 2.1.9** | Removed from strip and video chrome; native settings gear restored. |
| M10 | Settings dropdown broken / clash | **Fixed in 2.1.9** | Stopped hiding `.ytp-settings-button`; narrowed capture to `#fyp-…` / `[data-fyp-…]` only. |
| M11 | Play/Pause icon mismatch vs native player | **Fixed in 2.2.0** | Filled Material/YouTube-like triangle + bars; aria/state synced to paused/playing. |
| S1 | Search mashed / cluttered (Ask YouTube, etc.) | **Fixed in 2.2.0** | Native masthead + Ask/voice/AI chrome hidden; overlay is X + prompt + input only. |
| S2 | Search hard to find / wrong placement | **Fixed in 2.2.0** | Home chip on first video; Watch pill below strip. Masthead float removed. |
| S3 | Close + input overlay polish | **Fixed in 2.2.0** | Lucide X, “Searching for something?”, input, backdrop, ease-in/out. |
| S4 | Suggestions / recent searches under field | **Kept** | Recents + YouTube autocomplete unchanged. |
| S5 | Search FOUC / right→center jump on load | **Fixed in 2.2.0** | No masthead fixed slot; skeleton shimmer reserves final footprint until UI ready. |

---

## WebKit / Orion research takeaways (applied through 2.2.0)

Sources: [WKUserScript injection times](https://github.com/WebKit/webkit/blob/master/Source/WebKit/UIProcess/API/Cocoa/WKUserScript.h), [WKWebView gotchas (safe-area / fixed)](https://takazudomodular.com/pj/zudo-tauri/docs/mobile/wkwebview-gotchas/), [Orion iOS extensions](https://help.kagi.com/orion/browser-extensions/ios-ipados-extensions.html), [Orion macOS extensions / MV2+MV3](https://help.kagi.com/orion/browser-extensions/macos-extensions.html), [Orion vs Chrome content-script install injection](https://github.com/w3c/webextensions/issues/617).

| Finding | Implication for FYP |
|---------|---------------------|
| `document_start` = after `<html>` exists, before page content/scripts | Keep `run_at: document_start` + inject **critical CSS immediately** so native search/Ask/voice is hidden before first paint. |
| `env(safe-area-inset-*)` can be `0` on first paint (WebKit 191872) | Skeleton/Home offsets use `max(env(safe-area-inset-top), 20px)`. |
| Bottom `position: fixed` is covered by keyboard / browser chrome; Orion has a floating URL bar | Do **not** put search at the bottom. |
| Masthead top-right fixed icon still caused right→center FOUC when later remounted | Do **not** use masthead-slot fixed search. Use Home chip / Watch flow pill + skeleton until ready. |
| `position: fixed` under transformed ancestors re-roots / flickers on WKWebView | Prefer in-flow Watch pill and thumbnail-hosted Home chip; use `translateZ(0)` when fixed skeletons are needed. |
| Orion iOS extension support is preliminary; Chrome + Firefox zips both work; MV2/MV3 are both supported | Prefer Chrome MV3 `*_release.zip`. Hard-refresh after install. |
| Orion floating chrome is outside the webview | Leave `.ytp-*` chrome free of FYP capture; Watch search sits below the webpage strip only. |

---

## What 2.2.0 fixes

- Home half-width search chip on first video; Watch rectangular pill below transport strip.
- Overlay prompt “Searching for something?” + Lucide X + input; Ask/voice/AI stripped.
- Skeleton shimmer placeholders prevent load jump until `data-fyp-ui-ready`.
- Larger strip buttons; YouTube-like play/pause icons.
- Recommended installer: `2.2.0_release.zip` (Chrome MV3).

## What 2.1.9 fixed (superseded search placement)

- Forced-visible Lucide Search in the native masthead search-icon slot (top-right fixed + safe-area) — **rejected / removed in 2.2.0**.
- Early critical CSS for FOUC; transport-only strip; native settings restored.

## Verification (Orion iPhone)

1. Uninstall old build → install `2.2.0_release.zip` → hard-refresh YouTube.
2. Home: half-width Search chip over first video; skeleton may flash first, then real chip (no right→center slide).
3. Watch: transport strip, then search pill below it; does not cover player chrome.
4. Overlay: X / “Searching for something?” / input; recents + suggestions; no Ask YouTube / voice.
5. Play/pause glyph matches playing state; buttons feel larger to tap.

## Next agent prompt template

After reading this file, summarize open rows (`Not fixed`), propose the smallest patch, then ask:

> Continue the next fix on **this branch** (`fix/search-menus`), a **separate branch**, or **stop**?
