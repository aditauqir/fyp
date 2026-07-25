# Patch Notes

## v2.1.8 beta

- Fixed: Removed the channel-page flex-direction and internal-card overrides that enlarged the entire interface.
- Changed: Channel pages now retain YouTube's native card structure and only receive root/card width containment within the phone viewport.
- Fixed: Removed the unreliable derived `maxresdefault.jpg` Media Session entry, which could be selected by iOS even when that image did not exist.
- Added: The guaranteed YouTube HQ thumbnail is applied to both Media Session artwork and the active video poster, and Media Session playback state is refreshed for iOS Now Playing.
- Preserved: Player controls, caption and playback menus, horizontal viewport lock, Home/watch layouts, background playback, and ad handling are unchanged.
- Packaging: The new numeric manifest version is `2.1.8`, and the installable Orion file is `2.1.8_beta-release.zip`.

## v2.1.7 beta

- Fixed: Player toolbar events now defer to the injected page runtime when available, allowing caption and playback options to control YouTube instead of stopping in Orion's isolated fallback world.
- Fixed: Caption choices are deduplicated and the selected language is applied through YouTube's caption-track API, with guarded TextTrack retries for Orion.
- Added: Media Session metadata now supplies the video title, channel, and multiple YouTube thumbnail sizes for Lock Screen, Now Playing, and Dynamic Island artwork where Orion exposes iOS media artwork.
- Fixed: Channel browse pages use a phone-width single-column card layout, while Home, watch pages, horizontal shelves, the player, and the viewport lock remain unchanged.
- Documentation: Replaced the inline watch screenshot, added a playback-options demo, and removed the unnecessary Request Desktop Website installation step.
- Packaging: The new numeric manifest version is `2.1.7`, and the installable Orion file is `2.1.7_beta-release.zip`.

## v2.1.6 beta

- Added: The phone document viewport is locked to horizontal position zero while vertical page scrolling remains available.
- Added: Root horizontal overflow uses `clip` where Orion supports it, with `hidden` as a compatibility fallback and horizontal rubber-band overscroll disabled.
- Preserved: The working player-control strip, Captions dropdown, three-dot playback/settings dropdown, Home layout, action buttons, video behavior, captions, background playback, and ad handling are unchanged.
- Packaging: The new numeric manifest version is `2.1.6`, and the installable Orion file is `2.1.6_beta-release.zip`.

## v2.1.5 beta

- Fixed: The three-dot More button now opens a working dropdown instead of forwarding an unreliable tap to YouTube's hidden desktop control.
- Added: The More dropdown provides 0.5×, 0.75×, Normal, 1.25×, 1.5×, and 2× playback speeds plus an entry for YouTube's native player settings.
- Fixed: The Captions button now opens a dropdown containing Off and every caption or subtitle track currently exposed by the video.
- Added: Active caption and playback-speed choices are highlighted, tapping the same icon toggles its menu closed, and tapping outside the toolbar dismisses it.
- Preserved: Both menus occupy a full-width row inside the existing watch-page toolbar; Home, player, title, action-row, and horizontal layout geometry are unchanged.
- Packaging: The new numeric manifest version is `2.1.5`, and the installable Orion file is `2.1.5_beta-release.zip`.

## v2.1.4 beta

- Restored: Home, watch-page, masthead, feed, and native action layout are based directly on the known-good `2.0.20` release, removing the later width, offset, action-row, and horizontal-lock experiments.
- Replaced: The unreliable Show/Hide Controls hover button is gone. A seven-button Lucide-style strip now controls Back 10 seconds, Play/Pause, Forward 10 seconds, Captions, Picture in Picture, Fullscreen, and More.
- Fixed: The controls run from either the page world or Orion's isolated content fallback, with capture-phase `pointerdown`/`touchstart` handling so YouTube cannot swallow or double-trigger a command.
- Fixed: Play/Pause icon synchronization is now idempotent, breaking a mutation-observer feedback loop that could prevent the video and buttons from loading.
- Fixed: Horizontal scrolling is disabled only on `html` and `body`; YouTube app, feed, page-manager, player, and menu geometry remain untouched.
- Fixed: Removed the detectable active-ad timeline seeking introduced in 2.1.3; ad handling returns to skip-button clicks, response cleanup, and promoted-card removal.
- Added: YouTube's ad-block enforcement dialog is removed only when its text explicitly matches the ad-block warning, after which modal scroll state and playback are restored.
- Fixed: Background playback recovery now also runs in the isolated fallback on visibility changes, app blur, tab changes, page hiding, freezing, and screen locking.
- Preserved: Tapping inside the native player still holds YouTube's native controls for exactly 10 seconds without autonomous `play` or `playing` events extending the timer.
- Packaging: The new numeric manifest version is `2.1.4`, and the installable Orion file is `2.1.4_beta-release.zip`.

## v2.0.20

- Fixed: Orion’s toolbar action opens the packaged bottom-center popup again when the extension is installed from the recommended Chrome Manifest V3 zip.
- Changed: Manual installs and in-extension update checks now prefer the Chrome zip; the Firefox zip and XPI remain available as fallback packages.
- Changed: The popup’s three priority lines now identify the toolbar fix, the preferred iPhone package, and preserved background playback/control timing.
- Added: The README demo now includes the supplied iPhone lock-screen screenshot showing background playback.
- Notes: Player behavior, inline/fullscreen/PiP handling, background audio, captions, controls delay, comments, recommendations, search, navigation, Shorts, miniplayer, ads, and popup sizing are unchanged.

## v2.0.19

- Fixed: Orion’s native subtitle menu can activate several TextTracks simultaneously; the extension now keeps exactly one caption/subtitle track active.
- Changed: When captions are enabled, authored English is preferred, English auto-generated captions are the fallback, and then the best remaining subtitle is used.
- Fixed: A later manual language choice replaces the automatic default instead of remaining active beside it.
- Changed: Player controls remain visible for ten seconds after a user interaction before YouTube’s normal autohide resumes.
- Notes: Playback semantics, inline/fullscreen/PiP handling, background audio, comments, recommendations, navigation, Shorts, miniplayer, ads, and popup sizing are unchanged.

## v2.0.18

- Fixed: WebKit’s native text-track renderer is forced into hidden mode whenever YouTube’s custom caption layer is active, preventing the same caption from appearing twice while keeping YouTube’s cues working.
- Added: An Orion-first Firefox-format XPI package is now included and preferred by manual and in-extension update downloads.
- Fixed: Installation guidance now requires uninstalling the old version and moving the installer from iCloud Drive to **On My iPhone** before retrying, avoiding Orion file-permission and duplicate-extension failures.
- Notes: Player behavior, inline/fullscreen/PiP handling, background audio, comments, recommendations, controls delay, navigation, Shorts, miniplayer, ads, and popup sizing are unchanged.

## v2.0.17

- Fixed: Tapping YouTube Search on iPhone now expands the native desktop search form into a usable phone-width field, while preserving YouTube’s own query and results flow.
- Fixed: Search inputs use a 16px font so opening the keyboard does not zoom or clip the page in Orion.
- Changed: The README now clearly identifies iOS and Orion Browser, links the official Orion App Store listing, includes platform/download badges, and shows the supplied installation and product screenshots.
- Documented: The extension provides “OTA” update detection and downloads, but Orion policy requires every downloaded zip update to be installed manually with **Install from File**.
- Notes: No player, fullscreen/PiP, background audio, comments, recommendations, controls delay, captions, navigation, Shorts, miniplayer, ads, or popup sizing behavior changed.

## v2.0.16

- Fixed: YouTube recommendations now appear before native comments, and the extension no longer force-opens the comment section, preventing its loader from blocking recommended videos.
- Fixed: Comment and reply editors use a 16px minimum font so focusing them does not zoom the page on iPhone.
- Changed: Player controls remain visible for eight seconds after a user interaction, then YouTube’s normal autohide resumes; autonomous playback events no longer restart the timer.
- Fixed: When YouTube’s custom caption layer is present, Orion’s duplicate native WebVTT cue is hidden so closed captions appear once.
- Notes: No playback semantics, inline/fullscreen/PiP handling, background audio, navigation, Shorts, miniplayer, ads, or extension-menu layout changed.

## v2.0.15

- Removed: The custom first-three comment limiter and its **Show more**/**Show fewer** controls; YouTube’s complete native comment list remains below the description.
- Changed: Player controls remain visible for four seconds after Play or a Play/Pause control interaction before YouTube’s normal autohide resumes.
- Notes: No playback semantics, inline/fullscreen/PiP handling, background audio, navigation, Shorts, miniplayer, ads, extension-menu layout, or unrelated page layout changed.

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
