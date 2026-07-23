# Fuck YouTube Premium

Fuck YouTube Premium is an Orion extension for iPhone and iPad that makes desktop YouTube easier to use on iOS. It keeps video inline, supports background audio and user-triggered Picture in Picture, removes Shorts and the miniplayer, and provides a mobile-friendly layout. Use it alongside uBlock Origin for network ad blocking.

## Install on Orion for iOS

1. Download the latest zip to the **Downloads** folder in the Files app. Start with [fuck-youtube-premium-chrome-2.0.8.zip](fuck-youtube-premium-chrome-2.0.8.zip). If that build does not install, use [fuck-youtube-premium-firefox-2.0.8.zip](fuck-youtube-premium-firefox-2.0.8.zip).
2. Open **Orion → Settings → Extensions**.
3. Enable support for both **Chrome Extensions** and **Firefox Extensions**.
4. In Orion’s Extensions screen, tap **+**, then **Install from File**.
5. Open **Downloads** and select the zip. Do not unzip it first.
6. Enable **Fuck YouTube Premium** and allow access to YouTube if Orion asks.
7. Install or enable **uBlock Origin** in Orion and allow it to run on YouTube. uBlock Origin handles network ad blocking; this extension handles playback and layout.
8. Open [youtube.com](https://www.youtube.com/) and refresh the page.

The Chrome zip is recommended. The Firefox zip is provided as a fallback because extension installation behavior can vary between Orion releases. Keep uBlock Origin enabled alongside this extension.

## Update

Remove the older copy from Orion, download the newest zip, and repeat the installation steps above. More troubleshooting is available in [INSTALL-ORION.md](INSTALL-ORION.md).

## Build from source

Run:

```bash
./rebuild-extension.sh
```

The build validates the generated JavaScript and writes the Chrome and Firefox packages to this folder.
