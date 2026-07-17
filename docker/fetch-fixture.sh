#!/usr/bin/env bash
# Download DFHack's Dreamfort test fort into fixture/region1. Dreamfort ships as a
# COMPRESSED save (world.sav), which is REQUIRED — uncompressed saves stall the
# headless load. Mirrors DFHack ci/download-df.sh. Needs 7z (p7zip) on PATH.
set -euo pipefail
cd "$(dirname "$0")"

dest="fixture/region1"
if [ -f "$dest/world.sav" ]; then echo "fixture already present: $dest"; exit 0; fi
command -v 7z >/dev/null || { echo "ERROR: need 7z (install p7zip / 7-Zip) to extract the save"; exit 1; }

mkdir -p fixture tmp
echo "downloading Dreamfort save..."
curl -fSL -A "Mozilla/5.0" -o tmp/dreamfort.7z \
  "https://dffd.bay12games.com/download.php?id=15434&f=dreamfort.7z"
7z x -y -otmp tmp/dreamfort.7z >/dev/null
rm -rf "$dest" && mv tmp/dreamfort "$dest"
rm -rf tmp
echo "fixture ready: $dest ($(du -sh "$dest" | cut -f1))"
echo "NOTE: to use your own fort instead, save it with [COMPRESSED_SAVES:YES] and drop it here as region1."
