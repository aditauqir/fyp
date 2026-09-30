# BUG-FIXES — `bug-fixes-pr`

> **Okay — GitHub issue work lives on this branch.**
> Read this file **first**, then `HANDOFF.md`, `ARCHITECTURE.md`, and skim `youtube-mobile-background.user.js` before editing.
>
> **Target device:** Orion Browser on **iPhone** (WebKit + install-from-file WebExtension). Desktop Chrome is not the acceptance surface.
>
> Source of truth remains `youtube-mobile-background.user.js` → `./rebuild-extension.sh`. Do **not** hand-edit generated `page.js`.
>
> Shipped public version is **`3.1.1`**. GitHub Release title is `Fyoutube 3.1.1`, tag `v3.1.1`.

---

## Agent contract (read before any work)

1. You are on branch **`bug-fixes-pr`**, based on latest `origin/main` (shipped **3.0.4** at branch creation).
2. This branch’s job is **GitHub issues** for Fyoutube / FYouTube Extension — not performance taming, not reviving 2.1.5–2.2.0 custom search, not popup changelog edits.
3. After finishing a change: rebuild, update the ledger below, and **ask the user** whether to continue on this branch, ship, or stop.
4. Do **not** revive `FIX-BRANCH.md` search experiments (S1–S5) without explicit user approval.
5. Do **not** fight native Play, drawer Polymer `opened` / `peeking` / swipe, or the 10000 ms player-control hold.

### Phrases that mean “read the handoffs first”

If the user (or another agent summary) says any of:

- “okay I switched / read the files”
- “work the GitHub issues”
- “continue bug fixes”
- a `https://github.com/aditauqir/fyp/issues/<n>` link

…then read, in order:

1. **`BUG-FIXES.md`** (this file)
2. **`HANDOFF.md`**
3. **`ARCHITECTURE.md`**
4. Relevant slices of **`youtube-mobile-background.user.js`**
5. The GitHub issue body (`gh issue view <n> --repo aditauqir/fyp`)

---

## Goal

Take open GitHub issues from [aditauqir/fyp](https://github.com/aditauqir/fyp/issues), fix them on **`bug-fixes-pr`**, and keep this file as the status ledger that reports to `HANDOFF.md`.

---

## Start each agent session with a live issue report

Before other work, run:

```bash
node scripts/check-issue-ledger.cjs
```

The command reads every GitHub issue, compares its live state with this ledger, and prints a status table.

The agent must send that table to the user before the agent edits code. The report must include each issue, its live GitHub state, and its branch state.

If the command reports a mismatch, update this ledger in the same change. If GitHub is unavailable, use this ledger and label every state as **cached, not live**.

---

## Ledger

Last live check: **2026-08-23**.

| Issue | GitHub title | GitHub state | Branch state | Summary |
|---|---|---|---|---|
| [#1](https://github.com/aditauqir/fyp/issues/1) | Opening the sidebar and closing it again breaks scrolling | **CLOSED** | **Shipped in 3.1.1 (`316702e`)** | Hamburger close left a grey overlay and froze scroll. |
| [#2](https://github.com/aditauqir/fyp/issues/2) | Refreshing video loses media controls | **CLOSED** | **Shipped in 3.1.1 (`9253cb2` remount on reload)** | Reload removed the strip when title/metadata failed the visibility check. |
| [#3](https://github.com/aditauqir/fyp/issues/3) | Searchbar/Search button is kinda messed up | **CLOSED** | **Shipped in 3.1.1 (`316702e`)** | Tapping search showed two buttons and a tiny field on the left. |

`OPEN` and `CLOSED` in the GitHub state column are live issue states. The branch state records implementation and verification separately.

---

## Issue #1 — sidebar close greys the page

**What it is:** Open the hamburger guide, close it, and the whole screen turns grey. Scrolling stops. Reported on Orion 1.5.1 / FYP 2.2.14 / iOS 26.6.

**Probable cause:** Two leftovers after close. YouTube’s drawer `#scrim` can stay painted because we hide the mini-guide rail Polymer expects to return to. The page also keeps `overflow: hidden` from the overlay lock. A secondary fight: ad-enforcement cleanup used to delete every `tp-yt-iron-overlay-backdrop.opened`, which can include the drawer scrim companion.

**What we changed:** Hide leftover `#scrim` with CSS only when the drawer is not `opened` / `opening` / `peeking`. Restore html/body/`ytd-app` overflow after close. Remove only orphan ad backdrops, never drawer-owned ones. Do not set or clear drawer Polymer attributes.

**How to verify:** 1) Reinstall `3.1.1_release.zip` and hard-refresh. 2) Open the hamburger. 3) Close it. 4) Confirm the page is not grey and Home/watch still scrolls. 5) Confirm ads are still dismissed if YouTube shows an ad-blocker dialog.

---

## Issue #2 — refresh loses the transport strip

**What it is:** Refreshing a `/watch` page hides the FYP rewind / play / forward strip. Navigating away and back through YouTube’s SPA brings it back. Reported on Orion iOS / FYP 2.2.14.

**Probable cause:** On a full reload the player shell exists before the title/metadata. The strip was parked after `#player` / `#player-full-bleed-container`. Full-bleed CSS then collapses `#columns #player` with `overflow: hidden`. Title-mount checks only looked at the leftover Polymer title’s own `display`, so a hidden title counted as a valid mount forever.

**What we changed:** 3.1.0 was not enough on device. `isUsableWatchMount` no longer fails on iOS `checkVisibility()` or ancestor `visibility:hidden`, and 3.2.1 source changes now require the visible `ytd-watch-flexy`/`#movie_player` tree before resolving the toolbar or video. Once watch chrome exists, the strip is always remounted: visible title, then metadata, then `#below` / `#primary-inner`, then after the visible player host. Never remove the strip without putting it back. Burst retries on boot, `yt-navigate-finish`, `pageshow`, and `popstate`. Layout version `icon-strip-v320-visible-watch`.

**How to verify:** 1) Reinstall `3.1.1_release.zip` and hard-refresh. 2) Open a watch page. 3) Confirm the strip sits under the video. 4) Refresh the watch page. 5) Confirm the strip is still under the video, not missing and not inside the collapsed player.

---

## Issue #3 — two search buttons and a tiny field (iPhone 16)

**What it is:** Tap the top search control. Two search buttons appear. The search field shrinks to a small block on the left.

**Probable cause:** The overlay used `width: auto` on a `position: fixed` `#center`. WebKit shrink-to-fit then sizes the overlay to the collapsed desktop search icon. The header search icon in `#end` stays visible, so it sits next to the form submit button.

**What we changed:** The 3.1.1 fix shipped one native input, but the current YouTube DOM can render the field as a `textarea` and its controls can be rebuilt underneath the extension. Follow-up `3.1.4.g` makes the masthead only a trigger, creates a separate FYP-owned `#fyp-search-overlay`, hides Ask YouTube/voice controls, supports both input and textarea detection, and navigates with `URLSearchParams` to the canonical `/results?search_query=...` URL. The 3.2.1 source fix marks every FYP inline-hidden header node and restores those styles when the overlay closes; the submit control now uses an icon-only magnifying-glass button.

**How to verify:** 1) Reinstall `3.1.5.g_release.zip` and hard-refresh. 2) Tap the YouTube search control. 3) Confirm a separate centered field appears over a slightly blurred page, with Ask YouTube and voice search absent. 4) Enter `blue balls` and press Enter or Search. 5) Confirm the URL is `https://www.youtube.com/results?search_query=blue+balls`.

---

## Issue #4 — WebKit watch video is present but Fyoutube cannot prove or retain ownership

**What it is:** Safari/WebKit captures show YouTube's real watch video as `video.video-stream.html5-main-video` under `#movie_player`, with a `blob:https://www.youtube.com/...` source and a `paused-mode` player class. The older Chromium capture did not contain Fyoutube markers, so it could not distinguish an extension failure from an uninstalled extension.

**What we changed:** 3.1.5.g prioritizes the main `#movie_player`/`#player-container` video over inline-preview videos, reapplies Orion inline flags on WebKit media lifecycle events, and marks the attached video for diagnostics. The diagnostics workbench now records media events plus WebKit visibility, fullscreen, presentation-mode, AirPlay, audio-session, and Fyoutube attachment state. FYP-owned controls also avoid Trusted Types-sensitive `innerHTML` writes. A native macOS Safari Web Extension project now packages the same diagnostics payload with a `globalThis.browser || globalThis.chrome` compatibility shim and a reproducible unsigned Xcode build/archive path.

**Current source-only follow-up:** The Safari/WebKit DOM capture shows Shorts being injected during `yt-navigate-finish` and later mutation batches as a `ytd-guide-entry-renderer` labeled `Shorts`; it also shows a `ytd-rich-shelf-renderer` containing YouTube Playables and `/playables` links. The 3.2.1 source follow-up adds a dedicated MutationObserver and navigation cleanup for those semantic components, hides their nearest guide/card/shelf container, and blocks click, pointerdown, and touchstart activation. The generated packages are now rebuilt as a local `3.2.3` test build.

**How to verify:** 1) Install `3.2.3_release.zip` in Orion and reload a watch page. 2) Confirm video playback and the FYP player strip. 3) Capture a DOM snapshot with the diagnostics helper. 4) Confirm `data-fyp-page-ready`, `data-fyp-video-attached`, and `data-fyp-inline-playback` are present. 5) If playback fails, attach the JSONL and HTML capture and inspect `media-event` records for `error`, `waiting`, `stalled`, `canplay`, and `playing`.

---

## After each issue

1. Implement in `youtube-mobile-background.user.js`. Mirror fallback in `firefox-extension/content.template.js` when the isolated-world path can hit the same bug.
2. Run `./rebuild-extension.sh` and `node --test tests/*.cjs`.
3. Update this ledger and append `fixes.md`.
4. Ask whether to continue on **`bug-fixes-pr`** or **stop**.
