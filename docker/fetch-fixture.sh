#!/usr/bin/env bash
# Download DFHack's Dreamfort test fort into fixture/region1. Dreamfort ships as a
# COMPRESSED save (world.sav), which is REQUIRED — uncompressed saves stall the
# headless load. Mirrors DFHack ci/download-df.sh. Needs 7z (p7zip) on PATH.
set -euo pipefail
cd "$(dirname "$0")"

# Pin the exact archive so the same fixture -> the same fort state -> stable T2
# goldens. If DFFD ever replaces id=15434, this check fails loudly instead of
# silently building a different fort.
DREAMFORT_SHA256="06bf36bd01ca5a6d0e55bd5f80809916c4de43a447753ad4ed993baf79661fca"
dest="fixture/region1"
stamp="fixture/.dreamfort.sha256"

# A cached fixture is only trusted if it was extracted from the pinned archive.
if [ -f "$dest/world.sav" ] && [ -f "$stamp" ] && grep -q "$DREAMFORT_SHA256" "$stamp"; then
  echo "fixture already present and pinned: $dest"; exit 0
fi
[ -f "$dest/world.sav" ] && echo "WARNING: existing $dest is unpinned/mismatched — refetching"
command -v 7z >/dev/null || { echo "ERROR: need 7z (install p7zip / 7-Zip) to extract the save"; exit 1; }

mkdir -p fixture tmp
echo "downloading Dreamfort save..."
curl -fSL -A "Mozilla/5.0" -o tmp/dreamfort.7z \
  "https://dffd.bay12games.com/download.php?id=15434&f=dreamfort.7z"
got=$(sha256sum tmp/dreamfort.7z | cut -d' ' -f1)
if [ "$got" != "$DREAMFORT_SHA256" ]; then
  echo "ERROR: Dreamfort archive sha256 mismatch"; echo "  expected $DREAMFORT_SHA256"; echo "  got      $got"
  rm -rf tmp; exit 1
fi
7z x -y -otmp tmp/dreamfort.7z >/dev/null
rm -rf "$dest" && mv tmp/dreamfort "$dest"
echo "$DREAMFORT_SHA256  dreamfort.7z" > "$stamp"
rm -rf tmp
echo "fixture ready + pinned: $dest ($(du -sh "$dest" | cut -f1))"
echo "NOTE: to use your own fort instead, save it with [COMPRESSED_SAVES:YES] and drop it here as region1."
