# Bug fix log

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
