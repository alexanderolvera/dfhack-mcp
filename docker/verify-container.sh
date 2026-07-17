#!/usr/bin/env bash
# Run the MCP verify harness against a containerized fort.
#   ./verify-container.sh [host-port] [tier]      (defaults: 5001, tier 1)
# MSYS_NO_PATHCONV=1 stops Git Bash from mangling the /opt container path into a
# Windows path when it reaches node.exe. DFHACK_MCP_QUERY_DIR points the server at
# the query scripts baked INSIDE the container.
set -euo pipefail
port="${1:-5001}"; tier="${2:-1}"
cd "$(dirname "$0")/.."
MSYS_NO_PATHCONV=1 \
  DFHACK_HOST=127.0.0.1 DFHACK_PORT="$port" \
  DFHACK_MCP_QUERY_DIR=/opt/df/mcp-queries \
  node scripts/verify.mjs --tier="$tier"
