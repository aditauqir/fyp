# Patch Notes

## v2.0.14

- Fixed: Comments now show the first three top-level comments, then reveal exactly five more per **Show more** tap.
- Fixed: Removed the toolbar-to-content in-page menu path that crashed Orion and restored a real extension popup.
- Changed: The popup panel sits at the bottom center, uses up to 92% of the viewport width and 38% of its height, and contains three priority lines plus **Go to YouTube** and **Check for updates**.
- Notes: No playback, inline/fullscreen, background-audio, navigation, Shorts, miniplayer, ad-blocking, or general page-layout behavior changed.

## v2.0.13

- Fixed: The Orion toolbar tap now uses a zero-UI `default_popup` bridge that sends the action directly to the active YouTube tab and closes immediately.
- Fixed: Page injection now proves that `page.js` executed with a versioned readiness signal; failed external injection retries with a nonce-aware inline fallback.
- Fixed: Inline video attributes, phone-width overflow constraints, Shorts hiding, and Shorts route blocking now also run in the isolated content layer when page-world injection is unavailable.
- Changed: The in-page controls are enlarged to a maximum width of 22rem, with 3.5rem tap targets and more legible three-line release notes.
- Fixed: Manual update checks try the background service first, then fall back to a direct GitHub Release request when Orion suspends extension background messaging.
- Notes: A WebExtension can request inline playback at every page layer, but only Orion can change the native `WKWebViewConfiguration.allowsInlineMediaPlayback` setting.

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
