#!/usr/bin/env bash
# One-command build of the headless DF+DFHack fixture image.
# Stages the MCP query scripts + the fixture save, then builds df-headless:53.15.
set -euo pipefail
cd "$(dirname "$0")"

# Bake the version-fragile query scripts so a host-side server can point DFHack
# here via DFHACK_MCP_QUERY_DIR=/opt/df/mcp-queries.
rm -rf mcp-queries && mkdir -p mcp-queries
cp ../src/dfhack-queries/*.lua mcp-queries/
echo "staged $(ls mcp-queries | wc -l) query scripts"

# Ensure the fixture save (a COMPRESSED world.sav) is present.
[ -f fixture/region1/world.sav ] || ./fetch-fixture.sh

docker build -t df-headless:53.15 .
echo "built df-headless:53.15 — run ./run-instances.sh <N> to launch forts"
