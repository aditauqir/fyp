# FIX-BRANCH — `fix/search-overlay-ui`

> Cleaning checklist for the search overlay UI branch.
> Baseline: `fix/search-menus` @ **2.1.5** (`45469de`). Gear/inline-quality work stays on `fix/inline-quality-gear` (**2.1.6**). This branch ships search UI only at **2.1.7**.

---

## Agent contract

1. Read this file + `HANDOFF.md` + `ARCHITECTURE.md` before editing.
2. Source of truth: `youtube-mobile-background.user.js` → `./rebuild-extension.sh`.
3. Mirror search hide/icons in `firefox-extension/content.template.js` (do not own player clock/gear/inline quality).
4. Webpage strip / in-player chrome are owned by the gear agent — leave them alone on this branch.
5. After each issue is addressed, update the Status column below.

---

## Status table

| ID | Issue | Status | Notes / suggested fix |
|----|-------|--------|------------------------|
| S1 | Search mashed / cluttered (Ask YouTube, etc.) | **Fixed in 2.1.7** | Native masthead search chrome stays hidden; custom overlay is Close + centered input + Search only. |
| S2 | Search bar not opening / hard to find | **Fixed in 2.1.7** | Bottom black `#…-search-trigger` capsule (centered “Search” + Lucide search, no chevron) opens overlay on Home, Watch, History, browse. |
| S3 | Close + input + Search overlay polish | **Fixed in 2.1.7** | Lucide X left, centered input, Lucide search right; translucent backdrop; ease-in/out open/close. |
| S4 | Suggestions / recent searches under field | **Fixed in 2.1.7** | Empty query shows localStorage recents; typing fetches YouTube autocomplete via JSONP `suggestqueries` (falls back to filtered recents). |

Menu/player rows (M1–M9) remain documented on `fix/search-menus` / gear branch; not owned here.

---

## What 2.1.7 changed (code)

- Replaced masthead icon-only search trigger with a fixed bottom black capsule: centered **Search** label + Lucide search icon (no chevron).
- Open overlay keeps Close (left) / input (center) / Search (right) with ease-in-out animation and translucent blurred backdrop.
- Suggestions panel under the field: **Recent searches** from `localStorage` when empty; **Suggestions** from YouTube autocomplete while typing (JSONP, Orion-safe). Tap a row to search.
- Native YouTube search icon / masthead searchbox remain hidden; Ask/voice/AI clutter path unchanged.
- Version bump to `2.1.7` (gear agent uses `2.1.6`).

## Verification (Orion iPhone)

1. Uninstall old build → install `2.1.7_search-overlay_test.zip` → hard-refresh YouTube.
2. Bottom black Search capsule is visible on Home, Watch, History, and other browse pages; native masthead search icon is gone.
3. Tap capsule → overlay eases in with translucent backdrop; X left, input center, search right; recents appear under the field when available.
4. Typing shows YouTube suggestions when reachable; submit / suggestion tap runs `/results?search_query=` and remembers the query.
5. Do not regress player clock/gear/inline quality (other branch).

## Next agent prompt template

After reading this file, summarize open rows (`Not fixed`), propose the smallest patch, then ask:

> Continue the next fix on **this branch** (`fix/search-overlay-ui`), a **separate branch**, or **stop**?
