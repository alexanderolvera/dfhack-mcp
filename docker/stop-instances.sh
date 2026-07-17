#!/usr/bin/env bash
# Tear down all df-fort-* instances.
set -euo pipefail
names=$(docker ps -a --filter "name=df-fort-" --format '{{.Names}}')
[ -z "$names" ] && { echo "no df-fort-* instances running"; exit 0; }
echo "$names" | xargs -r docker rm -f
echo "stopped: $names"
