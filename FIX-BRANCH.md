# FIX-BRANCH — `fix/search-menus`

> Combined cleaning checklist after merging `fix/inline-quality-gear` (2.1.6) + `fix/search-overlay-ui` (2.1.7).
> Ship version: **2.1.9**. Baseline: `origin/main` / 2.1.5 `45469de`. Do not revive failed 2.2.x search/menu rewrites.

---

## Agent contract

1. Read this file + `HANDOFF.md` + `ARCHITECTURE.md` before editing.
2. Source of truth: `youtube-mobile-background.user.js` → `./rebuild-extension.sh`.
3. Mirror toolbar + search hide/icons in `firefox-extension/content.template.js`.
4. Webpage strip stays centered **transport-only**: rewind / play-pause / forward / pip / fullscreen. No speed, no gear, no Captions / More. Captions stay native YouTube CC. Speed/quality via native `.ytp-settings-button`.
5. Prefer the **playback-speed apply pattern** (apply now + retry at 120ms, no native UI click) only if a custom menu is reintroduced later.
6. Do **not** re-add in-player clock/timer or gear overlays on the video.
7. Search: black Lucide Search control forced into the **masthead search-icon slot** (body-level `position: fixed` + safe-area). Overlay keeps Lucide X / input / Search + recents/suggestions. Do not mount the trigger inside `ytd-masthead` (WKWebView fixed-ancestor quirk).
8. After each issue is addressed, update the Status column below.
9. **Before starting the next issue, ask the user** whether to continue on:
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
| M8 | Center webpage transport strip | **Fixed in 2.1.9** | Transport-only centered strip again (no speed/gear). |
| M9 | Native speed timer + quality gear icons | **Fixed in 2.1.9** | Removed from strip and video chrome; native settings gear restored. |
| M10 | Settings dropdown broken / clash | **Fixed in 2.1.9** | Stopped hiding `.ytp-settings-button`; narrowed capture to `#fyp-…` / `[data-fyp-…]` only. |
| S1 | Search mashed / cluttered (Ask YouTube, etc.) | **Fixed in 2.1.7 / kept in 2.1.9** | Native masthead search chrome stays hidden; custom overlay is Close + centered input + Search only. |
| S2 | Search bar not opening / hard to find / invisible | **Fixed in 2.1.9** | Bottom float sat under Orion URL chrome. Now forced top-right masthead search-icon slot (`fixed` + safe-area). |
| S3 | Close + input + Search overlay polish | **Fixed in 2.1.7 / kept in 2.1.9** | Lucide X left, centered input, Lucide search right; translucent backdrop; ease-in/out. |
| S4 | Suggestions / recent searches under field | **Fixed in 2.1.7 / kept in 2.1.9** | Recents + YouTube autocomplete unchanged. |
| S5 | Search FOUC / right→center jump on load | **Fixed in 2.1.9** | Critical CSS at `document_start`; icon-only trigger; no bottom→center or right→center reflow. |

---

## WebKit / Orion research takeaways (applied in 2.1.9)

Sources: [WKUserScript injection times](https://github.com/WebKit/webkit/blob/master/Source/WebKit/UIProcess/API/Cocoa/WKUserScript.h), [WKWebView gotchas (safe-area / fixed)](https://takazudomodular.com/pj/zudo-tauri/docs/mobile/wkwebview-gotchas/), [Orion iOS extensions](https://help.kagi.com/orion/browser-extensions/ios-ipados-extensions.html), [Orion macOS extensions / MV2+MV3](https://help.kagi.com/orion/browser-extensions/macos-extensions.html), [Orion vs Chrome content-script install injection](https://github.com/w3c/webextensions/issues/617).

| Finding | Implication for FYP |
|---------|---------------------|
| `document_start` = after `<html>` exists, before page content/scripts | Keep `run_at: document_start` + inject **critical CSS immediately** in page.js so native search is hidden before first paint. |
| `env(safe-area-inset-*)` can be `0` on first paint (WebKit 191872) | Use `max(env(safe-area-inset-top), 20px)` so the trigger is not under the notch/status bar on first frame. |
| Bottom `position: fixed` is covered by keyboard / browser chrome; Orion has a floating URL bar | Do **not** put search at the bottom — it disappears under Orion chrome (user screenshot). |
| `position: fixed` under transformed ancestors re-roots / flickers on WKWebView | Mount trigger on `body`/`documentElement` only; never inside `ytd-masthead`. Use `translateZ(0)` compositor promotion. |
| Orion iOS extension support is preliminary; Chrome + Firefox zips both work; MV2/MV3 are both supported | Prefer Chrome MV3 `*_release.zip` (known-good since 2.0.20). Hard-refresh after install — Orion-Chrome may not inject content scripts until refresh. |
| Orion floating chrome is outside the webview | Keep overlays in the top masthead band; leave player strip and `.ytp-*` chrome free of FYP capture. |

---

## What 2.1.9 fixes

- Forced-visible Lucide Search in the native masthead search-icon slot (top-right fixed + safe-area).
- Early critical CSS eliminates FOUC / load jump.
- Transport-only strip (no speed timer, no gear).
- Native `.ytp-settings-button` restored; pointer capture narrowed to FYP nodes only.
- Recommended installer: `2.1.9_release.zip` (Chrome MV3).

## What 2.1.8 combined

- Merged inline Lucide quality gear + speed timer on the centered webpage strip (2.1.6).
- Merged black Search capsule, Lucide overlay, recents, and YouTube autocomplete (2.1.7).
- Superseded by 2.1.9 UX cleanup above.

## Verification (Orion iPhone)

1. Uninstall old build → install `2.1.9_release.zip` → hard-refresh YouTube.
2. Black Lucide Search icon visible top-right (left of avatar), not under Orion’s URL bar.
3. No right→center / bottom→center jump on load.
4. Webpage strip is centered transport-only (no speed/gear); native settings gear opens YouTube’s menu.
5. Overlay: Lucide X / input / Search; recents + suggestions; native CC still works.

## Next agent prompt template

After reading this file, summarize open rows (`Not fixed`), propose the smallest patch, then ask:

> Continue the next fix on **this branch** (`fix/search-menus`), a **separate branch**, or **stop**?
