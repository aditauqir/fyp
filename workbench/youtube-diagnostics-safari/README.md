# YouTube Diagnostics Safari

This is the macOS Safari Web Extension version of the YouTube Diagnostics Workbench. It captures the same YouTube DOM, console, navigation, media lifecycle, FYP marker, and WebKit playback state as the Chromium helper.

## Install for local testing

1. Open `YouTube Diagnostics Safari/YouTube Diagnostics Safari.xcodeproj` in Xcode.
2. Select the **YouTube Diagnostics Safari** app target, open **Signing & Capabilities**, and choose your Apple Development team. Keep the generated bundle identifier unless Xcode asks you to make it unique.
3. Select the **YouTube Diagnostics Safari** scheme and press **Run** (`⌘R`). This builds and launches the small host app that contains the Safari extension.
4. In Safari, open **Safari → Settings → Extensions**, enable **YouTube Diagnostics Safari**, and allow it to access YouTube when prompted.
5. Open or reload YouTube, click the extension button in Safari's toolbar, and use **Capture DOM + code**, **Pause capture**, **Download JSONL**, and **Clear logs** from the popup.

The command-line build can verify the project with `CODE_SIGNING_ALLOWED=NO`, but Safari will not install an unsigned command-line artifact. Running from Xcode with your development team performs the local signing Safari requires.

The extension does not upload logs. Review downloaded JSONL/HTML before sharing because page titles, URLs, console arguments, and DOM text can contain sensitive information.
