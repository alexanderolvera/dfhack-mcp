#!/usr/bin/env bash
# Launch N headless DF forts on host ports 5001..(5000+N), each an isolated
# DFHACK_PORT target so parallel agents each get their own disposable fort.
#   ./run-instances.sh [N] [live-query-dir]
#
# The baked-in query scripts are a BUILD-TIME snapshot. For a worktree with
# divergent Lua, pass that worktree's query dir as the 2nd arg to mount it
# read-only over the baked scripts, so the instance runs THAT worktree's code:
#   ./run-instances.sh 1 ../src/dfhack-queries
# For truly divergent parallel worktrees, run ONE instance per worktree with a
# distinct port/name — see docker/README.md ("Per-worktree isolation").
#
# seccomp=unconfined is required (DFHack's launcher disables ASLR via personality()).
set -euo pipefail
N="${1:-2}"
QUERY_DIR="${2:-}"

mount_args=()
if [ -n "$QUERY_DIR" ]; then
  abs=$(cd "$QUERY_DIR" && pwd)
  mount_args=(-v "${abs}:/opt/df/mcp-queries:ro")
  echo "mounting live query scripts: $abs -> /opt/df/mcp-queries (ro)"
fi

for i in $(seq 1 "$N"); do
  port=$((5000 + i)); name="df-fort-$i"
  docker rm -f "$name" >/dev/null 2>&1 || true
  MSYS_NO_PATHCONV=1 docker run -d --name "$name" \
    --security-opt seccomp=unconfined \
    -e TERM=xterm-256color \
    ${mount_args[@]+"${mount_args[@]}"} \
    -p "127.0.0.1:$port:5001" \
    df-headless:53.15 >/dev/null
  echo "started $name -> 127.0.0.1:$port (internal 5001)"
done
echo "forts finish loading in ~30-45s. Verify one with: ./verify-container.sh <port>"
