#!/usr/bin/env bash
# Tear down the df-fort-N instances launched by run-instances.sh.
# Docker's name= filter is a substring match, so filter to EXACTLY df-fort-<n>
# here to avoid nuking an unrelated container whose name merely contains it.
set -euo pipefail
names=$(docker ps -a --format '{{.Names}}' | grep -E '^df-fort-[0-9]+$' || true)
[ -z "$names" ] && { echo "no df-fort-<n> instances running"; exit 0; }
echo "$names" | xargs -r docker rm -f
echo "stopped: $names"
