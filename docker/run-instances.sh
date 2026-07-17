#!/usr/bin/env bash
# Launch N headless DF forts on host ports 5001..(5000+N), each an isolated
# DFHACK_PORT target so parallel agents each get their own disposable fort.
# seccomp=unconfined is required (DFHack's launcher disables ASLR via personality()).
set -euo pipefail
N="${1:-2}"
for i in $(seq 1 "$N"); do
  port=$((5000 + i)); name="df-fort-$i"
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" \
    --security-opt seccomp=unconfined \
    -e TERM=xterm-256color \
    -p "127.0.0.1:$port:5001" \
    df-headless:53.15 >/dev/null
  echo "started $name -> 127.0.0.1:$port (internal 5001)"
done
echo "forts finish loading in ~30-45s. Verify one with: ./verify-container.sh <port>"
