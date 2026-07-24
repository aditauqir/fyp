# HANDOFF — Fuck YouTube Premium for Orion (iOS)

> For AI agents continuing this work. Read this before editing.
> **Current ship version: `2.0.15`** (2026-07-23)
>
> Stability fix: 2.0.7 restores the external `page.js` injection used by the known-good 2.0.5 build. Do not reintroduce the 2.0.6 document-wide critical CSS or Chrome declarative network rules without testing on Orion iOS. Always run `./rebuild-extension.sh` after edits.
>
> Read `ARCHITECTURE.md` first for the product model, layer boundaries, playback contract, and non-negotiable behavior.

---

## Goal

Orion Browser on **iOS** running **desktop** `www.youtube.com` with a mobile-friendly overlay:

| Want | Behavior |
|------|----------|
| Navigation | **Hamburger / guide drawer only** (single tap). No floating pill. No mini-guide rail (Home/Shorts/Subs/You icons). |
| Shorts | Removed everywhere (guide, shelves, links). `/shorts` redirects to Home. |
| Miniplayer | Dismissed / hidden when leaving a watch page. |
| Playback | Inline only — `playsinline` is applied before native `play()`. Background audio kept via visibility spoof + play recovery. |
| PiP | Disabled so starting playback can never switch the page into PiP. |
| Comments | Under description; show top **3**; **Load more** / floating **Load less**. |
| Upload | Header Create/Upload hidden. |
| Layout | Keep the desktop backend, but remove its phone-width minimums and apply a 12px gutter to watch content. |

Target browser: **Orion iOS** (WebKit + Firefox WebExtensions, install-from-file).

---

## Repo layout

```
/Users/aditauqir/Downloads/userscript/
├── HANDOFF.md
├── ARCHITECTURE.md                     ← product and technical contract
├── PATCH_NOTES.md                      ← release and popup changelog source
├── INSTALL-ORION.md                    ← install troubleshooting for the user
├── rebuild-extension.sh                ← builds Chrome + Firefox zips
├── youtube-mobile-background.user.js   ← SOURCE OF TRUTH
├── firefox-extension/                  ← Firefox MV2 (Orion “Firefox” / file install)
├── chrome-extension/                   ← Chrome MV3 (prefer this on Orion iOS)
├── fuck-youtube-premium-chrome-2.0.15.zip
└── fuck-youtube-premium-firefox-2.0.15.zip
```

**Install tip:** On Orion iOS, try the **Chrome** zip first if Firefox install fails. See `INSTALL-ORION.md`.

**Edit flow (mandatory):**

1. Change `youtube-mobile-background.user.js` (bump `@version`).
2. Run `./rebuild-extension.sh` (regenerates `page.js`, syncs versions, writes Chrome + Firefox zips).
3. Tell the user to reinstall the new zip on Orion (replace old extension) and hard-refresh YouTube.

Do **not** edit `firefox-extension/page.js` or `chrome-extension/page.js` directly — overwritten by rebuild.

---

## Architecture (why page injection)

Orion installs this as a **Firefox MV2** extension.

- `content.js` runs at `document_start` (isolated world).
- It injects `<script src="page.js">` into the **page** world so patches to `fetch` / `XHR` / `HTMLMediaElement.prototype.pause` / `play()` actually affect YouTube’s own JS.
- `page.js` ≈ userscript body with `SCRIPT_ID = 'yt-mobile-orion-ext'`.

Userscript headers remain for optional Violentmonkey use, but the primary deliverables are the Chrome and Firefox zips.

### Install on Orion iOS

1. Settings → enable **Chrome extensions** and **Firefox extensions**.
2. Extensions → **+** → **Install from file** → pick a zip.
3. Open YouTube; allow extension if prompted.
4. Remove any old userscript copy so logic does not double-run.

---

## Important constants / state

In `youtube-mobile-background.user.js`:

- `BACKEND_HOST = 'www.youtube.com'` — forces desktop host + `app=desktop&persist_app=1`.
- `NAV_LAYOUT_VERSION` — bump when CSS/layout injection version must refresh (`style.dataset.layoutVersion`).
- `ORION_NAV_GAP = '72px'` — bottom clearance for Orion’s floating URL bar.
- `PLAYER_CONTROLS_VISIBLE_MS = 4000`.
- Floating pill `#${NAV_ID}` is **intentionally removed** at runtime (`removeFloatingPillNav` / CSS `display:none`).

---

## Latest changes (through 2.0.15)

### 2.0.15 — native comments + four-second player controls
- Removes custom comment limiting and pagination controls while keeping comments below the description.
- Holds YouTube’s player controls visible for exactly four seconds after Play or Play/Pause interaction.
- Returns control visibility to YouTube after the timer; does not change playback behavior.
- Updates the global `fyp-comments-menu` skill with the new native-comments contract.

### 2.0.14 — progressive comments + restored extension popup
- Shows three top-level comments initially and exactly five more per **Show more** tap.
- Removes the in-page Shadow DOM action card and toolbar relay that crashed Orion.
- Restores a real bottom-center extension popup with three release lines and two buttons.
- Makes no changes to playback, navigation, Shorts, miniplayer, ads, or general page layout.
- Future agents must use the global `fyp-comments-menu` skill for these two areas.

### 2.0.13 — Orion toolbar relay + verified page startup
- Restores `default_popup` only as a one-pixel transparent toolbar relay; it messages the active YouTube tab directly and closes.
- Replaces the broken “script element exists” injection check with a versioned page-readiness handshake and nonce-aware retry.
- Runs DOM-level inline video marking, Shorts filtering, and viewport containment even if page-world JavaScript is blocked.
- Makes the in-page card up to 22rem wide with 3.5rem buttons and larger release-note text.
- Manual update checks use background messaging first and direct GitHub access as an Orion fallback.

### 2.0.12 — creation-time inline playback + compact action card
- Marks every video inline at DOM creation time and repeats the attributes before native Play.
- Gates fullscreen entry until YouTube’s real fullscreen control is tapped; removes CSS that hid that control.
- Removes `default_popup`; the extension icon now toggles a compact Shadow DOM card inside YouTube.
- Expands Shorts selectors and blocks `/shorts` link navigation.

### 2.0.11 — popup changelog + architecture handoff
- Added three highest-priority changelog lines above the existing two popup buttons.
- Added `PATCH_NOTES.md` as the release/OTA copy source of truth.
- Added `ARCHITECTURE.md` so future agents can preserve the product boundaries and regression constraints.

### 2.0.10 — mobile shell reset + reliable inline Play
- Keeps desktop YouTube as the data/playback backend and adds a phone breakpoint over its narrow responsive layout.
- Removes desktop YouTube’s 426.7px minimum watch-column width, which clipped roughly 18px from the left on a 390px viewport.
- Uses a small 12px content gutter while leaving the video player full-width.
- Uses one-column rich feeds at phone widths.
- Marks videos `playsinline` immediately before native `play()`; no fullscreen-exit or presentation-mode calls run after the tap.
- Disables PiP and removes the in-page PiP/status control.
- Leaves YouTube’s guide attributes and Polymer state untouched; only the mini-guide element is hidden.
- Popup contains only two compact buttons.

### 2.0.9 — inline-only playback, native drawer, update popup
- Fullscreen is disabled completely; Play stays inline so comments remain readable.
- Removed custom guide close/swipe interception; the native hamburger controls the drawer.
- Permanent mini-guide Home/Shorts/Subscriptions column remains hidden.
- Removed extension viewport width/padding overrides and restored YouTube’s native responsive sizing.
- Added a two-button extension popup and GitHub Release update checks.

### 2.0.8 — inline play + viewport fit
- Revokes fullscreen permission for every player interaction except the actual fullscreen control.
- Guards WebKit presentation-mode fullscreen and enforces `playsinline` as video nodes appear.
- Keeps `html`, `body`, and app roots edge-to-edge; responsive gutters now apply only to content.

### 2.0.3 — single-tap guide + Shorts in drawer
- Removed `touchmove` auto-close of guide (was closing on the same gesture as open → required double-tap).
- Burger tap sets `guideUiState.userOpened = true` for ~8s; mutation observer no longer fights open.
- `hideShortsGuideEntries()` walks guide entries by href/label/text (not only CSS `:has()`).
- Shorts stripped again when drawer opens (0 / 120 / 400 ms).

### 2.0.2 — burger-only, miniplayer, no auto-FS, padding
- Removed floating pill nav; hide mini-guide / pivot rails.
- Dismiss `ytd-miniplayer` when leaving watch.
- Aggressive Shorts shelf/link removal + `/shorts` → Home.
- Earlier `installFullscreenGuard()` patched WebKit fullscreen APIs and exited fullscreen after Play. This was removed in 2.0.10 because it consumed the first user gesture in Orion.
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
| `ensureGuideButtonVisible` / `lockGuideToTapOnly` | Burger visible; mini-guide hidden; native drawer left alone |
| `dismissMiniplayer` | Kill YouTube miniplayer UI/state |
| `removeFloatingPillNav` | Ensure custom pill stays gone |
| `enforceInlinePlayback` / `installInlinePlaybackGuard` | Apply inline playback and disable PiP before native Play without changing WebKit presentation modes |
| `prepareForBackground` | Keep audio alive; **no** PiP |
| `arrangeWatchComments` / `limitVisibleComments` | Comments under description; top 3 + more/less |
| `applySafeBottomSpacing` | Bottom clearance only; no horizontal viewport overrides |
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

## GitHub Release policy (mandatory)

- Never delete an old GitHub Release or its assets.
- Publish the newest version normally as `Fuck YouTube Premium <version>`.
- After the new release is live, rename every older release to `[DEPRECATED] Fuck YouTube Premium <version>`.
- Do not add `[DEPRECATED]` to the current latest release.
- Verify with `gh release list --repo aditauqir/fyp`.

---

## Do / don’t

**Do**

- Prefer small, targeted edits in the userscript; rebuild; ship new zip.
- Keep PiP disabled unless the user explicitly reverses that requirement.
- Leave drawer open/close behavior to YouTube’s native hamburger control.
- Re-test Shorts inside the **open** guide drawer (DOM is lazy).

**Don’t**

- Reintroduce floating bottom pill or mini-guide Home/Shorts/Subs rail unless the user asks.
- Call PiP or WebKit presentation-mode APIs from visibility/`prepareForBackground`.
- Hand-edit `page.js`.
- Rely only on CSS `:has()` for Shorts — always also run `hideShortsGuideEntries`.
- Close the guide from `touchmove` (breaks single-tap).

---

## Known Orion / WebKit quirks

- Floating address bar **overlays** page content → bottom controls need clearance (`ORION_NAV_GAP`).
- Extension APIs are limited on iOS; the background script only checks GitHub Releases and cannot silently reinstall a zip.
- Polymer `tp-yt-app-drawer#guide` uses `opened` / `peeking` / `disable-swipe`.
- Desktop YouTube in a narrow viewport still uses `ytd-*` (not always `ytm-*`).

---

## User preferences (from conversation)

- Primary device: **Orion on iPhone**.
- Wants hamburger navigation, not a custom tab bar.
- Hates Shorts anywhere.
- Hates miniplayer after leaving a video.
- Hates auto-fullscreen and PiP on play; wants inline video and background audio.
- Content was clipping at edges → keep YouTube’s native viewport sizing and avoid root width/padding overrides.
- Deliverables should be zip files suitable for Downloads or AirDrop.

---

## Quick verification checklist

After reinstall + hard refresh on Orion:

1. [ ] Burger opens guide on **one** tap and stays open.
2. [ ] Guide has **no Shorts** row.
3. [ ] No left mini-guide icon rail; no floating pill.
4. [ ] One Play tap starts video inline with no presentation transition; tapping the fullscreen control still enters fullscreen.
5. [ ] Leave video → no miniplayer on Home.
6. [ ] Watch page: YouTube’s complete native comments remain below the description.
7. [ ] Player controls remain visible for four seconds after Play.
8. [ ] Feed/player not clipped at left/right edges.

---

## Next agent: first actions

1. Read this file + skim `youtube-mobile-background.user.js` headers/constants.
2. Confirm latest packaged zip version matches `@version`.
3. Implement the user’s new request in the **userscript**.
4. Run `./rebuild-extension.sh` and give the user the new zip path.
