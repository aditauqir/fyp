# Install Fuck YouTube Premium on Orion iOS — v2.0.9

Version **2.0.9** completely disables fullscreen so Play remains inline, restores YouTube’s native viewport sizing, keeps only the hamburger drawer, and adds an extension menu with update checks.

## Install this

**Prefer Chrome zip:**

`/Users/aditauqir/Downloads/userscript/fuck-youtube-premium-chrome-2.0.9.zip`

Firefox fallback:

`/Users/aditauqir/Downloads/userscript/fuck-youtube-premium-firefox-2.0.9.zip`

## Steps

1. Download the zip to the **Downloads** folder in the iOS Files app. Do not unzip it.
2. Open Orion → Settings → Extensions and enable both **Chrome Extensions** and **Firefox Extensions**.
3. **Uninstall** every older “YouTube Mobile for Orion” or “Fuck YouTube Premium” entry.
4. In Orion’s Extensions screen, tap **+** → **Install from File**.
5. Open **Downloads** and select the **Chrome** zip.
6. Enable **Fuck YouTube Premium** in Orion.
7. Install or enable **uBlock Origin** in Orion.
8. Allow both **Fuck YouTube Premium** and **uBlock Origin** to access YouTube.
9. Open `https://www.youtube.com`.
10. Hard-refresh, or close the tab and reopen it.

If the Chrome zip does not install, repeat the same steps with the Firefox zip.

Keep uBlock Origin enabled alongside this extension. uBlock Origin handles network ad blocking, while Fuck YouTube Premium handles Orion playback and the mobile-friendly YouTube layout.

## Updates

Tap the **Fuck YouTube Premium** extension icon and choose **Check for updates**. The extension also checks GitHub every six hours and shows an **UP** badge when a newer version exists.

If an update is available, download the offered zip, uninstall the current extension, and install the new zip from Downloads. Orion does not allow an installed zip to replace itself silently.

## What should be true after install

- Tap Play and the video remains inline above the title and comments.
- The hamburger opens YouTube’s native drawer.
- There is no permanent Home/Shorts/Subscriptions icon column.
- Upload/Create is hidden.
- The page uses YouTube’s native viewport width without extension-added side padding.
- uBlock Origin handles network ad blocking.

If these changes are missing, confirm the extension is enabled and allowed on youtube.com.
