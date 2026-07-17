#!/bin/sh
# Boot headless DF under a virtual display, bridge RPC to the host, and let the
# in-process autoload (dfhack.init) load + pause the fixture fort.
set -eu

PORT="${DFHACK_PORT:-5000}"
echo "[entrypoint] XDG_DATA_HOME=$XDG_DATA_HOME  rpc_internal=$PORT  socat=${SOCAT_PORT:-5001}"

# Real virtual display for DF's SDL/GL renderer (24-bit, >= the 1200x800 window).
# The headless save-load advances via DF's actual render loop, so this + the Mesa
# DRI runtime are required (a dummy/suppressed display stalls the load at step 1).
Xvfb :99 -screen 0 1600x1200x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
export DISPLAY=:99

# Bridge external -> DFHack's localhost RPC. DFHack's RunCommand only accepts
# 127.0.0.1 clients, so socat re-originates the (Docker-mapped) connection as local.
socat "TCP-LISTEN:${SOCAT_PORT:-5001},fork,reuseaddr" TCP:127.0.0.1:5000 &
sleep 2

cd /opt/df
# DF stays the foreground process; its noisy keybinding/unicode startup spam goes
# to df-console.log, DFHack's own output to stderr.log. autoload logs there too.
exec ./dfhack >/opt/df/df-console.log 2>&1
