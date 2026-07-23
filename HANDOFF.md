# HANDOFF — Fuck YouTube Premium for Orion (iOS)

> For AI agents continuing this work. Read this before editing.
> **Current ship version: `2.0.7`** (2026-07-23)
>
> Stability fix: 2.0.7 restores the external `page.js` injection used by the known-good 2.0.5 build. Do not reintroduce the 2.0.6 document-wide critical CSS or Chrome declarative network rules without testing on Orion iOS. Always run `./rebuild-extension.sh` after edits.

---

## Goal

Orion Browser on **iOS** running **desktop** `www.youtube.com` with a mobile-friendly overlay:

| Want | Behavior |
|------|----------|
| Navigation | **Hamburger / guide drawer only** (single tap). No floating pill. No mini-guide rail (Home/Shorts/Subs/You icons). |
| Shorts | Removed everywhere (guide, shelves, links). `/shorts` redirects to Home. |
| Miniplayer | Dismissed / hidden when leaving a watch page. |
| Playback | Inline only — **no auto-fullscreen**. Background audio kept via visibility spoof + play recovery. |
| PiP | **Only** when user taps the status light next to the logo (not automatic). |
| Comments | Under description; show top **3**; **Load more** / floating **Load less**. |
| Upload | Header Create/Upload hidden. |
| Layout | Light **8px** horizontal edge padding so content is not clipped under Orion chrome. |

Target browser: **Orion iOS** (WebKit + Firefox WebExtensions, install-from-file).

---

## Repo layout

```
/Users/aditauqir/Downloads/userscript/
├── HANDOFF.md
├── INSTALL-ORION.md                    ← install troubleshooting for the user
├── rebuild-extension.sh                ← builds Chrome + Firefox zips
├── youtube-mobile-background.user.js   ← SOURCE OF TRUTH
├── firefox-extension/                  ← Firefox MV2 (Orion “Firefox” / file install)
├── chrome-extension/                   ← Chrome MV3 (prefer this on Orion iOS)
├── fuck-youtube-premium-chrome-2.0.7.zip
└── fuck-youtube-premium-firefox-2.0.7.zip
```

**Install tip:** On Orion iOS, try the **Chrome** zip first if Firefox install fails. See `INSTALL-ORION.md`.

**Edit flow (mandatory):**

1. Change `youtube-mobile-background.user.js` (bump `@version`).
2. Run `./rebuild-extension.sh` (regenerates `page.js`, syncs versions, writes chrome+firefox zip/xpi).
3. Tell the user to reinstall the new zip on Orion (replace old extension) and hard-refresh YouTube.

Do **not** edit `firefox-extension/page.js` or `chrome-extension/page.js` directly — overwritten by rebuild.

---

## Architecture (why page injection)

Orion installs this as a **Firefox MV2** extension.

- `content.js` runs at `document_start` (isolated world).
- It injects `<script src="page.js">` into the **page** world so patches to `fetch` / `XHR` / `HTMLMediaElement.prototype.pause` / fullscreen APIs actually affect YouTube’s own JS.
- `page.js` ≈ userscript body with `SCRIPT_ID = 'yt-mobile-orion-ext'`.

Userscript headers remain for optional Violentmonkey use, but **primary deliverable is the Firefox zip/xpi**.

### Install on Orion iOS

1. Settings → enable **Firefox extensions**.
2. Extensions → **+** → **Install from file** → pick zip/xpi.
3. Open YouTube; allow extension if prompted.
4. Remove any old userscript copy so logic does not double-run.

---

## Important constants / state

In `youtube-mobile-background.user.js`:

- `BACKEND_HOST = 'www.youtube.com'` — forces desktop host + `app=desktop&persist_app=1`.
- `NAV_LAYOUT_VERSION` — bump when CSS/layout injection version must refresh (`style.dataset.layoutVersion`).
- `EDGE_PAD = '8px'`, `ORION_NAV_GAP = '72px'` (Orion floating URL bar overlay).
- `guideUiState.userOpened` / `allowOpenUntil` — burger tap intent; **do not** close drawer on `touchmove` (that caused double-tap).
- `state.allowFullscreenUntil` — fullscreen only after user taps the native fullscreen control.
- `COMMENT_PREVIEW_COUNT = 3`, `COMMENT_LOAD_STEP = 10`.
- Floating pill `#${NAV_ID}` is **intentionally removed** at runtime (`removeFloatingPillNav` / CSS `display:none`).

---

## Latest changes (through 2.0.3)

### 2.0.3 — single-tap guide + Shorts in drawer
- Removed `touchmove` auto-close of guide (was closing on the same gesture as open → required double-tap).
- Burger tap sets `guideUiState.userOpened = true` for ~8s; mutation observer no longer fights open.
- `hideShortsGuideEntries()` walks guide entries by href/label/text (not only CSS `:has()`).
- Shorts stripped again when drawer opens (0 / 120 / 400 ms).

### 2.0.2 — burger-only, miniplayer, no auto-FS, padding
- Removed floating pill nav; hide mini-guide / pivot rails.
- Dismiss `ytd-miniplayer` when leaving watch.
- Aggressive Shorts shelf/link removal + `/shorts` → Home.
- `installFullscreenGuard()` + `playsinline` enforcement; exit accidental WebKit fullscreen.
- PiP remains status-dot click only; `prepareForBackground()` does **not** call PiP.
- `EDGE_PAD` horizontal inset.

### 2.0.0–2.0.1 — Firefox extension for Orion
- Packaged as WebExtension; page-world inject.
- Guide swipe disabled; earlier pill positioning above Orion chrome (pill later removed).

### Pre-extension (userscript 1.x)
- Floating pill, comments preview, ad filter, background playback spoof, subscribe styling, etc.

---

## Key functions (agents)

| Function | Role |
|----------|------|
| `hideNativeNavigationAndShorts` | Hide pivot/mini-guide/Shorts shelves |
| `hideShortsGuideEntries` | Strip Shorts rows inside guide drawer |
| `ensureGuideButtonVisible` / `lockGuideToTapOnly` | Burger visible; swipe off; tap-only open |
| `dismissMiniplayer` | Kill YouTube miniplayer UI/state |
| `removeFloatingPillNav` | Ensure custom pill stays gone |
| `enforceInlinePlayback` / `installFullscreenGuard` | Inline play; no auto fullscreen |
| `requestPiP` | Only from status-dot click handler |
| `prepareForBackground` | Keep audio alive; **no** PiP |
| `arrangeWatchComments` / `limitVisibleComments` | Comments under description; top 3 + more/less |
| `applyEdgePadding` | 8px side padding on `ytd-app` |
| `scanPage` | Periodic DOM reconcile entrypoint |

---

## Rebuild commands

```bash
cd /Users/aditauqir/Downloads/userscript
chmod +x rebuild-extension.sh   # once
./rebuild-extension.sh
```

Outputs:

- `fuck-youtube-premium-chrome-<version>.zip`
- `fuck-youtube-premium-firefox-<version>.zip`

Syntax check is included (`node --check` on `page.js` / `content.js`).

---

## Do / don’t

**Do**

- Prefer small, targeted edits in the userscript; rebuild; ship new zip.
- Keep PiP user-gesture-only.
- Keep guide open on single burger tap; only dismiss true swipe peeks / scroll accidents when `userOpened` is false.
- Re-test Shorts inside the **open** guide drawer (DOM is lazy).

**Don’t**

- Reintroduce floating bottom pill or mini-guide Home/Shorts/Subs rail unless the user asks.
- Call `requestPiP` from visibility/`prepareForBackground`.
- Hand-edit `page.js`.
- Rely only on CSS `:has()` for Shorts — always also run `hideShortsGuideEntries`.
- Close the guide from `touchmove` (breaks single-tap).

---

## Known Orion / WebKit quirks

- Floating address bar **overlays** page content → bottom controls need clearance (`ORION_NAV_GAP`).
- Extension APIs are limited on iOS; this add-on is **content-script only** (no background page required).
- Polymer `tp-yt-app-drawer#guide` uses `opened` / `peeking` / `disable-swipe`.
- Desktop YouTube in a narrow viewport still uses `ytd-*` (not always `ytm-*`).

---

## User preferences (from conversation)

- Primary device: **Orion on iPhone**.
- Wants hamburger navigation, not a custom tab bar.
- Hates Shorts anywhere.
- Hates miniplayer after leaving a video.
- Hates auto-fullscreen on play; wants background playback + optional PiP.
- Content was clipping at edges → keep small padding.
- Deliverables should be **zippable for AirDrop** (Firefox zip/xpi).

---

## Quick verification checklist

After reinstall + hard refresh on Orion:

1. [ ] Burger opens guide on **one** tap and stays open.
2. [ ] Guide has **no Shorts** row.
3. [ ] No left mini-guide icon rail; no floating pill.
4. [ ] Play stays inline (not fullscreen); status light → PiP only when tapped.
5. [ ] Leave video → no miniplayer on Home.
6. [ ] Watch page: comments under description, 3 visible, Load more / Load less.
7. [ ] Feed/player not clipped at left/right edges.

---

## Next agent: first actions

1. Read this file + skim `youtube-mobile-background.user.js` headers/constants.
2. Confirm latest packaged zip version matches `@version`.
3. Implement the user’s new request in the **userscript**.
4. Run `./rebuild-extension.sh` and give the user the new zip path.
