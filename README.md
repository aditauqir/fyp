# Fuck YouTube Premium

## For iOS and Orion Browser

[![iOS 17+](https://img.shields.io/badge/iOS%2017%2B-iPhone%20%26%20iPad-000000?style=for-the-badge&logo=apple&logoColor=white)](https://apps.apple.com/us/app/orion-browser-by-kagi/id1484498200)
[![Orion Browser](https://img.shields.io/badge/Orion-Browser-14B86E?style=for-the-badge&logo=safari&logoColor=white)](https://browser.kagi.com/)
[![uBlock Origin required](https://img.shields.io/badge/Required-uBlock%20Origin-800000?style=for-the-badge&logo=ublockorigin&logoColor=white)](https://addons.mozilla.org/en-US/firefox/addon/ublock-origin/)
[![Download latest release](https://img.shields.io/badge/Download-Latest%20Release-2EA44F?style=for-the-badge&logo=github&logoColor=white)](https://github.com/aditauqir/fyp/releases/latest)

Fuck YouTube Premium is built specifically for **Orion Browser on iPhone and iPad**. It loads desktop YouTube as the functional backend, then applies a phone-sized interface: a full-width inline player, a compact watch page, one-column feeds, a working mobile search field, and hamburger-only navigation. It also supports background audio and removes Shorts and the miniplayer. Use it alongside uBlock Origin for network ad blocking.

The badges above are powered by [Shields.io](https://github.com/badges/shields) and [Simple Icons](https://github.com/simple-icons/simple-icons).

## Install on Orion for iOS

1. [Download Orion Browser for iOS from the App Store](https://apps.apple.com/us/app/orion-browser-by-kagi/id1484498200). Orion currently requires iOS or iPadOS 17 or later.
2. Tap the green **Download Latest Release** button above, then download the latest zip to the **Downloads** folder in the Files app. Start with [fuck-youtube-premium-chrome-2.0.17.zip](fuck-youtube-premium-chrome-2.0.17.zip). If that build does not install, use [fuck-youtube-premium-firefox-2.0.17.zip](fuck-youtube-premium-firefox-2.0.17.zip).
3. Open **Orion → Settings → Extensions**.
4. Enable support for both **Chrome Extensions** and **Firefox Extensions**.
5. In Orion’s Extensions screen, tap **+**, then **Install from File**.
6. Open **Downloads** and select the zip. Do not unzip it first.
7. Enable **Fuck YouTube Premium** and allow access to YouTube if Orion asks.
8. Install [uBlock Origin from its official Firefox Add-ons listing](https://addons.mozilla.org/en-US/firefox/addon/ublock-origin/) in Orion, enable it, and allow it to run on YouTube. uBlock Origin handles network ad blocking; this extension handles playback and layout.
9. Open [youtube.com](https://www.youtube.com/), enable **Request Desktop Website** in Orion’s website settings, and refresh the page.

The Chrome zip is recommended. The Firefox zip is provided as a fallback because extension installation behavior can vary between Orion releases. **uBlock Origin is required and must stay enabled alongside this extension.** Its canonical source is the [official `gorhill/uBlock` repository](https://github.com/gorhill/uBlock).

## Final extension result

After the steps above, both **Fuck YouTube Premium** and **uBlock Origin** should be enabled in Orion:

<p align="center">
  <img src="docs/images/final-extension-result.png" alt="Orion Extensions screen with Fuck YouTube Premium and uBlock Origin enabled" width="420">
</p>

## Screenshots

| Inline YouTube watch page | Phone-friendly recommendation feed |
| --- | --- |
| <img src="docs/images/youtube-watch-page.png" alt="Fuck YouTube Premium inline watch page in Orion" width="390"> | <img src="docs/images/youtube-mobile-feed.png" alt="Fuck YouTube Premium one-column YouTube feed in Orion" width="390"> |

## Extension menu and updates

Tap the extension icon to open a bottom-center popup panel. It occupies roughly one-third of the phone screen, shows the three highest-priority release notes, and contains only two large buttons:

- **Go to YouTube** opens desktop YouTube.
- **Check for updates** compares the installed version with the latest GitHub Release. When an update is available, the button downloads the correct Chrome or Firefox zip.

The extension provides “OTA” update detection and downloads: it checks GitHub periodically and shows an **UP** badge when a newer release exists. Manual checks first ask the background update service and automatically fall back to a direct GitHub request if Orion has suspended it.

Due to Orion’s extension policies, a manually installed zip cannot silently replace itself. **Always install the downloaded update manually with `+` → `Install from File`**:

<p align="center">
  <img src="docs/images/orion-install-from-file.png" alt="Orion Extensions menu with Install from File selected for a manual OTA update" width="420">
</p>

After downloading the update, remove the old extension, choose **Install from File**, and select the new zip from Downloads.

### Release history policy

Old GitHub Releases and their downloads are always preserved. Whenever a new version becomes the latest release, every older release title is prefixed with **`[DEPRECATED]`** so users can immediately identify the current build without losing access to previous versions.

## Update

Remove the older copy from Orion, download the newest zip from [GitHub Releases](https://github.com/aditauqir/fyp/releases), and repeat the installation steps above. More troubleshooting is available in [INSTALL-ORION.md](INSTALL-ORION.md).

## Build from source

Run:

```bash
./rebuild-extension.sh
```

The build validates the generated JavaScript and writes the Chrome and Firefox packages to this folder.

Release history is maintained in [PATCH_NOTES.md](PATCH_NOTES.md). Agent and developer documentation is in [ARCHITECTURE.md](ARCHITECTURE.md), with current implementation history and handoff notes in [HANDOFF.md](HANDOFF.md).
