# Architecture — Fuck YouTube Premium

This document is the technical contract for agents continuing the project.

**Current shipped version:** `2.0.11`  
**Repository:** `https://github.com/aditauqir/fyp.git`  
**Primary target:** Orion Browser on iPhone, using an install-from-file WebExtension

## Product model

The extension is intentionally a hybrid:

- **Backend:** the real desktop `www.youtube.com` application, data model, account session, navigation, and video player.
- **Frontend shell:** a narrow-screen interface applied by the extension so desktop YouTube is usable like mobile YouTube on an iPhone.
- **Playback layer:** small page-context patches that keep video inline and allow background audio.
- **Ad blocking:** uBlock Origin runs alongside this extension. Do not try to replace uBlock Origin with a new network-blocking system.

This is not a replacement YouTube client, proxy, scraper, or embedded player. No separate application backend is hosted by this project.

```mermaid
flowchart TD
    U["User in Orion iOS"] --> O["www.youtube.com desktop mode"]
    E["Fuck YouTube Premium WebExtension"] --> C["content.js at document_start"]
    C --> P["page.js in YouTube page context"]
    P --> B["Desktop YouTube behavior and account session"]
    P --> M["Mobile layout shell"]
    P --> V["Inline and background playback layer"]
    W["background.js"] --> G["GitHub Releases update check"]
    X["Two-button popup"] --> O
    X --> W
    A["uBlock Origin"] --> O
```

## Non-negotiable behavior

| Area | Required behavior |
|---|---|
| Host | Use `www.youtube.com` with `app=desktop&persist_app=1`. |
| Player | Full-width, inline video above metadata and comments. |
| Play | The first user tap must call the native `play()` path and start playback. |
| Fullscreen | Starting playback must not trigger or force fullscreen. |
| PiP | Disabled. Starting playback must not enter PiP. |
| Background audio | Continue playing when Orion is backgrounded or the phone is locked when WebKit permits it. |
| Layout | No content clipped beyond the left or right viewport edge. |
| Feed | One-column phone layout at narrow widths. |
| Navigation | Only YouTube’s native hamburger drawer. No permanent mini-guide column and no custom bottom navigation. |
| Drawer state | Leave YouTube’s drawer attributes and Polymer properties alone. |
| Shorts | Hide Shorts links, shelves, and drawer entries; redirect `/shorts` to Home. |
| Miniplayer | Hide and dismiss YouTube’s miniplayer. |
| Comments | Place comments below the description; initially show three with Load more/Load less controls. |
| Popup | Three priority changelog lines plus only **Go to YouTube** and **Check for updates** as buttons. |
| Ads | Expect uBlock Origin to handle network ad blocking. |

## Runtime layers

### 1. Extension manifests

Two packages are produced because Orion’s support can vary:

- `chrome-extension/manifest.json`: Manifest V3; preferred Orion install.
- `firefox-extension/manifest.json`: Manifest V2; fallback Orion install.

Both packages run `content.js` at `document_start`, expose `page.js`, provide the two-button popup, and run the update checker.

### 2. Isolated-world bridge

`content.js` runs in the extension’s isolated world. It injects the packaged `page.js` file into the document so playback and page API patches affect YouTube’s own JavaScript environment.

Keep this file small and stable. Orion iOS previously failed when the project moved too much logic into the isolated content script.

### 3. Page-context runtime

`youtube-mobile-background.user.js` is the source of truth. During a build, its userscript header is removed and its body becomes each package’s generated `page.js`.

The page runtime owns:

- desktop-host enforcement;
- inline and background playback behavior;
- mobile breakpoint CSS;
- Shorts, miniplayer, upload, and navigation cleanup;
- comments layout and controls;
- repeated DOM reconciliation after YouTube SPA navigation.

Never edit `chrome-extension/page.js` or `firefox-extension/page.js` directly. They are generated files.

### 4. Popup and update service

`popup.html`, `popup.css`, and `popup.js` show three short release-note lines and implement exactly two actions:

1. Open desktop YouTube.
2. Ask `background.js` to check the latest GitHub Release.

`background.js` checks the GitHub Releases API every six hours and on demand. It selects the Chrome or Firefox asset based on the installed manifest and shows an `UP` badge when a newer version exists.

This is an update notification and download flow, not silent OTA installation. Orion requires the downloaded ZIP to be installed manually.

## Playback architecture

Playback code must be conservative because the user gesture is valuable on iOS.

### Inline start

Immediately before delegating to the native `HTMLMediaElement.prototype.play()`:

1. Add `playsinline`.
2. Add `webkit-playsinline`.
3. Set `video.playsInline = true`.
4. Set `video.disablePictureInPicture = true`.
5. Call the untouched native `play()` method and return its result.

`installInlinePlaybackGuard()` performs this work. It must not swallow the Play promise or manufacture a replacement result.

### Prohibited playback techniques

Do not:

- call `webkitSetPresentationMode()` during Play;
- call `webkitEnterFullscreen()` or `webkitExitFullscreen()`;
- patch `requestFullscreen()` or WebKit fullscreen methods;
- remove YouTube fullscreen classes after Play;
- intercept the user’s Play click and attempt a second synthetic click;
- request PiP from a visibility, blur, freeze, or background event.

Versions 2.0.8–2.0.9 used aggressive fullscreen guards. Those transitions consumed or disrupted Orion’s first user gesture and caused Play to fail or switch presentation modes.

### Background audio

The page reports visible state to YouTube while retaining native visibility descriptors internally. When native WebKit reports that the page is hidden, the extension:

- remembers whether playback was active;
- blocks YouTube pauses only for the active video under the guarded conditions;
- retries native `play()` after short delays;
- installs Media Session play and pause handlers;
- uses the optional WebKit Audio Session playback type when available.

A visible-page pause is treated as user intent and must remain paused.

## Mobile shell architecture

The desktop site is already responsive, but its narrow watch layout has desktop minimum widths. At a 390px viewport, YouTube applied a roughly 426.7px minimum to `#primary`, centering the column and clipping about 18px from the left.

At `max-width: 700px`, the extension:

- constrains app and watch roots to the viewport;
- removes the watch primary column’s desktop minimum width;
- gives watch content a 12px left and right gutter;
- leaves the video player full-bleed;
- constrains metadata, panels, actions, and comments to 100%;
- changes rich feeds to one item per row;
- clips accidental horizontal overflow at the document boundary.

Do not apply transforms, negative margins, fixed pixel widths, or document-wide scale/zoom to imitate a phone layout.

## Navigation architecture

YouTube’s native guide button and drawer own all open/close behavior.

The extension may:

- keep the hamburger button visible;
- hide `ytd-mini-guide-renderer`;
- set mini-guide width CSS variables to zero;
- hide Shorts entries inside the drawer.

The extension must not:

- remove `guide-persistent` or `mini-guide-visible` attributes;
- set `guidePersistent`, `miniGuideVisible`, or drawer `opened` properties;
- remove swipe-control attributes;
- close the drawer from touch or scroll events;
- add a replacement sidebar or bottom navigation bar.

## DOM reconciliation

YouTube is a single-page application and replaces components after navigation. The runtime therefore combines:

- `yt-navigate-finish`, `popstate`, visibility, and lifecycle listeners;
- one document mutation observer with queued scanning;
- targeted intervals for fast-moving ad controls and slower UI reconciliation.

Reconciliation functions should be idempotent: running them repeatedly must not duplicate controls, reorder the page endlessly, or change native component state.

Prefer hiding or styling a native element over reparenting it. Only move DOM nodes when the product behavior explicitly requires a different order, such as comments below the description.

## Source and build flow

```text
youtube-mobile-background.user.js
             |
             v
    rebuild-extension.sh
       |             |
       v             v
Chrome MV3 ZIP   Firefox MV2 ZIP
```

Required edit flow:

1. Edit `youtube-mobile-background.user.js`.
2. Bump its `@version`.
3. Edit shared popup/background source under `firefox-extension/` when needed.
4. Run `./rebuild-extension.sh`.
5. The script regenerates both `page.js` files, copies shared popup/background files to Chrome, updates both manifests, syntax-checks JavaScript, and creates both ZIPs.
6. Run the tests under `tests/`.

Current package names:

- `fuck-youtube-premium-chrome-2.0.11.zip`
- `fuck-youtube-premium-firefox-2.0.11.zip`

## Verification contract

Before publishing:

```bash
./rebuild-extension.sh
node tests/background-update.test.cjs
node tests/inline-playback-layout.test.cjs
git diff --check
```

Then test at an iPhone-sized viewport and, when possible, on Orion iOS:

1. One Play tap starts video inline.
2. No fullscreen or PiP transition occurs.
3. Video keeps playing while the user scrolls through metadata and comments.
4. Background audio resumes when the page is hidden.
5. Left and right edges remain inside the viewport.
6. Player remains full-width.
7. Home and recommendation feeds are one column.
8. Hamburger opens the native drawer once.
9. No mini-guide column or Shorts entry appears.
10. Popup shows three priority changelog lines and only the two required buttons.

Browser-based desktop testing cannot prove Orion’s app-level `WKWebView` configuration. Treat an actual Orion iPhone test as the final authority for playback presentation behavior.

## Release architecture

Releases are published to `aditauqir/fyp`.

Rules:

- Never delete an older release or its assets.
- The newest release title is `Fuck YouTube Premium <version>`.
- After publishing a new version, rename each older release title to `[DEPRECATED] Fuck YouTube Premium <version>`.
- Upload both Chrome and Firefox ZIP assets.
- Keep the ZIP files in the repository’s Downloads workspace as local deliverables.
- Verify the release and direct asset URLs after upload.

## File ownership

| File | Purpose |
|---|---|
| `ARCHITECTURE.md` | Product and technical architecture contract. |
| `HANDOFF.md` | Current state, history, agent checklist, and known regressions. |
| `PATCH_NOTES.md` | Canonical versioned changelog and source for release/popup copy. |
| `README.md` | User-facing overview and installation instructions. |
| `INSTALL-ORION.md` | Detailed Orion installation and troubleshooting. |
| `youtube-mobile-background.user.js` | Authoritative page-runtime source. |
| `rebuild-extension.sh` | Build, synchronization, validation, and packaging. |
| `firefox-extension/content.template.js` | Stable page-context injection bridge template. |
| `firefox-extension/background.js` | Update checker shared with Chrome. |
| `firefox-extension/popup.*` | Popup source shared with Chrome. |
| `chrome-extension/page.js` | Generated; do not edit directly. |
| `firefox-extension/page.js` | Generated; do not edit directly. |
| `tests/` | Regression tests. |

## Agent handoff checklist

When another agent takes over:

1. Read this file, `HANDOFF.md`, and the source header/constants.
2. Check `git status` and preserve unrelated user changes.
3. Confirm the source, manifests, ZIP names, and latest GitHub Release use the same version.
4. Make changes in authoritative sources, not generated `page.js`.
5. Preserve the desktop-backend/mobile-shell boundary.
6. Do not fight native Play, drawer, or WebKit presentation state.
7. Rebuild both packages and run the verification contract.
8. Update documentation when architecture or user-visible behavior changes.
