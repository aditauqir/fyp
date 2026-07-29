# Patch Notes

## v2.2.10

- Fixed: Return YouTube Dislike counts stay visible on watch pages. YouTube was remounting the dislike button and wiping the label; FYP now reshapes the icon-only button for a text label and re-applies the cached count when the DOM is cleared.
- Preserved: Player, search, captions, and overflow behavior from 2.2.7–2.2.9 are unchanged.
- Packaging: Numeric version `2.2.10`; recommended Orion installer `2.2.10_release.zip` (Chrome MV3).

## v2.2.9

- Fixed: Phone layouts no longer swipe sideways into blank space. Overflow is clipped on `html`/`body`/`ytd-app`/`page-manager`, and wide desktop shells are capped to `100%` (not `100vw`) so the page cannot paint past the viewport.
- Preserved: 2.2.7–2.2.8 player stack, compact search list, transport theming, and toolbar placement logic are unchanged.
- Packaging: Numeric version `2.2.9`; recommended Orion installer `2.2.9_release.zip` (Chrome MV3).

## v2.2.8

- Fixed: Watch page no longer leaves a huge empty gap between the video and the transport buttons. Player shells are constrained to a tight 16:9 footprint, and full-bleed mode collapses the unused in-column player spacer.
- Fixed: Transport strip placement is stable — it no longer reparents on every DOM scan when the title briefly has zero height, which was causing layout jitter and pushing the buttons below recommendations/comments.
- Preserved: 2.2.7 compact search list layout and light/dark transport theming.
- Packaging: Numeric version `2.2.8`; recommended Orion installer `2.2.8_release.zip` (Chrome MV3).

## v2.2.7

- Fixed: Search results force a compact list layout — small thumbnail on the left with readable multi-line title, channel avatar/name, and view/date stats on the right. AI Summary / Sur chips and description snippets are stripped so the page cannot fall back to the cluttered crushed-title layout.
- Fixed: Watch page always stacks as player → title → transport buttons. The strip no longer loads beside the player during metadata races.
- Fixed: Transport buttons and the mobile search overlay now follow YouTube light/dark theme via CSS variables and dark-mode overrides.
- Packaging: Numeric version `2.2.7`; recommended Orion installer `2.2.7_release.zip` (Chrome MV3).

## v2.2.6

- Added: Return YouTube Dislike support on watch pages using the RYD API endpoint and selector strategy adapted from [Anarios/return-youtube-dislike](https://github.com/Anarios/return-youtube-dislike).
- Added: Cached dislike-count fetch (5-minute TTL per video) and resilient fallback behavior so UI stays stable if the API is unavailable.
- Preserved: Existing playback, caption dedupe, and CPU-tamer behavior.
- Packaging: Numeric version `2.2.6`; recommended Orion installer `2.2.6_release.zip` (Chrome MV3).

## v2.2.5

- Fixed: Reloading a `/watch` page no longer drops playback back to `0:00` after stopping near the middle. FYP now keeps a local per-video resume checkpoint and restores it on metadata load when YouTube fails to restore progress.
- Fixed: Caption dedupe now collapses duplicate selected tracks earlier. If captions are on and multiple subtitle TextTracks are active, FYP immediately keeps one active track and disables the rest so Orion does not show conflicting double-selected language rows.
- Preserved: 2.2.4 CPU/energy tamer and 2.2.3 caption activation behavior remain intact.
- Packaging: Numeric version `2.2.5`; recommended Orion installer `2.2.5_release.zip` (Chrome MV3).

## v2.2.4

- Added: YouTube CPU Tamer by AnimationFrame (CY Fung, MIT) adapted into the page-world runtime — throttles YouTube’s `setTimeout`/`setInterval` chatter via `requestAnimationFrame` to cut CPU and energy use on Orion iPhone.
- Preserved: FYP-owned timers (background-audio recovery, controls hold, DOM scans, caption retries) stay on pristine APIs so WebKit’s hidden-document rAF pause cannot stall playback recovery.
- Notes: Requires GPU/WebGL; if unavailable the tamer skips silently and the rest of the extension still runs. Do not also install the GreasyFork userscript alongside this build.
- Packaging: Numeric version `2.2.4`; recommended Orion installer `2.2.4_release.zip` (Chrome MV3).

## v2.2.3

- Fixed: Subtitles turn on again — single-track dedupe now waits until YouTube’s custom caption segments are visible before forcing TextTrack `hidden`/`disabled` modes. 2.2.2 applied that enforcement too early and blocked activation entirely.
- Fixed: WebKit `::cue` still hides only when YouTube’s custom caption segments exist; caption containers stay visible.
- Preserved: One active subtitle language when captions are on (authored English preferred); duplicate English rows stay collapsed in the Languages menu.
- Notes: Builds on 2.2.1 recovery (native masthead search restored; enlarged 5-button transport strip kept). Search UI and transport button composition were not changed.
- Packaging: Numeric version `2.2.3`; recommended Orion installer `2.2.3_release.zip` (Chrome MV3).

## v2.2.2

- Fixed: Exactly one subtitle language stays active — Orion no longer leaves English selected twice (duplicate authored rows / English+English) or paints double on-screen captions.
- Fixed: WebKit `::cue` still hides only when YouTube’s custom caption segments exist; caption containers stay visible.
- Notes: Builds on 2.2.1 recovery (native masthead search restored; enlarged 5-button transport strip kept). Search UI and which transport buttons appear were not changed.
- Packaging: Numeric version `2.2.2`; recommended Orion installer `2.2.2_release.zip` (Chrome MV3).

## v2.2.1

- Removed: Broken 2.1.5–2.2.0 custom search (Home chip, Watch pill, bottom capsule, masthead float, “Searching for something?” overlay, recents/autocomplete UI, skeleton FOUC loaders).
- Restored: 2.1.2-style native masthead mobile search (tap search icon → phone-width overlay). Ask YouTube / voice / AI chrome stays CSS-hidden only.
- Preserved: Enlarged centered transport strip (rewind / play-pause / forward / pip / fullscreen) with YouTube-like play/pause glyphs.
- Notes: Recovery build after 2.2.0 broke search/controls on Orion. Do not revive the reverted search experiments without user approval.
- Packaging: Numeric version `2.2.1`; recommended Orion installer `2.2.1_release.zip` (Chrome MV3).

## v2.2.0

- Changed: Home search is a half-width chip over the first feed video (not masthead top-right). Watch adds a rectangular search pill below the transport strip. Both open the same overlay.
- Changed: Search overlay opens with Lucide X, **“Searching for something?”**, then the input; translucent backdrop + ease-in/out; recents/suggestions kept. Ask YouTube / voice / AI search chrome stays stripped.
- Added: Shimmer skeleton placeholders matching the Home chip and Watch strip+pill footprint until the real UI mounts (prevents load jump / FOUC).
- Changed: Inline transport buttons are larger for easier taps; play/pause glyphs use YouTube-like filled triangle/bars synced to paused/playing.
- Packaging: Numeric version `2.2.0`; recommended Orion installer `2.2.0_release.zip` (Chrome MV3).
- Notes: **Superseded / reverted in 2.2.1** — custom search placements failed on Orion.

## v2.1.9

- Fixed: Search trigger is force-visible in the masthead search-icon slot (top-right Lucide Search) so it is no longer hidden under Orion’s bottom URL chrome.
- Fixed: Load jump / FOUC — critical CSS at `document_start` hides native search immediately; icon-only trigger stays at a stable fixed position.
- Removed: Speed timer and quality gear from the webpage transport strip (strip is rewind / play-pause / forward / pip / fullscreen only).
- Fixed: Native YouTube settings gear works again; FYP pointer capture is limited to `#fyp-…` / `[data-fyp-…]` nodes so player chrome is not blocked.
- Packaging: Numeric version `2.1.9`; recommended Orion installer `2.1.9_release.zip` (Chrome MV3).

## v2.1.8

- Changed: Combined release — inline Lucide quality gear + optional speed timer on the centered webpage transport strip (from 2.1.6) with the black Search capsule, Lucide overlay, recents, and YouTube autocomplete (from 2.1.7).
- Removed: In-player clock/gear overlays stay gone; native masthead search stays hidden.
- Preserved: Apply + 120ms retry for speed/quality; native CC captions; History/Now Playing.
- Packaging: Numeric version `2.1.8`; recommended Orion installer `2.1.8_release.zip`.

## v2.1.6

- Changed: Moved video quality (Lucide gear) into the centered webpage transport strip; removed the in-player gear overlay.
- Changed: Moved playback speed (Lucide timer) into the same strip; removed the in-player clock overlay.
- Preserved: Rewind / play-pause / forward / pip / fullscreen stay centered; quality/speed menus still use apply + 120ms retry; native CC captions unchanged.
- Packaging: Numeric version `2.1.6`; Orion test installer `2.1.6_inline-gear_test.zip` (also builds `2.1.6_release.zip`).

## v2.1.7

- Changed: Bottom black Search capsule trigger (centered Search label + Lucide search icon, no chevron) opens the global overlay on Home, Watch, History, and browse.
- Changed: Search overlay uses Lucide X (left), centered input, Lucide search (right), translucent backdrop, and ease-in/out animation; native masthead search stays hidden.
- Added: Under-field Recent searches (localStorage) and live YouTube autocomplete suggestions while typing; tapping a row runs the search.
- Notes: Originally landed on `fix/search-overlay-ui`; combined with inline gear in 2.1.8 on `fix/search-menus`.
- Packaging: The numeric manifest version is `2.1.7`, and the test Orion installer is `2.1.7_search-overlay_test.zip`.

## v2.1.5

- Changed: Webpage player strip is centered transport-only (rewind / play-pause / forward / pip / fullscreen); Captions and More were removed from that bar.
- Added: In-player Lucide timer (playback speed) and gear (video quality) overlays with the durable apply + 120ms retry pattern.
- Changed: Captions use native YouTube CC; caption deduplication still hides duplicate WebKit cues beside custom segments.
- Added: Global search overlay everywhere (Home, Watch, History, browse) — translucent backdrop, close on the left, submit on the right; native Ask/voice/AI search chrome stays hidden.
- Packaging: The numeric manifest version is `2.1.5`, and the recommended Orion installer is `2.1.5_release.zip`.

## v2.1.4

- Fixed: Captions and More dropdowns scroll on Orion/iOS (`overflow-y` + touch pan); option taps no longer block scrolling.
- Added: Lucide-style up-arrow collapse control at the top of Captions and More menus.
- Fixed: Captions use YouTube’s caption module only (no native subtitles-button fight); WebKit `::cue` hides only when custom caption segments exist.
- Fixed: More menu leads with a clear **Video quality** section populated from player levels (with a durable fallback ladder) using the same apply + 120ms retry as speed.
- Preserved: Seven-button toolbar, playback-speed options, History layout, and Now Playing sync from 2.1.3 / 2.1.2.
- Packaging: The numeric manifest version is `2.1.4`, and the recommended Orion installer is `2.1.4_release.zip`.

## v2.1.3

- Fixed: Caption and playback-speed menu options apply again on Orion; option taps no longer vanish via a ghost click that re-hits Captions/More under the closed menu.
- Added: The ⋮ More menu now includes a Quality section (Auto and available YouTube levels) using the same apply + 120ms retry pattern as playback speed.
- Changed: Player control capture uses `pointerdown` only when `PointerEvent` exists, matching the known-good speed interaction path.
- Preserved: Seven-button toolbar, caption deduplication, native player settings entry, History layout, and Now Playing sync from 2.1.2.
- Packaging: The numeric manifest version is `2.1.3`, and the recommended Orion installer is `2.1.3_release.zip`.

## v2.1.2

- Fixed: History feed rows no longer appear zoomed or scrambled; the History page is contained to the phone viewport and each list item stacks thumbnail-over-text.
- Fixed: History titles stay under the thumbnail (not cut off beside it), cards and filter chips are centered, and left/right gutters are equal Home-like 12px padding.
- Fixed: History channel logos are shown again next to the channel name.
- Preserved: History Clear / Pause / Manage / Search controls remain available above the list.
- Preserved: Home, subscriptions, channel pages, watch layout, Now Playing sync, and player controls are unchanged.
- Packaging: The numeric manifest version is `2.1.2`, and the recommended Orion installer is `2.1.2_release.zip`.

## v2.1.1

- Fixed: Lock Screen, Dynamic Island, and Now Playing play/pause now control the active video instead of fighting the in-page toolbar and background-audio recovery.
- Fixed: The isolated content fallback no longer steals Media Session handlers or restarts playback when the page runtime is already active.
- Fixed: Intentional Now Playing pauses are honored across background/visibility events, and the in-page play/pause icon stays in sync with the real media state.
- Packaging: The numeric manifest version is `2.1.1`, and the recommended Orion installer is `2.1.1_release_hotfix.zip`.

## v2.1.0 stable

- Added: Clicking a channel name, avatar, or other channel-root link now opens that channel's Videos tab first; direct channel-root visits are normalized the same way.
- Removed: Channel-page Shorts tabs, cards, and shelves are hidden while regular Videos and the rest of the native channel layout remain intact.
- Fixed: Now Playing metadata now reasserts both the current video title and channel whenever YouTube or Orion clears the text while leaving artwork behind.
- Fixed: Rewind, forward, captions, playback speed, PiP, fullscreen, and settings interactions preserve active playback instead of allowing a toolbar interaction to pause the video.
- Consolidated: Stable `2.1.0` includes the tested player toolbar, caption/speed menus, phone-width channel containment, horizontal viewport lock, background playback, and artwork work from the `2.1.4`–`2.1.8` beta series.
- Install note: Uninstall any `2.1.4`–`2.1.8` beta before installing stable `2.1.0`, because Orion compares the manifest versions numerically.
- Packaging: The stable numeric manifest version is `2.1.0`, and the recommended Orion installer is `2.1.0_release.zip`.

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
