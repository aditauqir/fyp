# Bug fix log

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
