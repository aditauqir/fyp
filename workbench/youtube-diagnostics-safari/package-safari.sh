#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$ROOT/YouTube Diagnostics Safari"
PROJECT="$PROJECT_DIR/YouTube Diagnostics Safari.xcodeproj"
DERIVED_DATA="$(mktemp -d "${TMPDIR:-/tmp}/youtube-diagnostics-safari-derived.XXXXXX")"
OUTPUT="${1:-$ROOT/YouTube-Diagnostics-Safari-project.zip}"

cleanup() {
  rm -rf "$DERIVED_DATA"
}
trap cleanup EXIT

xcodebuild \
  -project "$PROJECT" \
  -scheme "YouTube Diagnostics Safari" \
  -configuration Debug \
  -sdk macosx \
  -destination 'platform=macOS' \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  DEVELOPMENT_TEAM= \
  CODE_SIGN_IDENTITY='' \
  -derivedDataPath "$DERIVED_DATA" \
  build

rm -f "$OUTPUT"
(
  cd "$ROOT"
  zip -X -r "$OUTPUT" "YouTube Diagnostics Safari" \
    -x 'YouTube Diagnostics Safari/.DS_Store' \
    -x 'YouTube Diagnostics Safari/**/.DS_Store' \
    >/dev/null
)

unzip -tqq "$OUTPUT"
echo "Packaged Safari Xcode project: $OUTPUT"
ls -lh "$OUTPUT"
