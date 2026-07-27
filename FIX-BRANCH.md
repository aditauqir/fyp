# FIX-BRANCH — `fix/search-menus`

> Combined cleaning checklist after merging `fix/inline-quality-gear` (2.1.6) + `fix/search-overlay-ui` (2.1.7).
> Ship version: **2.1.8**. Baseline: `origin/main` / 2.1.5 `45469de`. Do not revive failed 2.2.x search/menu rewrites.

---

## Agent contract

1. Read this file + `HANDOFF.md` + `ARCHITECTURE.md` before editing.
2. Source of truth: `youtube-mobile-background.user.js` → `./rebuild-extension.sh`.
3. Mirror toolbar/quality + search hide/icons in `firefox-extension/content.template.js`.
4. Webpage strip stays centered: rewind / play-pause / forward / pip / fullscreen / speed / **quality gear**. No Captions / More. Captions stay native YouTube CC.
5. Prefer the **playback-speed apply pattern** (apply now + retry at 120ms, no native UI click) for speed/quality.
6. Do **not** re-add in-player clock/timer or gear overlays on the video.
7. Keep the black Search capsule + Lucide overlay with recents/suggestions; do not re-own native masthead search.
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
| M2 | Playback speed option taps feel like they vanish / fail | **Fixed in 2.1.6 / shipped in 2.1.8** | Speed Lucide timer lives in the centered webpage strip (not on-video); same apply + 120ms retry. |
| M3 | Quality missing from ⋮ More menu | **Fixed in 2.1.6 / shipped in 2.1.8** | Quality Lucide gear lives in the centered webpage strip; apply + 120ms retry. |
| M4 | Prior 2.2.x work made player menus disappear entirely | **Avoided** | Stay on speed-pattern menus; no native-search ownership. |
| M5 | Cannot scroll Captions / More dropdowns | **Fixed in 2.1.4** | Option `pointerup`/`touchend` + pan-y scrolling preserved for strip menus. |
| M6 | Need Lucide-style up-arrow collapse control | **Fixed in 2.1.4** | Collapse chevron kept on speed/quality menus. |
| M7 | Captions broken — native vs menu fight | **Fixed in 2.1.5** | Webpage captions menu removed; native `.ytp-subtitles-button` is the path. Dedup contract still applies. |
| M8 | Center webpage transport strip | **Fixed in 2.1.5 / extended in 2.1.6** | Strip remains horizontally centered; 2.1.6 adds speed + quality inline. |
| M9 | Native speed timer + quality gear icons | **Fixed in 2.1.6 / shipped in 2.1.8** | Removed in-player chrome overlays; Lucide timer + gear are inline in the webpage control strip. |
| S1 | Search mashed / cluttered (Ask YouTube, etc.) | **Fixed in 2.1.7 / shipped in 2.1.8** | Native masthead search chrome stays hidden; custom overlay is Close + centered input + Search only. |
| S2 | Search bar not opening / hard to find | **Fixed in 2.1.7 / shipped in 2.1.8** | Bottom black `#…-search-trigger` capsule (centered “Search” + Lucide search, no chevron) opens overlay on Home, Watch, History, browse. |
| S3 | Close + input + Search overlay polish | **Fixed in 2.1.7 / shipped in 2.1.8** | Lucide X left, centered input, Lucide search right; translucent backdrop; ease-in/out open/close. |
| S4 | Suggestions / recent searches under field | **Fixed in 2.1.7 / shipped in 2.1.8** | Empty query shows localStorage recents; typing fetches YouTube autocomplete via JSONP `suggestqueries` (falls back to filtered recents). |

---

## What 2.1.8 combined

- Merged inline Lucide quality gear + speed timer on the centered webpage strip (2.1.6).
- Merged black Search capsule, Lucide overlay, recents, and YouTube autocomplete (2.1.7).
- Recommended installer: `2.1.8_release.zip` (Chrome MV3).

## What 2.1.6 contributed

- Removed in-player speed (clock/timer) and quality (gear) overlays mounted on `#movie_player`.
- Added Lucide quality gear + speed timer to the centered webpage transport strip; menus keep apply + 120ms retry.
- Captions remain native CC; no webpage Captions/More revival.

## What 2.1.7 contributed

- Fixed bottom black Search capsule: centered **Search** label + Lucide search icon (no chevron).
- Overlay: Lucide X / centered input / Lucide search; ease-in-out; translucent backdrop.
- Recents from `localStorage`; live YouTube autocomplete suggestions while typing.

## Verification (Orion iPhone)

1. Uninstall old build → install `2.1.8_release.zip` → hard-refresh YouTube.
2. Webpage strip is centered with transport + speed timer + quality gear (no Captions / More); no clock/gear on the video chrome.
3. Gear opens quality; timer opens speed; both apply and keep playing.
4. Bottom black Search capsule opens overlay; recents show when empty; typing shows suggestions; submit works.
5. Native CC still toggles captions; no double cues when custom segments show.

## Next agent prompt template

After reading this file, summarize open rows (`Not fixed`), propose the smallest patch, then ask:

> Continue the next fix on **this branch** (`fix/search-menus`), a **separate branch**, or **stop**?
