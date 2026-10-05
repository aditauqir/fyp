<p align="center">
  <img src="docs/images/fyoutube-logo.png" alt="Fyoutube" width="220">
</p>

<h1 align="center">Fyoutube</h1>

<p align="center">
  <a href="https://apps.apple.com/us/app/orion-browser-by-kagi/id1484498200" title="Install Orion Browser on iPhone">
    <img src="https://skillicons.dev/icons?i=apple&theme=dark" alt="Apple iPhone" height="48">
  </a>
  <a href="https://github.com/aditauqir/fyp" title="View the project on GitHub">
    <img src="https://skillicons.dev/icons?i=github&theme=dark" alt="GitHub" height="48">
  </a>
</p>

<p align="center">
  <a href="https://browser.kagi.com/"><img src="https://img.shields.io/badge/Orion-Browser-14B86E?style=for-the-badge&logo=safari&logoColor=white" alt="Orion Browser"></a>
  <a href="https://github.com/aditauqir/fyp/releases/latest"><img src="https://img.shields.io/badge/Download-Latest%20Release-2EA44F?style=for-the-badge&logo=github&logoColor=white" alt="Download latest release"></a>
</p>

<p align="center">
  <a href="https://discord.gg/sd5Y8f7ukh"><img src="https://img.shields.io/badge/Discord-Join%20the%20server%20for%20support%20or%20help-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Join the Discord server for support or help"></a>
</p>

**Docs:** [Install](./INSTALL-ORION.md) · [Patch notes](./PATCH_NOTES.md) · [Architecture](./ARCHITECTURE.md) · [Handoff](./HANDOFF.md) · [Bug fixes](./BUG-FIXES.md) · [Agents](./AGENTS.md)

## What is this?

### Basically free YouTube Premium for iPhone

I built **Fyoutube** because I was fed up with the "premium" youtube apps that required YOU to pay? So what did I do? Asked cursor to cook me up an extension, and since Orion Browser supports browser extensions on iPhone, it was a win-win. Just that chrome extension translating to webkit is kinda iffy so somethings might break. This is made out of pure frustration and rage.

#### Wait, how does it work?
The extension loads desktop YouTube as its functional backend, then turns it into an iPhone-friendly interface with a full-width inline player, one-column feeds, mobile search, hamburger-only navigation, background playback, screen-off audio, and built-in YouTube ad blocking. This does not currently use any youtube api yet, but im working on it. It basically just rearranges stuff on the webpage by loading a desktop version of youtube. Also, the logo is hand-made.

This project is not affiliated with or endorsed by YouTube, Google, Orion, Kagi, or uBlock Origin. And I will never ask for your money. Plus feel free to fork this shit, I would love to see more things like this made :p

## iPhone only — Orion Browser

This extension is for iPhone. It is not made for iPad.

## Install on Orion for iOS (iPhone only)

Use these packages from the [latest GitHub Release](https://github.com/aditauqir/fyp/releases/latest):

| Package | Use |
| --- | --- |
| `*_release.zip` (example: `3.4.0_release.zip`) | Recommended install for Orion |
| `fyoutube-chrome-*.zip` | Chrome Manifest V3 fallback |
| `fyoutube-firefox-*.zip` | Firefox ZIP fallback |
| `fyoutube-orion-*.xpi` | XPI fallback |

Do not unzip the file. Do not rename the file.

### Before you install

1. On your iPhone, [install Orion Browser from the App Store](https://apps.apple.com/us/app/orion-browser-by-kagi/id1484498200).
2. Confirm that your iPhone uses iOS 17 or later.
3. If an older **Fyoutube** build is installed, uninstall that build.

### Install procedure

1. Open **Orion**.
2. Open **Settings → Extensions**.
3. Enable **Chrome Extensions**.
4. Enable **Firefox Extensions**.
5. Download the latest `*_release.zip` from [GitHub Releases](https://github.com/aditauqir/fyp/releases/latest).
6. Save the zip in **On My iPhone → Downloads**.
7. In **Extensions**, tap **+**.
8. Tap **Install from File**.
9. Select the `*_release.zip` file.
10. Enable **Fyoutube**.
11. Allow **Fyoutube** to access YouTube.
12. Open [youtube.com](https://www.youtube.com/).

### Notes after install

- You do not need uBlock Origin. This extension blocks YouTube ads.
- Do not set Orion **Request Desktop Website** for YouTube. The extension selects the YouTube backend.
- Orion iOS extension support is [still preliminary](https://help.kagi.com/orion/browser-extensions/ios-ipados-extensions.html).
- If the release zip does not install, use the Chrome ZIP, then the Firefox ZIP, then the XPI.

**Final extension result**

After the install procedure, **Fyoutube** must be enabled in Orion:

<p align="center">
  <img src="docs/images/final-extension-result.png" alt="Orion Extensions screen with Fyoutube enabled" width="420">
</p>

## Screenshots

<!-- Wide phone strip: swipe/scroll sideways when the row is wider than the pane -->
<p>
  <img src="docs/images/readme-home.jpg" height="420" alt="Home page" title="Home page" />
  <img src="docs/images/readme-search.jpg" height="420" alt="Search bar" title="Search bar" />
  <img src="docs/images/readme-player.jpg" height="420" alt="Player" title="Player" />
  <img src="docs/images/readme-airplay.jpg" height="420" alt="AirPlay" title="AirPlay" />
  <img src="docs/images/readme-background-play.jpg" height="420" alt="Background play" title="Background play" />
</p>

<sub>Home page</sub> · <sub>Search bar</sub> · <sub>Player</sub> · <sub>AirPlay</sub> · <sub>Background play</sub>

## Extension menu and updates

1. Tap the extension icon.
2. Read the three highest-priority release notes in the panel.
3. Tap **Go to YouTube** to open desktop YouTube.
4. Tap **Check for updates** to compare the installed version with the latest GitHub Release.

The extension also checks GitHub on a schedule. When a newer release exists, the icon shows an **UP** badge.

Orion does not replace a manually installed extension automatically. Use this update procedure:

1. Download the new release zip.
2. Uninstall the old **Fyoutube** extension.
3. Tap **+**.
4. Tap **Install from File**.
5. Select the new release zip.

<p align="center">
  <img src="docs/images/orion-install-from-file.png" alt="Orion Extensions menu with Install from File selected for a manual OTA update" width="420">
</p>

### Release history policy

Old GitHub Releases and their downloads stay available. The current release title is `Fyoutube <version>`. When a new version becomes the latest release, each older release title gets the prefix **`[DEPRECATED]`**.

## Update

1. Uninstall the older **Fyoutube** copy in Orion.
2. Download the newest release zip from [GitHub Releases](https://github.com/aditauqir/fyp/releases).
3. Repeat the install procedure above.

For more steps, see [INSTALL-ORION.md](INSTALL-ORION.md).

## Troubleshooting

### Do not enable Request Desktop Website

1. Open Orion site settings for YouTube.
2. Set **Request Desktop Website** to off.
3. Close the YouTube tab.
4. Open YouTube again.

Fyoutube already selects the desktop backend and then applies the phone layout. If Orion desktop mode stays on, the interface can enlarge or misalign.

### Captions appear twice or multiple languages are selected

Orion’s native **Subtitles → Languages** menu can leave more than one subtitle track selected:

<p align="center">
  <img src="docs/images/orion-multiple-subtitle-tracks.png" alt="Orion subtitle Languages menu showing duplicate English tracks" width="420">
</p>

From version 2.2.3 onward, the extension keeps one subtitle track active:

1. Prefer an authored English track.
2. If that track is missing, use English auto-generated captions.
3. If that track is missing, use the best remaining subtitle.

Duplicate English rows are collapsed. If you select another language, that language replaces the default. It does not add a second active track.

### Tapping the extension icon shows no buttons

1. Uninstall the Firefox/XPI build.
2. Install the latest `fyoutube-chrome-*.zip` or `*_release.zip`.
3. Enable the extension.
4. Allow YouTube access.
5. Tap the toolbar icon again.

The panel must show three changelog lines, **Go to YouTube**, and **Check for updates**. Keep the XPI only if Orion cannot install the Chrome package.

### Orion says the extension could not be installed

1. Close the YouTube tab in Orion.
2. Open **Orion → Settings → Extensions**.
3. Uninstall every older **Fyoutube** entry.
4. In Files, move the downloaded release zip from iCloud Drive to **On My iPhone → Downloads**.
5. Tap **+**.
6. Tap **Install from File**.
7. Select the local zip.
8. If Orion shows the error again, repeat steps 7–9 until Orion confirms the install.
9. Enable **Fyoutube**.
10. Allow YouTube access for **Fyoutube**.
11. Open YouTube again.

Do not unzip the file. Do not rename the file. [Orion’s issue tracker](https://orionfeedback.org/d/936-install-from-file-for-extensions/15) recommends device storage when iCloud permissions block install. If the release zip still fails, try the Orion ZIP or the XPI.

## Build from source

Run:

```bash
./rebuild-extension.sh
```

The build validates the generated JavaScript and writes the recommended Orion release ZIP plus Chrome, Firefox, Orion ZIP, and XPI fallbacks locally. Generated packages are ignored by Git and published through [GitHub Releases](https://github.com/aditauqir/fyp/releases), keeping the source tree clean.

## Credits

YouTube ad blocking in this extension adapts [Universal Ad Blocker Pro](https://greasyfork.org/en/scripts/561518-universal-ad-blocker-pro) by Gorstak (Goran Štambuk), released under the MIT License. This project uses the YouTube player, network, and overlay parts. It does not include blockers for Facebook, Twitter/X, Instagram, Reddit, or other sites from that script.

Release history is maintained in [PATCH_NOTES.md](PATCH_NOTES.md). Agent and developer documentation is in [ARCHITECTURE.md](ARCHITECTURE.md), with current implementation history and handoff notes in [HANDOFF.md](HANDOFF.md).

## Contributing

Want to improve the extension or fix a bug? Fork the repository and [send a pull request](https://github.com/aditauqir/fyp/compare).
