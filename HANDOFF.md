# HANDOFF — Fyoutube for Orion (iOS)

> For AI agents continuing this work. Read this before editing.
> **Current public ship version: `3.2.15` SHIPPED** (GitHub Release `v3.2.15`, title `Fyoutube 3.2.15`; branch `main`). Issue work still happens on `bug-fixes-pr`.
>
> **Watch-strip icons:** if the buttons are blank, white squares, stacked play/pause, or hidden under the title, follow **Watch-strip icons** below before editing.
>
> Always run `./rebuild-extension.sh` after edits.
>
> Read `ARCHITECTURE.md` first for the product model, layer boundaries, playback contract, and non-negotiable behavior.
>
> **Active branch convention (`google_cuck` / `.g` tag):** The `.g` suffix stands for **google**. Everything on this branch should carry the `g` tag (e.g. version `3.1.2.g`, release label `3.1.2.g`, packages `fyoutube-*-3.1.2.g.zip`, and `3.1.2.g_release.zip`). All deliverables, assets, and tasks worked on during this session/branch must have the `g` tag.
>
> **Active issue branch:** GitHub issue work happens on **`bug-fixes-pr`**. Read [`BUG-FIXES.md`](./BUG-FIXES.md) **first**, then this file.
>
> **Session-start requirement:** Run `node scripts/check-issue-ledger.cjs`. Report every issue and its live state to the user before other work.
>
> **Active performance branch:** if the user says they switched agents / “read the files” / performance work — read [`PERFORMANCE-FIXES.md`](./PERFORMANCE-FIXES.md) **first**, then this file.
>
> **Search/menu checklist (historical):** [`FIX-BRANCH.md`](./FIX-BRANCH.md) documents the **2.1.5–2.2.0 search failure** as **REVERTED / FAILED — do not revive without user approval**. After finishing an item, ask the user whether to continue on this branch, a separate branch, or stop.

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
| Comments | Description, then playlist when queued, then recommendations, then native comments. |
| Upload | Header Create/Upload hidden. |
| Layout | Keep the desktop backend, but remove its phone-width minimums and apply a 12px gutter to watch content. Search-card CSS must stay under `ytd-search` and must not restyle Home. |

Target browser: **Orion iOS** (WebKit + Firefox WebExtensions, install-from-file).

---

## Report all issues at the start of each session

Use this procedure for every new agent session in this repository:

1. Read `BUG-FIXES.md`.
2. Run `node scripts/check-issue-ledger.cjs`.
3. Report every issue to the user before you edit code.
4. Include the live GitHub state and the branch state for each issue.
5. Update `BUG-FIXES.md` if an issue is missing or a state changed.

If GitHub is unavailable, report the ledger from `BUG-FIXES.md`. Label the report as **cached, not live**. Do not present a cached state as a live state.

The GitHub Actions CI also runs the issue-ledger check. CI fails if the ledger omits an issue or records the wrong GitHub state.

---

## Record every completed task for resume material

After every completed task, append a dated entry to `RESUME-WORK-LOG.md`.

The file is a raw accomplishment ledger. The file is not a formatted resume. Separate major and minor accomplishments. Describe ownership, technical difficulty, product effect, and verification with strong language. Do not invent facts or metrics.

Keep `RESUME-WORK-LOG.md` ignored by Git. If the file is missing, create the file before the final response. Never commit the file.

If the user asks for a resume or resume material, provide the complete `RESUME-WORK-LOG.md` file for use by another agent. Do not rewrite the ledger into a resume unless the user asks.

---

## Repo layout

```
./
├── AGENTS.md                           ← mandatory session-start issue report
├── HANDOFF.md
├── BUG-FIXES.md                        ← GitHub issue ledger (`bug-fixes-pr`)
├── scripts/check-issue-ledger.cjs      ← live issue report and ledger check
├── .github/workflows/ci.yml            ← rebuild, tests, generated-file and issue checks
├── RESUME-WORK-LOG.md                  ← local ignored accomplishment ledger
├── PERFORMANCE-FIXES.md                ← CPU/energy branch handoff (`fix/performance-fixes`)
├── FIX-BRANCH.md                       ← search/menu history (2.2.3 shipped; S1–S5 reverted)
├── ARCHITECTURE.md                     ← product and technical contract
├── PATCH_NOTES.md                      ← release and popup changelog source
├── INSTALL-ORION.md                    ← install troubleshooting for the user
├── rebuild-extension.sh                ← builds Chrome + Firefox zips
├── youtube-mobile-background.user.js   ← SOURCE OF TRUTH
├── firefox-extension/                  ← Firefox MV2 (Orion “Firefox” / file install)
├── chrome-extension/                   ← Chrome MV3 (prefer this on Orion iOS)
└── 3.2.15_release.zip                  ← recommended Orion installer (gitignored artifact)
```

### Internal Chromium diagnostics workbench

For debugging YouTube behavior on Chromium desktop, use [`workbench/youtube-diagnostics`](./workbench/youtube-diagnostics). Load that folder unpacked from `chrome://extensions`; it is a maintainer tool and is not part of the production Fyoutube packages. Reload the YouTube tab after installing it so the page-world console hook starts at `document_start`.

The popup provides **Pause capture**, **Capture DOM + code**, **Download JSONL**, and **Clear logs**. Pause capture before opening DevTools if the page is becoming unstable. DOM + code produces a structured element/event log plus a separate HTML source file. The captured investigation files currently live under [`workbench/logs`](./workbench/logs).

Do not hand-edit or merge this workbench into `youtube-mobile-background.user.js`, `chrome-extension/page.js`, or `firefox-extension/page.js`. It is a separate Chromium-only observability tool.

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
- `PLAYER_CONTROLS_VISIBLE_MS = 8000`.
- Floating pill `#${NAV_ID}` is **intentionally removed** at runtime (`removeFloatingPillNav` / CSS `display:none`).

---

## Watch-strip icons — if they vanish, turn into white boxes, or stack

Read this before touching the custom rewind / play / forward / Picture in Picture / AirPlay / fullscreen row. The local test build that settled this is **3.2.13** (`icon-strip-v3213-restore`). Public ship is 3.2.15. Orion on iPhone is the device that matters. Do not set width, flex, or `--yt-spec-text-primary` on masthead buttons while fixing search. That shrinks header controls and repaints icons. Keep the search overlay `display: none` until it is open so it cannot cover this strip.

The strip is one FYP-owned toolbar. Page world id: `vm-yt-mobile-background-controls-toolbar`. Fallback id: `yt-mobile-orion-ext-controls-toolbar`. Source of truth is `youtube-mobile-background.user.js`. Mirror the same paint and layout in `firefox-extension/content.template.js`. Do not hand-edit generated `page.js` or `content.js`.

### What the user sees, and the one cause to fix

| What they report | Cause | Do this |
|---|---|---|
| SVG nodes are in the DOM, glyphs are blank | YouTube paints `path { fill: var(--yt-spec-text-primary) }`. On the dark `#111` strip that color is nearly black. | Paint the real glyph with inline `fill` or `stroke` `#fff` and `!important` in `paintPlayerControlIcon`. |
| Only the play triangle shows; the other buttons look gone | Those glyphs were still dark, or the buttons were allowed to shrink to zero width (`flex: 1 1 0` and `min-width: 0`). Play was the only icon forced white, so it was the only one you could see. | One row, six buttons, each `flex: 0 0 3.25rem`, `width` / `min-width` / `height: 3.25rem`. Paint every icon, not only play. |
| Every control is a white square | Each icon SVG includes a full-canvas rectangle, `M0 0h…v…H0z` with `fill="none"`. A check that still expected the space in `M0 0` missed it after spaces were removed (`M00…`). Paint then filled that rectangle white and covered the glyph. | Detect the rectangle only after removing spaces and lowercasing: `/^m00h\d+v\d+h0z$/`. Then `shape.remove()`. Do not restyle it. |
| Play and pause are both visible, stacked | Two failures did this. Two `<svg>` nodes plus CSS `display` / `visibility` `!important` beat the `hidden` attribute. Or `setPlaybackGlyph` wrote the new path onto the rectangle (now `fill` was not `none`) and left the old glyph path in place. | One `<svg>`. Delete every viewBox rectangle first. Swap `d` on the single remaining glyph path. Delete any extra `<svg>`. |
| The row is under the title or another page layer | A later sibling paints over a `position: relative` bar, and `z-index` on a static parent does nothing. | `raisePlayerControlsStack`: toolbar `position: relative`, `z-index: 2147483646`, `overflow: visible`. Immediate parent `z-index: 2147483645` and `overflow: visible`. |

### Rules that must stay true

1. Order on one line, `flex-wrap: nowrap`: rewind, play-pause, forward, pip, airplay, fullscreen. Do not put play on a second row.
2. Build icons with `createElementNS` (`SVG_NS`) from a `DOMParser` clone. Do not assign these icons through `innerHTML`. Trusted Types will reject that and can abort the page scan before the video attaches.
3. `setPlaybackGlyph` owns play/pause. It keeps one path and sets `d` to the play triangle or the pause bars. Both shapes are the 16×16 paths already in `PLAYBACK_GLYPH_PATHS`.
4. Call `paintPlayerControlIcon` after the icon is inserted, and again from the sync function, so a later YouTube style cannot fade the glyph.
5. Inline `!important` on the glyph beats YouTube. Do not set `fill` on the `<svg>` element. A `fill` there is inherited and wipes the children. Do not put `fill:` inside the `.fyp-player-control svg { }` rule. Tests reject that. Do not set `fill: none` on the `<svg>` itself.
6. Stroke icons (fullscreen, the AirPlay screen) get `stroke: #fff` and `fill: none` on the shape. Filled icons (rewind, forward, the PiP frame, the AirPlay triangle, play, pause) get `fill: #fff` and `stroke: none`.
7. Buttons stay tappable. Current size is `3.25rem` with a `2rem` icon. Do not go back to a zero basis.
8. When the strip DOM or CSS must replace an already mounted bar, bump `PLAYER_CONTROLS_LAYOUT_VERSION`. `ensurePlayerControlsToolbar` deletes the old toolbar when `dataset.fypControlsLayout` does not match.
9. Bump `@version`, `@release-label`, `data-fyp-page-ready`, and `firefox-extension/content.template.js` `EXPECTED_PAGE_VERSION` together. Update tests that hardcode the version, the layout id, the button size, and the README zip name. Then `./rebuild-extension.sh` and `node --test tests/*.cjs`.
10. Leave search results-URL behavior alone. The overlay submit icon is one filled magnifying-glass path (`M18 10c0-4.41…`) with `fill: #fff` and no `M0 0h24v24H0z` rectangle. Do not set `fill` on the `<svg>` element. The header search control stays a fixed 40px target. A tap opens the overlay visibly first, then focuses the field from the click. Do not call `preventDefault` on `touchstart`; that cancels the click iOS needs to show the keyboard. The dialog moves with `cubic-bezier(0.23, 1, 0.32, 1)`.

### Do not repeat these attempts

- Mounting play and pause as two SVGs and hiding one with the `hidden` attribute.
- A stylesheet that forces every `.fyp-player-control svg` to `display` / `visibility` / `opacity` visible. That paints the spare icon over the neighbors.
- `path[fill='none'] { stroke: none }` applied broadly enough to erase fullscreen and AirPlay strokes.
- `flex: 1 1 0` or `min-width: 0` on `.fyp-player-control`.
- Filling every path white, including the viewBox rectangle.
- A second row for play/pause. The other icons stayed missing, and the user wants one line.

### Code to keep

```javascript
function isViewBoxRect(shape) {
  const d = String(shape.getAttribute('d') || '').replace(/\s+/g, '').toLowerCase();
  return /^m00h\d+v\d+h0z$/.test(d);
}

// Before choosing the play/pause path:
for (const shape of [...svg.querySelectorAll('path')]) {
  if (isViewBoxRect(shape)) shape.remove();
}

// On every real glyph, not on the removed rectangle:
shape.style.setProperty('fill', '#fff', 'important'); // filled icons
shape.style.setProperty('stroke', '#fff', 'important'); // stroked icons
```

---

## Latest changes (through 3.1.5.g)

### 3.1.5.g — branch `bug-fixes-pr` (WebKit playback ownership and diagnostics)
- Prioritized YouTube's real watch video under `#movie_player` / `#player-container` over inline-preview videos, matching Safari's captured `video-stream.html5-main-video` structure and `blob:` media source.
- Reasserted `playsinline`, `webkit-playsinline`, AirPlay, and FYP attachment state on WebKit media lifecycle events, including readiness, fullscreen, presentation-mode, and wireless playback transitions.
- Replaced FYP-owned toolbar/menu icon `innerHTML` construction with DOM-node construction so Trusted Types enforcement cannot abort the scan before video attachment and control placement.
- Extended the diagnostics workbench with media lifecycle records and WebKit/Safari visibility, fullscreen, presentation, AirPlay, audio-session, and Fyoutube marker fields.
- Added a native macOS Safari Web Extension project under `workbench/youtube-diagnostics-safari`, including the browser/chrome API compatibility shim, WebKit diagnostics resources, host-app bundle identifier wiring, and Xcode packaging script.
- Rebuilt packages with the synchronized `3.2.3` test version.

### 3.2.12 — branch `bug-fixes-pr` (search icon paint and keyboard)
- The search glyph is one filled path with no canvas rectangle, painted `#fff` on the dark submit button. The header search control is a fixed 40px target. The overlay is shown before focus, and `touchstart` no longer calls `preventDefault`, so the following click can open the iOS keyboard with the box.

### 3.2.11 — branch `bug-fixes-pr` (search popup ease and filled icon)
- The search overlay fades and slides with `cubic-bezier(0.23, 1, 0.32, 1)`. The submit control uses the filled magnifying-glass path, painted `#fff`, with the full-canvas rectangle removed so it cannot cover the glyph.

### 3.2.10 — branch `bug-fixes-pr` (strip glyphs, not white boxes)
- Removed the full-canvas `M0 0h…v…H0z` rectangle before paint so it cannot become a white square or a second play/pause shape. One row, `3.25rem` buttons, toolbar stacked at `z-index: 2147483646`. The precise agent procedure is **Watch-strip icons** above. 3.2.4 through 3.2.9 were the failed steps that led here: dark glyphs, two stacked SVGs, a second play row, and buttons that could shrink to zero.

### 3.2.4 — branch `bug-fixes-pr` (player-strip icon paint)
- Forced the custom rewind, play, forward, PiP, AirPlay, and fullscreen glyphs to white with inline `!important` paint, and rebuilt each SVG in the page document so WebKit draws the shapes instead of leaving an empty `<svg>` on the dark strip.

### 3.1.4.g — branch `bug-fixes-pr` (separate search overlay)
- Replaced the native masthead takeover with a direct `#fyp-search-overlay` layer owned by Fyoutube. This prevents YouTube's changing searchbox internals from controlling the overlay layout.
- Added a plain DOM search form with synchronous focus, backdrop/Escape dismissal, Enter submission, and a visible Search button.
- Supports YouTube's current `textarea[name="search_query"]` as well as legacy input fields when copying any existing query into the overlay.
- Navigates through `https://www.youtube.com/results?search_query=...` using `URLSearchParams`, preserving YouTube's `+`-separated space encoding.
- Kept Ask YouTube and voice search hidden in both the critical page CSS and runtime control scan.
- SolidJS was evaluated as a possible UI layer. It is not bundled for this single overlay because the Orion page-world build has no package runtime; the implementation stays dependency-free and vanilla.

### 3.1.3.g — branch `google_cuck` (Playables/mini-games removal & Sidebar scroll stabilization)
- **Playables (Mini-Games) Removal from For You / Home Page:**
  - Suppressed all Playables / mini-games shelves (`ytd-rich-shelf-renderer`, `ytd-rich-section-renderer`, `grid-shelf-view-model`) via `:has(a[href*="/playables"])`, `:has([title*="Playables" i])`, `:has([aria-label*="Playables" i])`, and runtime scanning in `hideNativeNavigationAndShorts()`.
  - Collapsed empty section space (`ytd-rich-section-renderer`) to `height: 0 !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important;` so no blank gaps remain on the home feed.
  - Removed individual playable cards, lockups, and game renderers (`yt-playable-game-renderer`, `ytd-game-card-renderer`, `ytd-playable-renderer`, `ytd-playables-shelf-renderer`, `yt-playables-shelf-renderer`, `ytd-rich-item-renderer:has(a[href*="/playables"])`).
  - Filtered top chip cloud chips (`yt-chip-cloud-chip-renderer`) and guide drawer entries (`ytd-guide-entry-renderer`) mentioning Playables or mini-games.
  - Blocked `/playables` link clicks and added automatic redirection to Home (`/`) if landing on `/playables`.
  - Mirrored all rules into `content.template.js`'s parse-time CSS (`DOM_FALLBACK_STYLE_ID`) and click fallbacks.
- **Sidebar (Guide Drawer) Scroll Stabilization:**
  - Fixed premature drawer dismissal when scrolling down the sidebar on iPhone.
  - Disabled Polymer swipe tracking on the drawer via `disableGuideSwipe` (`drawer.setAttribute('disable-swipe', '')` and `drawer.disableSwipe = true`), preventing thumb swipe slop/horizontal arc deviation from being misinterpreted by Polymer as a swipe-to-close gesture.
  - Injected CSS scroll containment (`touch-action: pan-y !important; overscroll-behavior: contain !important; overscroll-behavior-y: contain !important; -webkit-overflow-scrolling: touch !important;`) on `tp-yt-app-drawer#guide`, `#contentContainer`, `ytd-guide-renderer`, `#guide-wrapper`, and `#sections` to eliminate scroll chaining to the window.
  - Isolated window/document scroll handlers while `guideDrawerIsBusy()` is true: prevented `scroll` events from triggering desktop YouTube's `_onScroll` drawer auto-close logic or `enforceHorizontalViewportLock()`.
  - Maintained full support for closing via the hamburger button or tapping outside on the scrim.
- **Rebuilt Packages:** Generated `3.1.3.g_release.zip` and all companion extension archives.

### 3.1.2.g — branch `google_cuck` (Search UI refinement & Force Injection)
- **Synchronous Force Injection:** Embedded the full `page.js` bundle directly into `content.js` (`__fyp_embedded_page_code`) during `rebuild-extension.sh`. At `document_start`, `content.js` synchronously force-injects `page.js` via inline script text without waiting on network fetch or WebKit external script execution.
- **Immediate DOM Fallback Protection:** Injected search overlay and hamburger/back-button suppression styles directly into `content.js` (`DOM_FALLBACK_STYLE_ID`) so styling is applied instantly at parse time.
- **Removed Back Button:** Removed `#fyp-search-back-button` completely from DOM and CSS; active search field occupies full width with clean spacing.
- **Hidden Hamburger Menu & Drawer:** Set `#guide-button`, `ytd-masthead #guide-button`, `button[aria-label='Guide']`, `#start`, and `tp-yt-app-drawer#guide` to `display: none !important` during active search (`MOBILE_SEARCH_OPEN_ATTR='true'` and `data-fyp-search-active='true'`) on both `html` and `body` levels, with inline style enforcement.
- **Responsive Trigger & Touch Activation:** Removed width restrictions on `handleMobileSearchClick` and added a `touchstart` listener so tapping the search button on mobile triggers immediately without being dropped by iOS WebKit gesture cancellation.
- **Restoration on Close:** When search is closed via backdrop or submit, the hamburger button is automatically restored.
- **Rebuilt Packages:** Generated updated `3.1.2.g_release.zip` and browser companion packages.

### 3.1.1.g — branch `google_cuck` (Google search UI overhaul)
- **Branch convention (`.g` tag):** The `.g` suffix stands for **google**. Everything on this branch should carry the `g` tag (version `3.1.1.g`, release label `3.1.1.g`, packages `fyoutube-*-3.1.1.g.zip`, and `3.1.1.g_release.zip`).
- **Search UI Overhaul:**
  - Tapping the search icon smoothly activates the native desktop search input with full screen width on mobile/iOS Orion without layout clipping.
  - **Synchronous iOS keyboard activation:** Changed input focus from deferred `requestAnimationFrame` to synchronous user-gesture execution (`input.removeAttribute('hidden')`, `input.setAttribute('aria-hidden', 'false')`, and `input.focus({ preventScroll: true })`), enabling iOS WebKit to reliably pop the software keyboard immediately.
  - **Back button navigation:** Injected `#fyp-search-back-button` (`[←]`) inside `#center` to cleanly close search, blur the input, dismiss the keyboard, and restore masthead visibility.
  - **Touch backdrop dismissal:** Injected `#fyp-search-backdrop` with subtle blur to dismiss the search overlay when tapping outside, preventing accidental click-through to videos below.
  - **Suggestions dropdown unclipped:** Configured `#center` to `overflow: visible !important` so `.ytSearchboxComponentSuggestionsContainer` / `.sbsb_a` drops down cleanly without getting clipped.
  - **Preserved controls:** Form submit button (`[🔍]`) and clear button (`[✕]`) properly styled and positioned on screen.

### 3.2.15 — public ship (`Fyoutube 3.2.15`)
- GitHub Release tag `v3.2.15`. Title is `Fyoutube 3.2.15`.
- Recommended installer: `3.2.15_release.zip` (Chrome MV3).
- Watch buttons stay on one row when you open another video or refresh.
- Rewind, play, forward, miniplayer, AirPlay, and fullscreen stay visible and tappable.
- Search opens one field with a Search button, and the keyboard comes up with the box.
- Home no longer shows Playables mini-games. Scrolling the sidebar no longer closes it early.

Direct assets:

- `https://github.com/aditauqir/fyp/releases/download/v3.2.15/3.2.15_release.zip`
- `https://github.com/aditauqir/fyp/releases/download/v3.2.15/fyoutube-chrome-3.2.15.zip`
- `https://github.com/aditauqir/fyp/releases/download/v3.2.15/fyoutube-firefox-3.2.15.zip`
- `https://github.com/aditauqir/fyp/releases/download/v3.2.15/fyoutube-orion-3.2.15.zip`
- `https://github.com/aditauqir/fyp/releases/download/v3.2.15/fyoutube-orion-3.2.15.xpi`

Older `v3.1.1` download URLs stay available.

### 3.1.1 — public ship (`Fyoutube 3.1.1`)
- GitHub Release tag `v3.1.1`. Title is `Fyoutube 3.1.1`.
- Recommended installer: `3.1.1_release.zip` (Chrome MV3).
- Refreshing a watch page keeps the rewind / play / forward strip under the video.
- Closing the hamburger menu no longer leaves a grey overlay or frozen scrolling.
- Tapping search on iPhone shows one full-width field and one search button.
- Product name in headings, popup, and the extension listing is **Fyoutube**.
- Zip names are `fyoutube-chrome-`, `fyoutube-firefox-`, and `fyoutube-orion-`.

Direct assets:

- `https://github.com/aditauqir/fyp/releases/download/v3.1.1/3.1.1_release.zip`
- `https://github.com/aditauqir/fyp/releases/download/v3.1.1/fyoutube-chrome-3.1.1.zip`
- `https://github.com/aditauqir/fyp/releases/download/v3.1.1/fyoutube-firefox-3.1.1.zip`
- `https://github.com/aditauqir/fyp/releases/download/v3.1.1/fyoutube-orion-3.1.1.zip`
- `https://github.com/aditauqir/fyp/releases/download/v3.1.1/fyoutube-orion-3.1.1.xpi`

Older `v3.0.4` download URLs stay available.

### 3.0.4 — public ship (`FYouTube Extension 3.0.4`)
- GitHub Release tag `v3.0.4`. Title is `FYouTube Extension 3.0.4`.
- Recommended installer: `3.0.4_release.zip`.
- Built-in YouTube ad blocking. uBlock Origin is not required.
- Search cards match the screenshot stack: channel, thumbnail, snippet, badges, views, title+menu, then chapters.
- Search-card CSS stays under `ytd-search`. Home must keep its existing feed rules.
- Search results show one channel name. Cards do not clip the stacked layout.
- Watch pages with a `list` queue keep YouTube's native playlist panel under the title.
- Do not put the thumbnail first with `order: -1`.
- Named grid areas on `#dismissible`. Hoist `#channel-info` before `ytd-thumbnail`. Flatten `#details` with `display: contents`.

Direct assets:

- `https://github.com/aditauqir/fyp/releases/download/v3.0.4/3.0.4_release.zip`
- `https://github.com/aditauqir/fyp/releases/download/v3.0.4/fuck-youtube-premium-chrome-3.0.4.zip`
- `https://github.com/aditauqir/fyp/releases/download/v3.0.4/fuck-youtube-premium-firefox-3.0.4.zip`
- `https://github.com/aditauqir/fyp/releases/download/v3.0.4/fuck-youtube-premium-orion-3.0.4.zip`
- `https://github.com/aditauqir/fyp/releases/download/v3.0.4/fuck-youtube-premium-orion-3.0.4.xpi`

### 3.0.3 — one channel name, no search-card clipping
- Hide `ytd-video-meta-block #byline-container` so desktop search does not paint the channel name twice.
- Keep one channel row in `#channel-info` (avatar plus name).
- Lift YouTube's side-by-side height cap on `#dismissible` / `#details` / `#meta` (`max-height: none`, `overflow: visible`).
- Clamp only `#video-title`. Do not put `-webkit-box` on `h3` or `#title-wrapper`.

### 3.0.2 — search cards stay off Home
- Search result thumbnails stack full-width first (`order: -1` on a column `#dismissible`).
- Search-card selectors start with `ytd-search`. Do not use unscoped `html[data-fyp-simple-search]` rules on `#details`, `#video-title`, or avatars.
- Set `data-fyp-simple-search` only when the path starts with `/results`. A leftover `ytd-search` node on Home must not enable search layout.
- Leave Home, subscriptions, and channel browse on their existing rules.

### 3.0.0 — built-in ads + home-style search + watch playlist
- Blocks YouTube ads in the page runtime. uBlock Origin is no longer required.
- Search videos use the Home full-width thumbnail card. Order is title, channel icon/name, then description.
- Watch pages with a `list` queue keep YouTube's native playlist panel under the title. Do not move `#secondary` as related videos.
- Credits Universal Ad Blocker Pro by Gorstak (Goran Štambuk), MIT, for the YouTube-only ad approach.

### 2.2.4 — YouTube CPU / energy tamer (Orion iPhone)
- Ports CY Fung’s AnimationFrame timer tamer into page-world `window` timers so YouTube’s busy `setTimeout`/`setInterval` work coalesces with rAF.
- Keeps FYP recovery / controls / scan timers on pristine bindings so background audio is not stalled when WebKit pauses rAF in hidden documents.
- Soft-skips when WebGL/GPU probe fails; do not double-install the GreasyFork userscript.

### 2.2.3 — caption activation fix
- Defers single-track TextTrack dedupe until YouTube custom caption segments are visible, so captions can turn on again after 2.2.2 blocked activation.
- Keeps duplicate English collapsed and WebKit `::cue` hidden only while custom segments exist.
- Does not change search or transport-button layout from 2.2.1.

### 2.2.2 — single caption track
- Restores exactly one active TextTrack when captions are on (authored English preferred).
- Disables duplicate English rows so Orion Languages cannot show English+English.
- Hides WebKit `::cue` only while YouTube custom caption segments exist.
- Does not change search or transport-button layout from 2.2.1.

### 2.2.1 — search recovery
- Reverts broken 2.1.5–2.2.0 custom search (Home chip, Watch pill, capsule, masthead float, overlay, skeleton).
- Restores 2.1.2-style native masthead mobile search; Ask/voice/AI stay CSS-hidden.
- Keeps enlarged centered transport strip (rewind / play-pause / forward / pip / fullscreen).
- See `FIX-BRANCH.md` failure log: **REVERTED / FAILED — do not revive without user approval**.

### 2.0.16 — recommendations first + reply/caption/control polish
- Places YouTube recommendations before native comments and removes forced comment expansion.
- Sets comment/reply editors to 16px so iOS does not zoom on focus.
- Holds controls for eight seconds from user interaction only; `play`/`playing` events do not refresh the timer.
- Hides WebKit’s native `video::cue` only while YouTube’s custom caption segments exist.
- Updates the global `fyp-comments-menu` skill with these contracts.

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
| `findWatchPlaylistHost` / `arrangeWatchComments` | Native playlist under title; recommendations next; comments last |
| `enforceSimpleSearchLayout` | Search-only card stack and AI-summary hide; path must be `/results` |
| `applySafeBottomSpacing` | Bottom clearance only; no horizontal viewport overrides |
| `installPlayerResponseAdFilter` / `skipPlayerAd` / `removeAdCards` | Built-in YouTube ad blocking |
| `scanPage` | Periodic DOM reconcile entrypoint |

---

## Rebuild commands

```bash
cd /Users/aditauqir/Downloads/userscript
chmod +x rebuild-extension.sh   # once
./rebuild-extension.sh
```

Outputs:

- `fyoutube-chrome-<version>.zip`
- `fyoutube-firefox-<version>.zip`

Syntax check is included (`node --check` on `page.js` / `content.js`).

---

## GitHub Release policy (mandatory)

- Never delete an old GitHub Release or its assets.
- Publish the newest version as `Fyoutube <version>`.
- Use tag `v<version>`.
- Append `hotfix` when the ship is a hotfix, for example `Fyoutube 2.1.1 hotfix`.
- After the new release is live, prefix every older release title with `[DEPRECATED] `. Keep the older title text.
- Do not add `[DEPRECATED]` to the current latest release.
- Verify with `gh release list --repo aditauqir/fyp`.

---

## Do / don’t

**Do**

- Prefer small, targeted edits in the userscript; rebuild; ship new zip.
- Keep PiP disabled unless the user explicitly reverses that requirement.
- Leave drawer open/close behavior to YouTube’s native hamburger control.
- Prefix search-card CSS with `ytd-search`. Keep Home on its existing rules.

**Don’t**

- Reintroduce floating bottom pill or mini-guide Home/Shorts/Subs rail unless the user asks.
- Call PiP or WebKit presentation-mode APIs from visibility/`prepareForBackground`.
- Hand-edit `page.js`.
- Rely only on CSS `:has()` for Shorts — always also run `hideShortsGuideEntries`.
- Close the guide from `touchmove` (breaks single-tap).
- Apply search-card CSS to Home. Do not use unscoped `html[data-fyp-simple-search]` rules on `#details`, `#video-title`, or avatars.

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
6. [ ] Watch page: recommendations appear before native comments.
7. [ ] Replying to a comment does not zoom the page.
8. [ ] Player controls hide eight seconds after the last player interaction.
9. [ ] Captions appear once, using YouTube’s caption layer.
10. [ ] Feed/player not clipped at left/right edges.
11. [ ] Search videos match the screenshot stack: channel, thumbnail, snippet, badges, views, title. Home feed layout is unchanged.
12. [ ] YouTube ads do not play; skip overlays disappear.

---

## Next agent: first actions

1. Read [`BUG-FIXES.md`](./BUG-FIXES.md) first and stay on **`bug-fixes-pr`** for GitHub issue work.
2. Run `node scripts/check-issue-ledger.cjs`.
3. Report every issue, live GitHub state, and branch state to the user.
4. Confirm the latest shipped GitHub Release title is `Fyoutube 3.2.15`, tag `v3.2.15`.
5. Pick the next open issue that does not have a verified fix. Do not continue `FIX-BRANCH.md` search experiments unless asked.
6. Implement in the **userscript**, mirror fallback if needed, and update the `BUG-FIXES.md` ledger.
7. Run `./rebuild-extension.sh` and all tests; give the user the new zip path.
8. Ask whether to continue on **`bug-fixes-pr`**, **ship**, or **stop**.
