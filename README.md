# Fuck YouTube Premium

Fuck YouTube Premium is an Orion extension for iPhone and iPad. It loads desktop YouTube as the functional backend, then applies a phone-sized interface: a full-width inline player, a compact watch page, one-column feeds, and hamburger-only navigation. It also supports background audio and removes Shorts and the miniplayer. Use it alongside uBlock Origin for network ad blocking.

## Install on Orion for iOS

1. Download the latest zip to the **Downloads** folder in the Files app. Start with [fuck-youtube-premium-chrome-2.0.12.zip](fuck-youtube-premium-chrome-2.0.12.zip). If that build does not install, use [fuck-youtube-premium-firefox-2.0.12.zip](fuck-youtube-premium-firefox-2.0.12.zip).
2. Open **Orion → Settings → Extensions**.
3. Enable support for both **Chrome Extensions** and **Firefox Extensions**.
4. In Orion’s Extensions screen, tap **+**, then **Install from File**.
5. Open **Downloads** and select the zip. Do not unzip it first.
6. Enable **Fuck YouTube Premium** and allow access to YouTube if Orion asks.
7. Install or enable **uBlock Origin** in Orion and allow it to run on YouTube. uBlock Origin handles network ad blocking; this extension handles playback and layout.
8. Open [youtube.com](https://www.youtube.com/), enable **Request Desktop Website** in Orion’s website settings, and refresh the page.

The Chrome zip is recommended. The Firefox zip is provided as a fallback because extension installation behavior can vary between Orion releases. Keep uBlock Origin enabled alongside this extension.

## Extension menu and updates

Tap the extension icon in Orion to toggle a compact card over the current YouTube page. It shows the three highest-priority release notes and only two buttons:

- **Go to YouTube** opens desktop YouTube.
- **Check for updates** compares the installed version with the latest GitHub Release. When an update is available, the button downloads the correct Chrome or Firefox zip.

The extension checks GitHub periodically and shows an **UP** badge when a newer release exists. The icon deliberately has no WebExtension `default_popup`, because Orion iOS presents that surface as a full-page sheet. Orion does not permit a manually installed zip to silently replace itself, so the final installation step remains manual: download the new zip, remove the old extension, and install the new file.

### Release history policy

Old GitHub Releases and their downloads are always preserved. Whenever a new version becomes the latest release, every older release title is prefixed with **`[DEPRECATED]`** so users can immediately identify the current build without losing access to previous versions.

## Update

Remove the older copy from Orion, download the newest zip, and repeat the installation steps above. More troubleshooting is available in [INSTALL-ORION.md](INSTALL-ORION.md).

## Build from source

Run:

```bash
./rebuild-extension.sh
```

The build validates the generated JavaScript and writes the Chrome and Firefox packages to this folder.

Release history is maintained in [PATCH_NOTES.md](PATCH_NOTES.md). Agent and developer documentation is in [ARCHITECTURE.md](ARCHITECTURE.md), with current implementation history and handoff notes in [HANDOFF.md](HANDOFF.md).
