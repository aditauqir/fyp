# FIX-BRANCH — `fix/search-menus`

> Cleaning checklist for any agent continuing this work.
> Baseline: `origin/main` @ **2.1.2** (`1ca4f57`). Do not revive the failed 2.2.x search/menu rewrites.

---

## Agent contract

1. Read this file + `HANDOFF.md` + `ARCHITECTURE.md` before editing.
2. Source of truth: `youtube-mobile-background.user.js` → `./rebuild-extension.sh`.
3. Mirror player-menu behavior in `firefox-extension/content.template.js`.
4. Keep menus present; never ship a change that removes the Captions / More dropdowns.
5. Prefer the **playback-speed apply pattern** (apply now + retry at 120ms, no native UI click) for captions/quality.
6. After each issue is addressed, update the Status column below.
7. **Before starting the next issue, ask the user** whether to continue on:
   - **this branch** (`fix/search-menus`),
   - a **separate branch**,
   - or **stop**.

---

## Status table

| ID | Issue | Status | Notes / suggested fix |
|----|-------|--------|------------------------|
| M1 | Caption dropdown vanishes / subtitle tap does nothing | **Fixed in 2.1.3 (verify with 2.1.4)** | Ghost `click` after `pointerdown` re-hit Captions under the closed menu. Fix: pointer-only when `PointerEvent` exists + 500ms ignore window after option taps. |
| M2 | Playback speed option taps feel like they vanish / fail | **Fixed in 2.1.3 (verify with 2.1.4)** | Same ghost-click race as M1. Speed apply path kept; event handling hardened. |
| M3 | Quality missing from ⋮ More menu | **Fixed in 2.1.4 (needs Orion verify)** | Quality was below the fold and menus could not scroll; section retitled **Video quality**, listed first in More, populated from player levels with a durable Auto/1080p… ladder fallback, same apply+120ms retry. |
| M4 | Prior 2.2.x work made player menus disappear entirely | **Avoided** | Scratched 2.2.x. Stay on speed-pattern menus; do not reintroduce custom overlay ownership / pointerup-only / collapse-only close experiments without user ask. Collapse arrow in 2.1.4 is additive and keeps outside-close + icon toggle. |
| M5 | Cannot scroll Captions / More dropdowns | **Fixed in 2.1.4 (needs Orion verify)** | Option `pointerdown` `preventDefault` blocked iOS overflow scrolling. Options now activate on low-slop `pointerup`/`touchend`; menu CSS uses `overflow-y: auto`, `-webkit-overflow-scrolling: touch`, `touch-action: pan-y`. |
| M6 | Need Lucide-style up-arrow collapse control | **Fixed in 2.1.4 (needs Orion verify)** | Added `.fyp-player-menu-collapse` chevron-up control (`menu-collapse`) at the top of Captions and More menus. |
| M7 | Captions broken — native vs menu fight | **Fixed in 2.1.4 (needs Orion verify)** | One owner: YouTube caption module via `loadModule` + `setOption('captions','track')`. Stopped clicking `.ytp-subtitles-button` and stopped forcing competing TextTrack selections. `suppressDuplicateNativeCaptions` only demotes `showing`→`hidden` when custom `.ytp-caption-segment` exists (skill contract). |
| S1 | Search mashed / cluttered (Ask YouTube, etc.) | **Not fixed** | Next: restore main open/focus path; hide Ask YouTube / AI / voice only. Do not rebuild a custom full-screen search overlay. |
| S2 | Search bar not opening | **Not fixed** | Verify masthead trigger selectors + `data-fyp-mobile-search-open` on main code before any new search UI. |
| S3 | User wanted Close + input + Search only | **Not fixed** | CSS-hide clutter on main search; keep native `#center` bar. |

---

## What 2.1.4 changed (code)

- Menus scroll on Orion/iOS; collapse chevron closes the open menu.
- More menu leads with **Video quality**, then Playback speed, then Native player settings.
- Captions prefer YouTube `tracklist` / `setOption`; dedupe only hides WebKit `::cue` beside custom segments.
- Quality levels fall back to a usable ladder when the player reports only Auto/empty.

## What 2.1.3 changed (code)

- Captions / speed / quality option handlers use apply + `setTimeout(..., 120)`.
- Player control capture no longer binds both `pointerdown` and `click` when `PointerEvent` exists.
- Option taps set a short ignore window so the synthetic click cannot reopen/toggle Captions/More.

## What failed before (do not repeat)

- 2.2.0–2.2.3 custom native-search ownership, close-button IDs, pointerup-only menus, forced collapse-button ownership races.
- Removing outside-close entirely without a working collapse path.
- Heavy caption paths that click `.ytp-subtitles-button` before the player API apply (steals the gesture on Orion).

## Verification (Orion iPhone)

1. Uninstall old build → install `2.1.4_release.zip` → hard-refresh YouTube.
2. Captions / More menus scroll through long lists; up-arrow collapses the menu.
3. Captions menu opens; picking a subtitle shows YouTube’s caption layer (no blank fight).
4. More → Video quality list appears and applies; speed still applies.
5. Toolbar Captions / More buttons still exist after option taps (menus must not disappear as chrome).

## Next agent prompt template

After reading this file, summarize open rows (`Not fixed`), propose the smallest patch, then ask:

> Continue the next fix on **this branch** (`fix/search-menus`), a **separate branch**, or **stop**?
