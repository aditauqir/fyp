# Install Fuck YouTube Premium on Orion iOS — v2.0.8

Version **2.0.8** keeps the stable 2.0.7 startup, prevents a normal Play tap from opening fullscreen, and removes compounded viewport padding that cut off the right side of YouTube.

## Install this

**Prefer Chrome zip:**

`/Users/aditauqir/Downloads/userscript/fuck-youtube-premium-chrome-2.0.8.zip`

Firefox fallback:

`/Users/aditauqir/Downloads/userscript/fuck-youtube-premium-firefox-2.0.8.zip`

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

## What should be true after install

- Title / like row have clear side padding (not flush to the screen).
- Upload / Create header button gone.
- Tap play keeps the **normal** watch layout (video + title + comments), not system fullscreen.
- Ads are hidden/skipped more aggressively (Chrome zip also uses network block rules).

If padding still looks unchanged, the extension is not active on the tab — check Extensions list is enabled and allowed on youtube.com.
