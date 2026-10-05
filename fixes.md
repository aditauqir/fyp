# Bug fix log

**Docs map:** [BUG-FIXES.md](./BUG-FIXES.md) · [HANDOFF.md](./HANDOFF.md) · [PATCH_NOTES.md](./PATCH_NOTES.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [AGENTS.md](./AGENTS.md)

## 2026-10-04 — Watch strip vanished until refresh; page inject hardened (fyp 3.4.0)

### In plain English
- **What was broken:** The inline SVG rewind / play / forward strip could disappear on cold watch open or early SPA load, then come back only after refreshing once the video had started.
- **Why it happened:** Sticky `settledOnTitle` blocked remount after Polymer rebuilt `#title`, and parking inside `#title-row` clipped the bar. Separately, Orion can leave a `<script>` tag present without executing page-world code.
- **What we changed:** Remount whenever placement is wrong; host after `#title-row`; one `ensurePageRuntime()` inject path with text → blob → src, retries, navigate reinject, and a watchdog that restores fallback strip work when the ready handshake disappears.
- **How to verify:** Install `3.4.0_release.zip` from GitHub Release `v3.4.0`. Cold-open `/watch`, open a video from Home, switch videos, refresh after play. Confirm the strip stays under the title with six white icons.

## 2026-08-23 — Refreshing a watch page hid the transport strip (fyp 3.1.1, issue #2)

### In plain English
- **What was broken:** Refreshing a video page hid the rewind / play / forward strip. It only came back after leaving the video and opening another one.
- **Why it happened:** On reload the player exists before the title. iOS WebKit often reports unpainted Polymer title nodes as not visible, so the script deleted the parked strip and returned without mounting it anywhere. SPA navigation had a painted title, so the strip appeared there.
- **What we changed:** Never leave a watch page without the strip once the watch chrome exists. Relax the mount check. Retry in a burst after reload. Prefer the title, then metadata, then the area under the video, then after the visible player, then the watch page root.
- **How to verify:** 1) Reinstall `3.1.1_release.zip` and hard-refresh. 2) Open a watch page. 3) Confirm the strip is under the video. 4) Refresh. 5) Confirm the strip is still under the video.

### Code that mattered
**Before (broken idea):**
```js
if (!(title instanceof Element) && !(metadata instanceof Element)) {
  if (toolbar instanceof HTMLElement && toolbarIsParkedOnPlayer(toolbar)) {
    toolbar.remove();
  }
  return;
}
```

**After (fixed idea):**
```js
if (!watchChromeExists) return;
if (!toolbarIsCorrectlyPlaced(toolbar, title, metadata, below, playerHost, watch)) {
  mountPlayerControlsToolbar(toolbar, title, metadata, below, playerHost, watch);
}
```

### Files touched
- `youtube-mobile-background.user.js` — remount on reload, burst retries, 3.1.1.
- `firefox-extension/content.template.js` — same fallback path.
- `tests/player-controls-delay.test.cjs` — layout version `icon-strip-v311-reload-mount`.
- `tests/content-fallback.test.cjs` — fallback remount helpers.

## 2026-08-22 — Search overlay showed two buttons and a tiny left field (fyp 3.1.0)


### In plain English
- **What was broken:** Tapping the top search control on iPhone showed two search buttons. The text field shrank to a small block on the left.
- **Why it happened:** The overlay used `width: auto` on a fixed `#center`. WebKit shrink-to-fit sized it to the collapsed desktop search icon. The header search icon stayed visible next to the form submit button.
- **What we changed:** Pin the overlay to the phone width. Stretch the native searchbox internals. Hide the header search icon while the overlay is open.
- **How to verify:** 1) Reinstall `3.1.0_release.zip` and hard-refresh. 2) Tap search in the top bar. 3) Confirm one full-width field. 4) Confirm one search button. 5) Type and submit.

### Code that mattered
**Before (broken idea):**
```css
ytd-masthead[data-fyp-mobile-search-open='true'] #center {
  position: fixed;
  left: 12px;
  right: 12px;
  width: auto; /* WebKit shrink-to-fit = icon sized */
}
```

**After (fixed idea):**
```css
ytd-masthead[data-fyp-mobile-search-open='true'] #center {
  width: calc(100vw - 24px);
}
ytd-masthead[data-fyp-mobile-search-open='true'] #end #search-button {
  visibility: hidden;
}
```

### Files touched
- `youtube-mobile-background.user.js` — full-width overlay, hide duplicate header icon.
- `tests/mobile-search.test.cjs` — lock the viewport width and header-icon hide.
- `BUG-FIXES.md` — search-bar ledger.

## 2026-08-20 — Closing the hamburger greyed the page and froze scroll (fyp 3.1.0, issue #1)

### In plain English
- **What was broken:** Opening the sidebar and closing it again turned the whole screen grey. Scrolling stopped.
- **Why it happened:** Two leftovers fought after close. YouTube’s drawer dimmer (`#scrim`) can stay painted because we hide the mini-guide rail Polymer expects to return to. The overlay also leaves `overflow: hidden` on the page. Ad-blocker cleanup used to delete every open overlay backdrop, which can include the drawer’s.
- **What we changed:** Hide leftover dimmer only when the drawer is not open. Restore page overflow after close. Remove only orphan ad backdrops, never drawer-owned ones. Leave YouTube’s drawer open/close attributes alone.
- **How to verify:** 1) Reinstall `3.1.0_release.zip` and hard-refresh. 2) Tap the hamburger. 3) Close it. 4) Confirm the page is not grey and still scrolls.

### Code that mattered
**Before (broken idea):**
```js
if (!document.querySelector('tp-yt-paper-dialog[opened]')) {
  document.querySelectorAll('tp-yt-iron-overlay-backdrop.opened')
    .forEach((backdrop) => backdrop.remove());
}
```

**After (fixed idea):**
```css
tp-yt-app-drawer#guide:not([opened]):not([opening]):not([peeking]) #scrim {
  pointer-events: none;
  opacity: 0;
}
```

```js
if (guideDrawerIsBusy() || overlayHostIsOpen()) return;
if (backdrop.closest('tp-yt-app-drawer')) return;
```

### Files touched
- `youtube-mobile-background.user.js` — scrim CSS, overflow restore, narrower ad-backdrop cleanup.
- `firefox-extension/content.template.js` — same fallback path.
- `tests/guide-scroll-restore.test.cjs` — lock the drawer-safe restore.
- `BUG-FIXES.md` — issue #1 ledger.

## 2026-08-20 — Refreshing a watch page hid the transport strip (fyp 3.1.0, issue #2)

### In plain English
- **What was broken:** Refreshing a video hid the FYP rewind / play / forward strip. It came back after navigating from another YouTube page.
- **Why it happened:** On reload the player exists before the title. The strip was parked after the player. Full-bleed CSS then hides that player slot, so the strip vanished. A leftover hidden title still counted as a valid mount, so the strip was never moved.
- **What we changed:** Only mount the strip on a visible title/metadata block. Never park it on the player. If it is already stuck on the player before the title exists, remove it and wait.
- **How to verify:** 1) Reinstall `3.1.0_release.zip` and hard-refresh. 2) Open a watch page and confirm the strip is under the title. 3) Refresh. 4) Confirm the strip is still under the title.

### Code that mattered
**Before (broken idea):**
```js
if (title) title.insertAdjacentElement('afterend', toolbar);
else if (playerAnchor) playerAnchor.insertAdjacentElement('afterend', toolbar);
```

**After (fixed idea):**
```js
if (!(title || metadata)) {
  if (toolbarIsParkedOnPlayer(toolbar)) toolbar.remove();
  return;
}
if (title) title.insertAdjacentElement('afterend', toolbar);
else if (metadata) metadata.insertAdjacentElement('afterbegin', toolbar);
```

### Files touched
- `youtube-mobile-background.user.js` — visible title mount; never park on player.
- `firefox-extension/content.template.js` — same fallback path.
- `tests/player-controls-delay.test.cjs` — layout version `icon-strip-v310-title-mount`.
- `BUG-FIXES.md` — issue #2 ledger.

## 2026-08-20 — Search cards did not match the screenshot stack (fyp 3.0.4)

### In plain English
- **What was broken:** Search results put the thumbnail first and mixed the channel name with the rest of the text. That was not the stacked preview screenshot.
- **Why it happened:** A later Home-feed leak fix stacked the thumbnail with `order: -1`. Channel, snippet, and title live inside `#details`, so they could not move above the picture.
- **What we changed:** Each result uses named grid areas: channel, thumbnail, snippet, badges, views, title+menu, chapters. `#channel-info` is moved in front of the thumbnail. Nested wrappers use `display: contents`.
- **How to verify:** 1) Reinstall `3.0.4_release.zip` and hard-refresh. 2) Search for a video. 3) Confirm the channel photo and name are above the thumbnail. 4) Confirm title is at the bottom with the three-dot menu. 5) Confirm Home did not change.

### Code that mattered
**Before (broken idea):**
```css
ytd-search ytd-video-renderer ytd-thumbnail {
  order: -1;
}
ytd-search ytd-video-renderer #details {
  order: 2;
}
```

**After (fixed idea):**
```css
grid-template-areas:
  "channel channel"
  "thumb thumb"
  "snippet snippet"
  "badges badges"
  "views views"
  "title menu"
  "chapters chapters";
```

```js
dismissible.insertBefore(channel, thumb);
```

### Files touched
- `youtube-mobile-background.user.js` — restore the screenshot search stack.
- `tests/mobile-search.test.cjs` — lock grid areas and the channel hoist.
- `HANDOFF.md`, `ARCHITECTURE.md`, `PATCH_NOTES.md` — record the screenshot contract.
- `fixes.md` — record the layout restore.

## 2026-08-20 — Search cards duplicated the channel name and clipped text (fyp 3.0.3)

### In plain English
- **What was broken:** Search results showed the channel name twice. Titles and channel rows were chopped off.
- **Why it happened:** Two systems fought. Desktop search already prints the channel in the byline. The restyle also forced `#channel-info` visible, so the name appeared twice. YouTube still capped the old side-by-side card height, and nested `-webkit-box` on `h3` plus `#title-wrapper` plus `#video-title` clipped the stacked layout.
- **What we changed:** Hide the byline channel copy. Keep one `#channel-info` row. Lift the height cap on the stacked card. Clamp only the title.
- **How to verify:** 1) Reinstall `3.0.3_release.zip` and hard-refresh. 2) Search for a video. 3) Confirm the channel name appears once, with the avatar. 4) Confirm the title and channel row are fully visible, not cut off. 5) Open Home and confirm the feed did not change.

### Code that mattered
**Before (broken idea):**
```css
ytd-search ytd-video-renderer #channel-info,
ytd-search ytd-video-renderer ytd-channel-name,
ytd-search ytd-video-renderer #byline-container {
  display: flex;
  visibility: visible;
  overflow: hidden;
}

ytd-search ytd-video-renderer h3,
ytd-search ytd-video-renderer #title-wrapper,
ytd-search ytd-video-renderer #video-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
}
```

**After (fixed idea):**
```css
ytd-search ytd-video-renderer ytd-video-meta-block #byline-container {
  display: none;
}

ytd-search ytd-video-renderer #details,
ytd-search ytd-video-renderer #dismissible {
  max-height: none;
  overflow: visible;
}

ytd-search ytd-video-renderer #title-wrapper {
  display: block;
  overflow: visible;
}
```

### Files touched
- `youtube-mobile-background.user.js` — one channel row; unclip stacked search cards.
- `tests/mobile-search.test.cjs` — lock the byline hide and overflow rules.
- `HANDOFF.md`, `ARCHITECTURE.md`, `PATCH_NOTES.md` — record the 3.0.3 search-card contract.
- `fixes.md` — record the duplicate-name and clipping fix.

## 2026-08-20 — Search styles leaked onto Home (fyp 3.0.2)

### In plain English
- **What was broken:** Search-card rules also changed the Home feed. Search thumbnails were still beside the text instead of stacked on top.
- **Why it happened:** Two systems fought. Search CSS used unscoped `html[data-fyp-simple-search]` selectors, and the script turned that flag on whenever a leftover `ytd-search` node existed. YouTube keeps that node after you leave search, so Home inherited search layout.
- **What we changed:** Search-card CSS now starts with `ytd-search` only. The search flag is set only on `/results`. The thumbnail uses column flex and `order: -1` so it stacks first.
- **How to verify:** 1) Reinstall `3.0.2_release.zip` and hard-refresh. 2) Open Home and confirm the feed looks like it did before the search restyle. 3) Search for a video. 4) Confirm the thumbnail is full-width on top of the card.

### Code that mattered
**Before (broken idea):**
```js
const onResults =
  location.pathname.startsWith('/results') ||
  Boolean(document.querySelector('ytd-search'));
```

```css
html[data-fyp-simple-search='true'] #details,
html[data-fyp-simple-search='true'] #video-title { ... }
```

**After (fixed idea):**
```js
const onResults = location.pathname.startsWith('/results');
```

```css
ytd-search ytd-video-renderer #dismissible.ytd-video-renderer {
  display: flex;
  flex-direction: column;
}
ytd-search ytd-video-renderer ytd-thumbnail {
  order: -1;
}
```

### Files touched
- `youtube-mobile-background.user.js` — scope search CSS to `ytd-search`; stack the thumbnail first.
- `tests/mobile-search.test.cjs` — lock the Home-safe selectors and `/results` gate.
- `HANDOFF.md`, `ARCHITECTURE.md`, `PATCH_NOTES.md` — record the search-only contract.
- `fixes.md` — record the leak and the thumbnail stack.

## 2026-08-20 — Search cards did not match the stacked preview layout (fyp 3.0.1)

### In plain English
- **What was broken:** Search results still looked like a generic home card, and AI Summary chips could show up in the preview under the thumbnail.
- **Why it happened:** The card stacked title first, and only the Summary *buttons* were hidden. YouTube also paints AI summary panels in the same expandable slot as chapters.
- **What we changed:** Each result now follows the screenshot stack: channel, thumbnail, snippet, badges, views/date, title, then chapters. AI summary panels are hidden; chapter bars stay.
- **How to verify:** 1) Reinstall `3.0.1_release.zip` and hard-refresh. 2) Search for a video. 3) Confirm the channel row is above the thumbnail and the title is near the bottom. 4) Confirm no AI Summary chip or panel appears, and a chapters bar still can.

### Code that mattered
**Before (broken idea):**
```css
ytd-thumbnail { order: -1; }
#video-title { order: 1; }
#channel-info { order: 2; }
```

**After (fixed idea):**
```css
grid-template-areas:
  'channel channel'
  'thumb thumb'
  'desc desc'
  'badges badges'
  'stats stats'
  'title menu'
  'chapters chapters';
```

### Files touched
- `youtube-mobile-background.user.js` — restack search cards and hide AI summary previews.
- `tests/mobile-search.test.cjs` — lock the new card order and summary hiding.
- `fixes.md` — record the layout change.

## 2026-08-20 — Search cards squashed channel photos and stacked text too loosely (fyp 3.0.0)

### In plain English
- **What was broken:** Search results showed a squeezed channel photo, extra empty space between the thumbnail, title, channel, and description, and the text order was wrong.
- **Why it happened:** The same “fill this box” image rule that makes video thumbnails look right was also applied to tiny channel photos. Those photos were stretched to fill a wide rectangle. Extra padding and flex gaps made the card look sparse.
- **What we changed:** Channel photos stay 24×24 and round. The card now reads title, then channel icon and name, then description, with small gaps.
- **How to verify:** 1) Reinstall `3.0.0_release.zip` and hard-refresh YouTube. 2) Search for a video. 3) Confirm the channel photo is a circle, not a pancake. 4) Confirm the order is title, then channel, then description, with little space between those lines.

### Code that mattered
**Before (broken idea):**
```css
ytd-search yt-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
```

**After (fixed idea):**
```css
ytd-search yt-decorated-avatar-view-model {
  width: 24px;
  height: 24px;
  aspect-ratio: 1 / 1;
  border-radius: 50%;
}
```

### Files touched
- `youtube-mobile-background.user.js` — keep thumbnail fill rules on thumbs only; order title/channel/description; shrink card gaps.
- `tests/mobile-search.test.cjs` — lock the new order and round-avatar rules.
- `fixes.md` — record the layout bug and fix.

## 2026-08-20 — Queued playlist vanished on watch pages (fyp 3.0.0)

### In plain English
- **What was broken:** Opening a video from a playlist hid the queue. Related videos took over the whole side column, so the “up next” list disappeared.
- **Why it happened:** The extension moved “recommendations” by grabbing either the related-videos block or the entire right-hand column. On playlist watches that column *is* the queue, so the queue was treated as related videos and got lost.
- **What we changed:** Only move the real related-videos block. If a playlist is queued, keep YouTube’s native playlist panel and place it under the title, before related videos and comments.
- **How to verify:** 1) Reinstall `3.0.0_release.zip` and hard-refresh. 2) Open a playlist and play a video. 3) Confirm the queue list is still on the page under the title. 4) Confirm related videos and comments still appear below it.

### Code that mattered
**Before (broken idea):**
```js
const recommendations =
  watch.querySelector('ytd-watch-next-secondary-results-renderer') ||
  watch.querySelector('#secondary');
```

**After (fixed idea):**
```js
const playlist = findWatchPlaylistHost(watch);
const recommendationsCandidate =
  watch.querySelector('ytd-watch-next-secondary-results-renderer') ||
  watch.querySelector('#related');
```

### Files touched
- `youtube-mobile-background.user.js` — find the playlist host, never move all of `#secondary`, order playlist before related videos.
- `tests/comments-layout.test.cjs` — keep comments after playlist and related videos.
- `tests/watch-playlist-layout.test.cjs` — lock the playlist placement contract.
- `fixes.md` — record the disappearing-queue bug and fix.

## 2026-08-11 — README install-guide check failed (fyp 2.2.14)

### In plain English
- **What was broken:** The README test expected a missing purpose heading, old guide phrases, and an obsolete `2.2.3` package.
- **Why it happened:** The README instructions changed, but the test continued to require text and artifacts from older releases.
- **What we changed:** Restored the purpose heading and aligned the checks with the current install, update, troubleshooting, and `2.2.14` package instructions.
- **How to verify:** 1) Open `README.md`. 2) Find the purpose heading under **What is this?**. 3) Run `node --test tests/readme-install-guide.test.cjs`. 4) Confirm the test passes.

### Code that mattered
**Before (broken idea):**
```markdown
## What is this?

I built **Fuck YouTube Premium** because ...
```

**After (fixed idea):**
```markdown
## What is this?

### Basically free YouTube Premium for iPhone

I built **Fuck YouTube Premium** because ...
```

### Files touched
- `README.md` — restore the tested purpose heading.
- `tests/readme-install-guide.test.cjs` — replace stale wording and package assertions with current requirements.
- `fixes.md` — record the failed assertion and correction.

## 2026-08-08 — Search result cards break (fyp 2.2.12)

### In plain English
- **What was broken:** Search result cards could overlap, collapse, or show content in the wrong place.
- **Why it happened:** The extension forced YouTube's current result-card container and every nested `div` into separate CSS grids. YouTube can change those internal containers without notice.
- **What we changed:** The compact grid now applies only to the stable legacy `ytd-video-renderer #dismissible` boundary. Current `yt-lockup-view-model` cards keep YouTube's native internal layout.
- **How to verify:** 1) Search for a video. 2) Scroll through several result types. 3) Confirm each thumbnail, title, channel, and metadata block stays inside its card.

### Code that mattered
**Before (broken idea):**
```css
ytd-search yt-lockup-view-model,
ytd-search yt-lockup-view-model > div {
  display: grid !important;
}
```

**After (fixed idea):**
```css
ytd-search ytd-video-renderer #dismissible {
  display: grid !important;
}
```

### Files touched
- `youtube-mobile-background.user.js` — stop overriding current YouTube lockup internals.
- `tests/mobile-search.test.cjs` — prevent nested lockup grids from returning.
- `fixes.md` — record the bug and fix.

## 2026-08-08 — Recommendations wait for comments (fyp 2.2.12)

### In plain English
- **What was broken:** Recommended videos between the description and comments sometimes did not load or move into place.
- **Why it happened:** The layout function exited until the lazy-loaded comments node existed. Comments are designed to load after recommendations, so each section could wait for the other.
- **What we changed:** Recommendations now move below the description as soon as their native YouTube container exists. Comments still load naturally and move after recommendations when available.
- **How to verify:** 1) Open a watch page. 2) Confirm recommendations appear below the description before comments load. 3) Scroll down. 4) Confirm native comments appear after recommendations.

### Code that mattered
**Before (broken idea):**
```js
const comments = findCommentsRoot();
if (!descriptionBlock || !comments) return;
```

**After (fixed idea):**
```js
const comments = findCommentsRoot();
const recommendations =
  watch.querySelector('ytd-watch-next-secondary-results-renderer') ||
  watch.querySelector('#secondary');
if (!descriptionBlock || (!recommendations && !comments)) return;
```

### Files touched
- `youtube-mobile-background.user.js` — position recommendations without waiting for comments.
- `tests/comments-layout.test.cjs` — cover the independent recommendation-loading path.
- `fixes.md` — record the bug and fix.

## 2026-08-01 — Unreliable inline quality gear removed (fyp 2.2.13)

### In plain English
- **What was broken:** The inline quality gear could open a blank menu, and quality selections did not apply reliably.
- **Why it happened:** Orion and YouTube did not expose a stable quality-menu path for the custom inline control. The control could display without a dependable set of choices or a confirmed selection.
- **What we changed:** Removed the inline quality gear from the released toolbar. The AirPlay button and all existing transport controls remain available. The new layout key also removes an old gear left in the page after an extension update.
- **How to verify:** 1) Install `2.2.13_release.zip`. 2) Open a YouTube watch page. 3) Confirm the inline toolbar has rewind, play/pause, forward, Picture in Picture, AirPlay, and fullscreen. 4) Confirm no quality gear or blank quality menu appears.

### Code that mattered
**Before (broken idea):**
```js
playerControlButtonMarkup(
  'quality',
  'Video quality',
  PLAYER_CONTROL_ICONS.quality
);
```

**After (fixed idea):**
```js
// Quality is omitted until the inline control works reliably.
playerControlButtonMarkup('airplay', 'AirPlay', PLAYER_CONTROL_ICONS.airplay);
```

### Files touched
- `youtube-mobile-background.user.js` — remove the inline Settings button and update the toolbar layout key.
- `firefox-extension/content.template.js` — mirror the quality-gear removal in the isolated fallback.
- `tests/player-controls-delay.test.cjs` / `tests/content-fallback.test.cjs` — prevent the quality gear from returning accidentally.
- `PATCH_NOTES.md` / `firefox-extension/popup.html` — document the removal and keep AirPlay visible in release notes.

## 2026-07-31 — Now Playing ownership + faster startup (fyp 2.2.13)

### In plain English
- **What was broken:** Now Playing could fight the inline play/pause button. With multiple tabs open, an old paused tab could replace the current video. Page startup was also slow.
- **Why it happened:** Two runtimes were fighting in each tab because the fallback expected page version `2.2.11`, but the page reported `2.2.12`. Across tabs, every tab also rewrote Media Session handlers and metadata on a timer. The duplicate fallback observers and full-page scans added work while YouTube loaded.
- **What we changed:** The page and fallback now use the same release version. The fallback stops after the page runtime starts. A shared lease gives Now Playing to the newest visible playing tab, and hidden old tabs cannot reclaim it. Full-page mutation scans now run at most once every 1.2 seconds.
- **How to verify:** 1) Open two YouTube tabs. 2) Play a video in the first tab, then pause it. 3) Play a different video in the second tab. 4) Confirm Now Playing shows and controls the second video. 5) Reload and confirm the page becomes usable without the previous delay.

### Code that mattered
**Before (broken idea):**
```js
const EXPECTED_PAGE_VERSION = '2.2.11';
setInterval(() => {
  installMediaSessionHandlers();
  updateMediaSessionMetadata();
}, 1200);
```

**After (fixed idea):**
```js
const EXPECTED_PAGE_VERSION = '2.2.13';
if (!ownsMediaSession()) return;
if (pageRuntimeReady()) return; // stop isolated fallback work
```

### Files touched
- `youtube-mobile-background.user.js` — add single-tab Media Session ownership and throttle full-page scans.
- `firefox-extension/content.template.js` — match the page version and stop fallback work after readiness.
- `ARCHITECTURE.md` / `PERFORMANCE-FIXES.md` — document ownership and startup behavior.
- `tests/media-session-ownership.test.cjs` — prevent handshake and ownership regressions.

## 2026-07-29 — Captions blank + slow load (fyp 2.2.12)

### In plain English
- **What was broken:** After 2.2.11, caption OPTIONS still appeared but no on-screen text, and videos took a long time to start.
- **Why it happened:** Two systems fighting: (1) the CPU tamer wrapped YouTube’s `setTimeout`/`setInterval` during `timeupdate`, starving caption painting and player init on Orion; (2) CSS hid native `::cue` as soon as captions were “intended on,” so when custom segments never painted there was nothing left to see.
- **What we changed:** CPU tamer is off by default (code kept; opt-in via `localStorage.fypEnableCpuTamer='1'` or `window.__fypEnableCpuTamer=true`). Native `::cue` hides only while `.ytp-caption-segment` exists. Sticky RYD and sibling-only track dedupe stay.
- **How to verify:** 1) Install `~/Downloads/2.2.12_release.zip`. 2) Open a captioned video → text appears. 3) Confirm video starts promptly. 4) Confirm dislike count still sticks.

### Code that mattered
**Before (broken idea):**
```js
installYoutubeCpuTamer(window); // always on
video.dataset.fypNativeCaptionsHidden = 'true'; // hide native before custom paints
```

**After (fixed idea):**
```js
if (shouldInstallYoutubeCpuTamer(window)) installYoutubeCpuTamer(window); // default false
if (customCaptionsVisible) video.dataset.fypNativeCaptionsHidden = 'true';
else delete video.dataset.fypNativeCaptionsHidden;
```

### Files touched
- `youtube-mobile-background.user.js` — gate CPU tamer; soften native cue hide.
- `PATCH_NOTES.md` / `firefox-extension/popup.html` — 2.2.12 notes.
- `tests/cpu-tamer-gate.test.cjs` / `tests/captions-deduplication.test.cjs` — contracts.

## 2026-07-29 — Captions gone + double-start (fyp 2.2.11)

### In plain English
- **What was broken:** After 2.2.10, captions often never showed (including when YouTube has them on by default). Turning them on could also flash two caption layers.
- **Why it happened:** 2.2.10 refused to touch TextTracks until `.ytp-caption-segment` existed, then forced the preferred track to `hidden` and siblings to `disabled`. One brief segment paint + mode thrash left tracks disabled with no segments left — a chicken-egg where captions stayed gone. Native `::cue` also stayed visible until segments painted, so a double flash was still possible on start.
- **What we changed:** Hide native `::cue` / WebKit text-track display as soon as captions are intended on (CC pressed, active track, or dataset flag). After a short delay (or once custom segments exist), disable only *sibling* tracks — never the preferred one, and never force all tracks off.
- **How to verify:** 1) Open a video with captions on by default → text appears once. 2) Toggle CC off/on → one layer only. 3) Confirm dislike count still sticks on the watch actions row.

### Code that mattered
**Before (broken idea):**
```js
if (!customCaptionsVisible) {
  delete video.dataset.fypNativeCaptionsHidden;
  return;
}
const desired = track === selectedTrack ? 'hidden' : 'disabled';
track.mode = desired; // preferred forced to hidden too
```

**After (fixed idea):**
```js
if (captionsIntendedOn) {
  video.dataset.fypNativeCaptionsHidden = 'true'; // CSS kills ::cue early
}
if (!dedupeReady) return;
for (const track of tracks) {
  if (track === selectedTrack) continue; // leave preferred alone
  track.mode = 'disabled'; // siblings only
}
```

### Files touched
- `youtube-mobile-background.user.js` — early CSS cue hide + delayed sibling-only dedupe.
- `PATCH_NOTES.md` / `firefox-extension/popup.html` — 2.2.11 notes.
- `tests/captions-deduplication.test.cjs` — contract for the new approach.

## 2026-07-29 — Caption activation / dedupe race (fyp 2.2.10)

### In plain English
- **What was broken:** Captions acted weird again — sometimes would not turn on, sometimes doubled, Languages could show two English rows selected, or modes flickered.
- **Why it happened:** 2.2.5 let TextTrack `hidden`/`disabled` enforcement run whenever more than one subtitle track was active, even before YouTube painted custom caption segments. That reintroduced the 2.2.2 fight with YouTube’s caption module. The 300ms poll also rewrote track modes every tick.
- **What we changed:** Restore the 2.2.3 deferral (`if (!customCaptionsVisible) return`) before single-track collapse, and only write `track.mode` when it differs from the desired value. `::cue` still hides only while custom segments exist.
- **How to verify:** Turn captions on → text appears once. Open Languages → one English selected. Toggle off/on and change language without flicker or a stuck-off state.

### Code that mattered
**Before (broken idea):**
```js
if (!customCaptionsVisible && activeTracks.length <= 1) {
  delete video.dataset.fypNativeCaptionsHidden;
  return;
}
// collapses multi-active tracks before segments paint
```

**After (fixed idea):**
```js
if (!customCaptionsVisible) {
  delete video.dataset.fypNativeCaptionsHidden;
  return;
}
const desired = track === selectedTrack ? 'hidden' : 'disabled';
if (track.mode === desired) continue;
track.mode = desired;
```

### Files touched
- `youtube-mobile-background.user.js` — caption dedupe deferral + mode thrash guard.
- `PATCH_NOTES.md` / `firefox-extension/popup.html` — 2.2.10 caption notes.

## 2026-07-29 — Sticky RYD dislike counts (fyp 2.2.10)


### In plain English
- **What was broken:** Dislike numbers from Return YouTube Dislike flashed on briefly, then vanished.
- **Why it happened:** YouTube remounts or rewrites the dislike button and clears our label. Icon-only button classes also clip/hide any text we inject.
- **What we changed:** Shape the dislike control like upstream RYD (`icon-leading`), mark our text node, watch that host with a MutationObserver, and re-apply the cached count when YouTube wipes it.
- **How to verify:** Open a video that previously showed a count, wait a few seconds / scroll the actions row — the dislike number should stay visible.

### Code that mattered
**Before (broken idea):**
```js
textContainer.textContent = text; // once; YouTube clears it later
```

**After (fixed idea):**
```js
ensureWatchDislikeObserver(dislikeHost); // re-apply from cache on wipe
updateWatchDislikeButtonShape(button); // icon-leading so the label fits
```

### Files touched
- `youtube-mobile-background.user.js` — sticky RYD apply + observer + button shape.
- `PATCH_NOTES.md` / `firefox-extension/popup.html` — 2.2.10 notes.

## 2026-07-29 — Horizontal overflow / sideways swipe (fyp 2.2.9)

### In plain English
- **What was broken:** On Orion iPhone you could swipe the page sideways and see blank space past the left/right edge.
- **Why it happened:** Desktop YouTube still paints columns wider than a phone. Overflow was only clipped on `html`/`body`, which WebKit often ignores when `ytd-app` / page-manager is the real scroll surface. Some caps also used `100vw`, which itself can exceed the visible width.
- **What we changed:** Clip overflow-x on the app shells too, cap known wide containers to `max-width: 100%`, and nudge `enforceHorizontalViewportLock` to zero scrollLeft on those shells.
- **How to verify:** Open Home/Watch/Search on Orion iPhone — try to swipe left/right; the page should stay locked to the screen width. Player, search list, and transport strip should look and behave as in 2.2.8.

### Code that mattered
**Before (broken idea):**
```css
html, body { overflow-x: hidden; } /* children still widen the page */
ytd-app { max-width: 100vw; } /* vw can still bleed past the viewport */
```

**After (fixed idea):**
```css
html, body, ytd-app, ytd-page-manager, #page-manager {
  overflow-x: clip; /* or hidden */
  max-width: 100%;
}
```

### Files touched
- `youtube-mobile-background.user.js` — stronger phone overflow lock + tiny scrollLeft reset.
- `firefox-extension/content.template.js` — matching DOM fallback CSS + `EXPECTED_PAGE_VERSION`.
- `PATCH_NOTES.md` / `firefox-extension/popup.html` — 2.2.9 notes.

## 2026-07-29 — Watch gap + toolbar jitter (fyp 2.2.8)

### In plain English
- **What was broken:** After 2.2.7, the watch page left a huge empty region between the video and the transport buttons, and the layout jittered while loading.
- **Why it happened:** Toolbar placement required the title to have a positive layout height. During YouTube remounts that height briefly hit 0, so the strip fell into `#below` and got flex `order: 4` (below recommendations/comments). Scans kept reparenting it. Desktop theater/full-bleed height vars also reserved empty player space.
- **What we changed:** Place the strip from mounted title/metadata without requiring height; skip reparent when already correct; rescue stray `#below` toolbars back under the title; constrain player shells to 16:9 and collapse the in-column spacer in full-bleed mode.
- **How to verify:** Open a video — buttons sit tightly under the title with no large empty band; layout stays still after load; search list and light/dark strip theming still work.

### Code that mattered
**Before (broken idea):**
```js
const title = visiblePlacementTarget(...); // requires rect.height > 0
// fallback inserts into #below → later order: 4
```

**After (fixed idea):**
```js
const title = findWatchTitleAnchor(); // mounted + not display:none
if (toolbarIsCorrectlyPlaced(...)) return; // no reparent jitter
```

### Files touched
- `youtube-mobile-background.user.js` — tight player CSS + stable toolbar placement.
- `firefox-extension/content.template.js` — matching fallback placement + `EXPECTED_PAGE_VERSION`.
- `PATCH_NOTES.md` / `firefox-extension/popup.html` — 2.2.8 notes.

## 2026-07-29 — Compact search + watch stack + theme (fyp 2.2.7)

### In plain English
- **What was broken:** Search results crushed titles next to oversized thumbnails and kept flipping back to that cluttered layout. On watch, the transport strip could sit beside the player while the page loaded. Buttons stayed dark-themed in light mode.
- **Why it happened:** Desktop YouTube search lockups use a wide horizontal grid on phone widths; our strip placement raced the title mount; button colors were hard-coded for dark UI.
- **What we changed:** Forced a compact search grid (132px thumb + readable meta), re-applied on every scan/navigate; stacked watch as player → title → buttons; themed the strip/search overlay with YouTube CSS variables + dark overrides.
- **How to verify:** 1) Search “Rc plane” — titles readable, small thumbs, no Sur chips. 2) Open a video — strip sits under the title. 3) Toggle YouTube light/dark — strip colors follow.

### Code that mattered
**Before (broken idea):**
```css
#toolbar { color: #fff; background: rgba(255,255,255,.08); width: fit-content; }
```

**After (fixed idea):**
```css
#toolbar {
  width: 100% !important;
  color: var(--yt-spec-text-primary, #0f0f0f);
  background: var(--yt-spec-badge-chip-background, rgba(0,0,0,.06));
}
html[dark] #toolbar { color: #fff; background: rgba(255,255,255,.08); }
```

### Files touched
- `youtube-mobile-background.user.js` — simple-search CSS/JS, watch stack, theme-aware controls.
- `PATCH_NOTES.md` / `firefox-extension/popup.html` — 2.2.7 notes.

## 2026-07-28 — Watch resume + caption dedupe cleanup (fyp 2.2.5)

### In plain English
- **What was broken:** Reloading a video often restarted from `0:00` even after you had already watched minutes of it. Captions could also show two selected rows for the same language.
- **Why it happened:** The CPU-tamer reduced YouTube timer churn, and YouTube sometimes failed to persist/restore watch progress in time. Caption dedupe only ran after custom caption segments were visible, so duplicate active tracks could linger.
- **What we changed:** Added a local resume fallback (per video id) that saves playback position and restores it on metadata load, and made caption dedupe collapse multi-active tracks as soon as captions are on.
- **How to verify:** 1) Watch to ~5:00, reload, confirm it resumes near that time. 2) Turn captions on and open language selection, confirm only one row is selected for the active language. 3) Confirm captions still render once on screen.

### Code that mattered
**Before (broken idea):**
```js
function onVideoLoaded() {
  enforceInlinePlayback(state.video);
  updateMediaSessionMetadata();
}

if (!customCaptionsVisible) {
  delete video.dataset.fypNativeCaptionsHidden;
  return;
}
```

**After (fixed idea):**
```js
function onVideoLoaded() {
  enforceInlinePlayback(state.video);
  restoreWatchResume(state.video);
  updateMediaSessionMetadata();
}

if (!customCaptionsVisible && activeTracks.length <= 1) {
  delete video.dataset.fypNativeCaptionsHidden;
  return;
}
```

### Files touched
- `youtube-mobile-background.user.js` — added local watch resume fallback and earlier caption dedupe collapse logic.
- `PATCH_NOTES.md` — documented 2.2.5 bug-fix release notes.
- `firefox-extension/popup.html` — updated top release highlights shown in extension popup.
