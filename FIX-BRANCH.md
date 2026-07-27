# FIX-BRANCH — `fix/inline-quality-gear`

> Parallel branch off `fix/search-menus` @ **2.1.5** (`45469de`). Owns inline quality gear only — do not rewrite search overlay UI here.
> Search work continues on `fix/search-menus` / `fix/search-overlay-ui` (they may ship as 2.1.7).

---

## Agent contract

1. Read this file + `HANDOFF.md` + `ARCHITECTURE.md` before editing.
2. Source of truth: `youtube-mobile-background.user.js` → `./rebuild-extension.sh`.
3. Mirror toolbar/quality behavior in `firefox-extension/content.template.js`.
4. Webpage strip stays centered: rewind / play-pause / forward / pip / fullscreen / speed / **quality gear**. No Captions / More. Captions stay native YouTube CC.
5. Prefer the **playback-speed apply pattern** (apply now + retry at 120ms, no native UI click) for speed/quality.
6. Do **not** re-add in-player clock/timer or gear overlays on the video.
7. After each issue is addressed, update the Status column below.

---

## Status table

| ID | Issue | Status | Notes / suggested fix |
|----|-------|--------|------------------------|
| M1 | Caption dropdown vanishes / subtitle tap does nothing | **Fixed in 2.1.3 (superseded UI in 2.1.5)** | Webpage Captions button removed in 2.1.5; native CC remains. |
| M2 | Playback speed option taps feel like they vanish / fail | **Fixed in 2.1.6 (this branch)** | Speed Lucide timer lives in the centered webpage strip (not on-video); same apply + 120ms retry. |
| M3 | Quality missing from ⋮ More menu | **Fixed in 2.1.6 (this branch)** | Quality Lucide gear lives in the centered webpage strip; apply + 120ms retry. |
| M4 | Prior 2.2.x work made player menus disappear entirely | **Avoided** | Stay on speed-pattern menus; no native-search ownership. |
| M5 | Cannot scroll Captions / More dropdowns | **Fixed in 2.1.4** | Option `pointerup`/`touchend` + pan-y scrolling preserved for strip menus. |
| M6 | Need Lucide-style up-arrow collapse control | **Fixed in 2.1.4** | Collapse chevron kept on speed/quality menus. |
| M7 | Captions broken — native vs menu fight | **Fixed in 2.1.5** | Webpage captions menu removed; native `.ytp-subtitles-button` is the path. Dedup contract still applies. |
| M8 | Center webpage transport strip | **Fixed in 2.1.5 / extended in 2.1.6** | Strip remains horizontally centered; 2.1.6 adds speed + quality inline. |
| M9 | Native speed timer + quality gear icons | **Fixed in 2.1.6 (this branch)** | Removed in-player chrome overlays; Lucide timer + gear are inline in the webpage control strip. |
| S1–S3 | Search overlay | **Owned by search branch** | Do not edit search open/overlay UI on this branch beyond avoiding breakage. |

---

## What 2.1.6 changed on this branch

- Removed in-player speed (clock/timer) and quality (gear) overlays mounted on `#movie_player`.
- Added Lucide quality gear to the centered webpage transport strip; quality menu keeps apply + 120ms retry.
- Kept speed reachable via a Lucide timer in the same strip (not re-added as an on-video overlay).
- Captions remain native CC; no webpage Captions/More revival.
- Test zip: `2.1.6_inline-gear_test.zip` (Chrome MV3). Search agent may ship separately as 2.1.7.

## What 2.1.5 changed (baseline)

- Removed Captions + More from the webpage control strip; centered rewind / play-pause / forward / pip / fullscreen.
- Added in-player speed/quality overlays (superseded by M9 on this branch).
- Global search overlay (Close + input + Search).

## Verification (Orion iPhone)

1. Uninstall old build → install `2.1.6_inline-gear_test.zip` → hard-refresh YouTube.
2. Webpage strip is centered with transport + speed timer + quality gear (no Captions / More).
3. No clock/gear floating on the video chrome.
4. Gear opens quality; timer opens speed; both apply and keep playing.
5. Native CC still toggles captions; no double cues when custom segments show.
