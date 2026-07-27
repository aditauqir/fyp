# FIX-BRANCH — `fix/search-menus`

> **2.2.3 TEST BUILD** (caption activation fix on top of 2.2.2). Ship version when approved: **2.2.3**.
> Baseline restored search: `origin/main` / `1ca4f57` (2.1.2 native masthead path).
> Kept from later work: enlarged centered transport strip (rewind / play-pause / forward / pip / fullscreen).
> Do **not** merge/push main or create GitHub releases until the user says “it’s good”.

---

## Agent contract

1. Read this file + `HANDOFF.md` + `ARCHITECTURE.md` before editing.
2. Source of truth: `youtube-mobile-background.user.js` → `./rebuild-extension.sh`.
3. Mirror Ask/voice hide (only) in `firefox-extension/content.template.js`. Do **not** hide native masthead `#center` / search buttons.
4. Webpage strip stays centered **transport-only**: rewind / play-pause / forward / pip / fullscreen. No speed, no gear, no Captions / More. Captions stay native YouTube CC. Speed/quality via native `.ytp-settings-button`.
5. Prefer the **playback-speed apply pattern** (apply now + retry at 120ms, no native UI click) only if a custom menu is reintroduced later.
6. Do **not** re-add in-player clock/timer or gear overlays on the video.
7. **Search (2.2.1):** restore / keep **2.1.2-style native-assisted masthead search**. Tap native search icon → phone-width `#center` overlay. Strip Ask YouTube / voice / AI with CSS only.
8. **Do not revive** without explicit user approval:
   - Home first-video search chip
   - Watch search pill under the strip
   - Bottom Search capsule
   - Masthead top-right forced Lucide float
   - Custom “Searching for something?” overlay
   - Recents / autocomplete overlay UI
   - Skeleton / FOUC placeholder loaders for search
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
| M8 | Center webpage transport strip | **Kept** | Transport-only centered strip; buttons enlarged (2.2.0 → 2.2.1). |
| M9 | Native speed timer + quality gear icons | **Fixed in 2.1.9** | Removed from strip and video chrome; native settings gear restored. |
| M10 | Settings dropdown broken / clash | **Fixed in 2.1.9** | Stopped hiding `.ytp-settings-button`; narrowed capture to `#fyp-…` / `[data-fyp-…]` only. |
| M11 | Play/Pause icon mismatch vs native player | **Kept** | Filled Material/YouTube-like triangle + bars; aria/state synced to paused/playing. |
| M12 | Double captions / English selected twice | **Fixed in 2.2.3 (test zip)** | Single-track enforcement deferred until custom caption segments exist; then `hidden` + disable duplicates. Do not touch search/buttons. |
| S1–S5 | Custom search experiments (2.1.5–2.2.0) | **REVERTED / FAILED — do not revive without user approval** | See failure log below. Native 2.1.2 path restored in 2.2.1. |

---

## Failure log — 2.1.5–2.2.0 search (REVERTED)

**Status: REVERTED / FAILED — do not revive without user approval.**

What failed (user: “2.2.0 broke everything”):

| Experiment | Versions | Why it failed |
|------------|----------|---------------|
| Global search overlay + Lucide chrome | 2.1.5+ | Fought native search; hard to find / invisible on Orion |
| Bottom black Search capsule | 2.1.7 | Covered by Orion floating URL bar; control clashes |
| Masthead top-right forced Lucide float | 2.1.9 | Right→center FOUC / load jump; still hard under browser chrome |
| Home first-video chip | 2.2.0 | Inventive placement; load jumps; feed host races |
| Watch rectangular pill below strip | 2.2.0 | Clashed with transport strip / player chrome |
| “Searching for something?” overlay + recents/autocomplete | 2.1.7–2.2.0 | Extra UI surface; settings/control clashes reported |
| Skeleton shimmer / FOUC placeholders | 2.2.0 | Weird loading; did not fix root placement failures |

**What 2.2.1 kept:**

- Enlarged inline player control tap targets (`clamp(2.9rem …)`)
- Which buttons appear: rewind / play-pause / forward / pip / fullscreen only
- YouTube-like play/pause glyphs
- Ask YouTube / voice / AI CSS hide (small, non-inventive)
- Native-assisted masthead search from 2.1.2 (`MOBILE_SEARCH_OPEN_ATTR` + `#center` phone overlay)

**What 2.2.3 adds (captions only):**

- Restores subtitle activation — dedupe waits for YouTube custom segments before TextTrack mode changes
- Keeps single active TextTrack once captions paint (authored English preferred)
- Disables duplicate English rows so Languages cannot show English+English selected
- Keeps YouTube custom caption DOM; hides native `::cue` only beside custom segments

**Suggestions for any future search attempt:**

1. Must be **minimal** — prefer leaving native YouTube search alone.
2. Test on **Orion iOS** before claiming fixed (desktop WebKit is not enough).
3. Do **not** cover player controls or the transport strip.
4. Prefer masthead / native slot over inventive floats, chips, pills, bottom capsules.
5. **Ask the user** before another search redesign.
6. No skeleton loaders unless the user explicitly asks and accepts load flicker risk.

---

## WebKit / Orion research takeaways (still true)

Sources: [WKUserScript injection times](https://github.com/WebKit/webkit/blob/master/Source/WebKit/UIProcess/API/Cocoa/WKUserScript.h), [WKWebView gotchas (safe-area / fixed)](https://takazudomodular.com/pj/zudo-tauri/docs/mobile/wkwebview-gotchas/), [Orion iOS extensions](https://help.kagi.com/orion/browser-extensions/ios-ipados-extensions.html).

| Finding | Implication for FYP |
|---------|---------------------|
| Bottom `position: fixed` is covered by Orion’s floating URL bar | Do **not** put search at the bottom. |
| Masthead top-right forced float caused FOUC | Do **not** force a Lucide icon into a remounted masthead slot. |
| Inventive Home chip / Watch pill still failed in real Orion use | Prefer native masthead search path (2.1.2). |
| Orion floating chrome is outside the webview | Leave `.ytp-*` chrome free of FYP capture. |

---

## What 2.2.3 does

- Fixes subtitles not turning on (M12 follow-up).
- Keeps 2.2.2 double-caption / English+English dedupe once custom segments exist.
- Leaves 2.2.1 search recovery and enlarged transport strip unchanged.
- Recommended test installer: `2.2.3_release.zip` (Chrome MV3). Copy also at `~/Downloads/2.2.3_release.zip`.

## Verification (Orion iPhone)

1. Uninstall old build → install `2.2.3_release.zip` → hard-refresh YouTube.
2. Search: native masthead search icon works; phone-width overlay; no Home chip / Watch pill / “Searching for something?” overlay / skeleton.
3. Watch: enlarged transport strip only (5 buttons); native settings gear works; no on-video clock/gear overlays.
4. Captions: Languages shows one English selected (not English+English); on-screen captions appear once.
5. Ask YouTube / voice / AI chrome stays hidden.

## Next agent prompt template

After reading this file, summarize open rows (`Not fixed`), propose the smallest patch, then ask:

> Continue the next fix on **this branch** (`fix/search-menus`), a **separate branch**, or **stop**?

**Do not** reopen S1–S5 custom search designs without explicit user approval.
