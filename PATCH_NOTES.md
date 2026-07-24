# Patch Notes

## v2.0.12

- Fixed: Videos are marked for inline WebKit playback when they are created and again before native Play.
- Changed: Fullscreen entry is blocked unless the user explicitly taps YouTube’s fullscreen control.
- Fixed: The extension icon now toggles a compact in-page action card instead of opening Orion’s full-page popup sheet.
- Removed: Expanded Shorts filtering removes current shelf, card, navigation, and route variants.
- Notes: If Orion’s app-level `WKWebView` disables inline media playback, only Orion can change that native setting; the extension now applies every page-level control available to WebKit.

## v2.0.11

- Fixed: One Play tap starts the video inline without forcing fullscreen or Picture in Picture.
- Fixed: Watch pages fit the phone viewport without clipping content from the left or right edge.
- Added: The compact two-button popup now shows the three highest-priority release notes.
- Notes: Added a dedicated architecture contract so future agents can preserve the desktop-backend/mobile-shell design.

## v2.0.10

- Fixed: Applied inline playback attributes before the native Play call and removed presentation-mode interference.
- Fixed: Removed desktop YouTube’s narrow-screen watch-column minimum that clipped content on iPhone.
- Changed: Added a one-column phone layout while preserving desktop YouTube as the application backend.
- Changed: Disabled Picture in Picture and removed the in-page status/PiP control.
- Changed: Reduced the extension popup to two compact buttons.
