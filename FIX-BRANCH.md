# FIX-BRANCH — `fix/search-menus`

> Cleaning checklist for any agent continuing this work.
> Baseline: `origin/main` @ **2.1.2** (`1ca4f57`). Do not revive the failed 2.2.x search/menu rewrites.

---

## Agent contract

1. Read this file + `HANDOFF.md` + `ARCHITECTURE.md` before editing.
2. Source of truth: `youtube-mobile-background.user.js` → `./rebuild-extension.sh`.
3. Mirror player-menu behavior in `firefox-extension/content.template.js`.
4. Webpage strip is transport-only (no Captions / More). Speed + quality live in in-player chrome icons; captions use native YouTube CC.
5. Prefer the **playback-speed apply pattern** (apply now + retry at 120ms, no native UI click) for speed/quality.
6. After each issue is addressed, update the Status column below.
7. **Before starting the next issue, ask the user** whether to continue on:
   - **this branch** (`fix/search-menus`),
   - a **separate branch**,
   - or **stop**.

---

## Status table

| ID | Issue | Status | Notes / suggested fix |
|----|-------|--------|------------------------|
| M1 | Caption dropdown vanishes / subtitle tap does nothing | **Fixed in 2.1.3 (superseded UI in 2.1.5)** | Webpage Captions button removed in 2.1.5; native CC remains. Ghost-click hardening still applies to chrome menus. |
| M2 | Playback speed option taps feel like they vanish / fail | **Fixed in 2.1.5** | Speed moved to in-player timer icon; same apply + 120ms retry. |
| M3 | Quality missing from ⋮ More menu | **Fixed in 2.1.5** | Quality moved to in-player gear icon (no webpage More menu). |
| M4 | Prior 2.2.x work made player menus disappear entirely | **Avoided** | Stay on speed-pattern menus; chrome overlay is additive, not ownership of native search. |
| M5 | Cannot scroll Captions / More dropdowns | **Fixed in 2.1.4** | Option `pointerup`/`touchend` + pan-y scrolling preserved for chrome menus. |
| M6 | Need Lucide-style up-arrow collapse control | **Fixed in 2.1.4** | Collapse chevron kept on speed/quality menus. |
| M7 | Captions broken — native vs menu fight | **Fixed in 2.1.5** | Webpage captions menu removed; native `.ytp-subtitles-button` is the path. Dedup contract still applies. |
| M8 | Center webpage transport strip | **Fixed in 2.1.5** | Strip is five buttons (rewind / play-pause / forward / pip / fullscreen), horizontally centered. |
| M9 | Native speed timer + quality gear icons | **Fixed in 2.1.5** | In-player overlay near control row; Lucide timer + gear; menus use apply+120ms. |
| S1 | Search mashed / cluttered (Ask YouTube, etc.) | **Fixed in 2.1.5** | Native masthead search chrome hidden; custom overlay is Close + input + Search only. |
| S2 | Search bar not opening | **Fixed in 2.1.5** | Custom `#…-search-trigger` opens overlay on all browse/watch pages. |
| S3 | User wanted Close + input + Search only | **Fixed in 2.1.5** | Overlay: left close, center input, right submit; translucent backdrop with ease animation. |

---

## What 2.1.5 changed (code)

- Removed Captions + More from the webpage control strip; centered rewind / play-pause / forward / pip / fullscreen.
- Added in-player speed (timer) and quality (gear) overlays with scrollable menus and apply + 120ms retry.
- Captions path is native YouTube CC; caption dedup still hides WebKit `::cue` beside custom segments.
- Replaced native masthead search with a global overlay (close / input / submit) and hidden Ask/voice/AI clutter.

## What 2.1.4 changed (code)

- Menus scroll on Orion/iOS; collapse chevron closes the open menu.
- More menu led with **Video quality**, then Playback speed (superseded by M9 in 2.1.5).
- Captions prefer YouTube `tracklist` / `setOption`; dedupe only hides WebKit `::cue` beside custom segments.

## What failed before (do not repeat)

- 2.2.0–2.2.3 custom native-search ownership races that fought YouTube’s masthead.
- Removing outside-close entirely without a working collapse path.
- Heavy caption paths that click `.ytp-subtitles-button` before the player API apply.

## Verification (Orion iPhone)

1. Uninstall old build → install `2.1.5_release.zip` → hard-refresh YouTube.
2. Webpage strip is centered with five transport buttons only (no Captions / More).
3. In-player timer opens speed; gear opens quality; both apply and keep playing.
4. Native CC still toggles captions; no double cues when custom segments show.
5. Search icon works on Home, Watch, History, and other browse pages; overlay is Close + input + Search only.

## Next agent prompt template

After reading this file, summarize open rows (`Not fixed`), propose the smallest patch, then ask:

> Continue the next fix on **this branch** (`fix/search-menus`), a **separate branch**, or **stop**?
