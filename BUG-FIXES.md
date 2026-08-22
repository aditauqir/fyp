# BUG-FIXES — `bug-fixes-pr`

> **Okay — GitHub issue work lives on this branch.**
> Read this file **first**, then `HANDOFF.md`, `ARCHITECTURE.md`, and skim `youtube-mobile-background.user.js` before editing.
>
> **Target device:** Orion Browser on **iPhone** (WebKit + install-from-file WebExtension). Desktop Chrome is not the acceptance surface.
>
> Source of truth remains `youtube-mobile-background.user.js` → `./rebuild-extension.sh`. Do **not** hand-edit generated `page.js`.
>
> Shipped public version stays **`3.0.4`** until the user asks to ship. This branch currently builds **`3.1.0`**.

---

## Agent contract (read before any work)

1. You are on branch **`bug-fixes-pr`**, based on latest `origin/main` (shipped **3.0.4** at branch creation).
2. This branch’s job is **GitHub issues** for Fuck YouTube Premium / FYouTube Extension — not performance taming, not reviving 2.1.5–2.2.0 custom search, not popup changelog edits.
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

## Ledger

| ID | Source | Status | Summary |
|----|--------|--------|---------|
| #1 | [Opening the sidebar and closing it again breaks scrolling](https://github.com/aditauqir/fyp/issues/1) | **Fixed in 3.1.0 (unreleased)** | Hamburger close left a grey overlay and froze scroll. |
| #2 | [Refreshing a video hides the FYP transport strip](https://github.com/aditauqir/fyp/issues/2) | **Fixed in 3.1.0 (unreleased)** | Reload parked the strip under a collapsed player shell. |
| search-bar | Chat report (iPhone 16, latest iOS) | **Fixed in 3.1.0 (unreleased)** | Tapping search showed two buttons and a tiny field on the left. |

---

## Issue #1 — sidebar close greys the page

**What it is:** Open the hamburger guide, close it, and the whole screen turns grey. Scrolling stops. Reported on Orion 1.5.1 / FYP 2.2.14 / iOS 26.6.

**Probable cause:** Two leftovers after close. YouTube’s drawer `#scrim` can stay painted because we hide the mini-guide rail Polymer expects to return to. The page also keeps `overflow: hidden` from the overlay lock. A secondary fight: ad-enforcement cleanup used to delete every `tp-yt-iron-overlay-backdrop.opened`, which can include the drawer scrim companion.

**What we changed:** Hide leftover `#scrim` with CSS only when the drawer is not `opened` / `opening` / `peeking`. Restore html/body/`ytd-app` overflow after close. Remove only orphan ad backdrops, never drawer-owned ones. Do not set or clear drawer Polymer attributes.

**How to verify:** 1) Reinstall `3.1.0_release.zip` and hard-refresh. 2) Open the hamburger. 3) Close it. 4) Confirm the page is not grey and Home/watch still scrolls. 5) Confirm ads are still dismissed if YouTube shows an ad-blocker dialog.

---

## Issue #2 — refresh loses the transport strip

**What it is:** Refreshing a `/watch` page hides the FYP rewind / play / forward strip. Navigating away and back through YouTube’s SPA brings it back. Reported on Orion iOS / FYP 2.2.14.

**Probable cause:** On a full reload the player shell exists before the title/metadata. The strip was parked after `#player` / `#player-full-bleed-container`. Full-bleed CSS then collapses `#columns #player` with `overflow: hidden`. Title-mount checks only looked at the leftover Polymer title’s own `display`, so a hidden title counted as a valid mount forever.

**What we changed:** Require a visible title/metadata mount (`isUsableWatchMount`). Never insert the strip after the player. If the strip is already parked on the collapsed player and title is not ready, remove it and wait. Layout version `icon-strip-v310-title-mount`.

**How to verify:** 1) Reinstall `3.1.0_release.zip` and hard-refresh. 2) Open a watch page. 3) Confirm the strip sits under the title. 4) Refresh the watch page. 5) Confirm the strip returns under the title, not inside/under the player.

---

## Search bar — two buttons and a tiny field (iPhone 16)

**What it is:** Tap the top search control. Two search buttons appear. The search field shrinks to a small block on the left.

**Probable cause:** The overlay used `width: auto` on a `position: fixed` `#center`. WebKit shrink-to-fit then sizes the overlay to the collapsed desktop search icon. The header search icon in `#end` stays visible, so it sits next to the form submit button.

**What we changed:** Pin the overlay to `calc(100vw - 24px)`. Stretch `yt-searchbox` / `ytd-searchbox` internals so the input can grow. Hide the header search icon while the overlay is open. Keep one native input and the form submit control.

**How to verify:** 1) Reinstall `3.1.0_release.zip` and hard-refresh. 2) Tap search in the top bar. 3) Confirm one full-width field. 4) Confirm one search submit control, not two icons. 5) Type and submit a search.

---

## After each issue

1. Implement in `youtube-mobile-background.user.js`. Mirror fallback in `firefox-extension/content.template.js` when the isolated-world path can hit the same bug.
2. Run `./rebuild-extension.sh` and `node --test tests/*.cjs`.
3. Update this ledger and append `fixes.md`.
4. Ask whether to continue on **`bug-fixes-pr`**, **ship 3.1.0**, or **stop**.
