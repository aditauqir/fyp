# Install Fuck YouTube Premium on Orion iOS — v2.0.15

Version **2.0.15** restores YouTube’s complete native comment list below the description and keeps player controls visible for four seconds after Play.

## Install this

**Prefer Chrome zip:**

`/Users/aditauqir/Downloads/userscript/fuck-youtube-premium-chrome-2.0.15.zip`

Firefox fallback:

`/Users/aditauqir/Downloads/userscript/fuck-youtube-premium-firefox-2.0.15.zip`

## Steps

1. Download the zip to the **Downloads** folder in the iOS Files app. Do not unzip it.
2. Open Orion → Settings → Extensions and enable both **Chrome Extensions** and **Firefox Extensions**.
3. **Uninstall** every older “YouTube Mobile for Orion” or “Fuck YouTube Premium” entry.
4. In Orion’s Extensions screen, tap **+** → **Install from File**.
5. Open **Downloads** and select the **Chrome** zip.
6. Enable **Fuck YouTube Premium** in Orion.
7. Install or enable **uBlock Origin** in Orion.
8. Allow both **Fuck YouTube Premium** and **uBlock Origin** to access YouTube.
9. Open `https://www.youtube.com`, open Orion’s website settings, and enable **Request Desktop Website**.
10. Hard-refresh, or close the tab and reopen it.

If the Chrome zip does not install, repeat the same steps with the Firefox zip.

Keep uBlock Origin enabled alongside this extension. uBlock Origin handles network ad blocking, while Fuck YouTube Premium handles Orion playback and the mobile-friendly YouTube layout.

## Updates

Tap the **Fuck YouTube Premium** extension icon and choose **Check for updates**. The extension also checks GitHub every six hours and shows an **UP** badge when a newer version exists.

If an update is available, download the offered zip, uninstall the current extension, and install the new zip from Downloads. Orion does not allow an installed zip to replace itself silently.

## What should be true after install

- Tap Play and the video remains inline above the title and comments.
- One tap on Play starts the video inline; fullscreen occurs only after tapping the player’s fullscreen control.
- The hamburger opens YouTube’s native drawer.
- There is no permanent Home/Shorts/Subscriptions icon column.
- Upload/Create is hidden.
- Watch content has a small mobile gutter and does not extend beyond either edge.
- Home and recommendation feeds use a phone-friendly single column.
- The extension icon opens a bottom-center panel with three priority changes and two large buttons.
- Comments use YouTube’s complete native list below the description.
- Player controls stay visible for four seconds after Play.
- uBlock Origin handles network ad blocking.

If these changes are missing, confirm the extension is enabled and allowed on youtube.com, and confirm **Request Desktop Website** is enabled. If Play invokes the native fullscreen controller, Orion’s app-level inline media setting is overriding the page; report the Orion/iOS version because a WebExtension cannot change its host app’s `WKWebViewConfiguration`.
