# Fuck YouTube Premium for Orion

[![iPhone only](https://img.shields.io/badge/iPhone-iOS%2017%2B-000000?logo=apple&logoColor=white)](https://apps.apple.com/us/app/orion-browser-by-kagi/id1484498200)
[![Orion Browser](https://img.shields.io/badge/Orion-Browser-14B86E?logo=safari&logoColor=white)](https://browser.kagi.com/)
[![uBlock Origin required](https://img.shields.io/badge/Required-uBlock%20Origin-800000?logo=ublockorigin&logoColor=white)](https://addons.mozilla.org/en-US/firefox/addon/ublock-origin/)
[![Download](https://img.shields.io/badge/Download-Latest%20Release-2EA44F?logo=github&logoColor=white)](https://github.com/aditauqir/fyp/releases/latest)

Firefox WebExtension fallback build for **Orion on iPhone only**.

## Install

1. [Install Orion Browser](https://apps.apple.com/us/app/orion-browser-by-kagi/id1484498200), then download `fuck-youtube-premium-firefox-2.0.17.zip` from the [latest release](https://github.com/aditauqir/fyp/releases/latest).
2. In Orion Settings, enable both Firefox and Chrome extensions.
3. Open Extensions, tap **+**, choose **Install from File**, and select the zip.
4. Install [uBlock Origin](https://addons.mozilla.org/en-US/firefox/addon/ublock-origin/) and allow both extensions to access YouTube.

## Behavior

- Video playback stays inline; fullscreen is disabled.
- The native hamburger opens YouTube’s drawer.
- Search opens in a usable phone-width field.
- The permanent mini-guide Home/Shorts/Subscriptions column is hidden.
- The extension icon opens **Go to YouTube** and **Check for updates**.

The Firefox popup and background files are the source shared with the Chrome build by `rebuild-extension.sh`. The complete illustrated installation and update guide is in the [project README](../README.md).
