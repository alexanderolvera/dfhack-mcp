# Headless DF 53.15 (free Linux classic) + DFHack 53.15-r2 serving Remote RPC,
# auto-loading a fixture fort. A disposable, parallelizable DF instance for the
# verification harness (spike #27). Build via ./build.sh (stages mcp-queries/ and
# fixture/ first). Run N of them with ./run-instances.sh.
FROM ubuntu:24.04

# DF/DFHack runtime + a REAL software-GL stack (the headless save-load advances
# via DF's SDL/GL render path, so Mesa DRI is required — not a dummy driver),
# Xvfb (virtual display), socat (RPC bridge), fetch tools.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl bzip2 \
      xvfb socat \
      libsdl2-2.0-0 libsdl2-image-2.0-0 \
      libgl1 libglu1-mesa libgl1-mesa-dri libglx-mesa0 \
      libstdc++6 libgcc-s1 zlib1g \
 && rm -rf /var/lib/apt/lists/*

ENV DF_DIR=/opt/df \
    XDG_DATA_HOME=/data \
    HOME=/data \
    DFHACK_HEADLESS=1 \
    DFHACK_DISABLE_CONSOLE=1 \
    DFHACK_PORT=5000
WORKDIR /opt/df

# DF 53.15 free Linux classic — no wrapper dir, extract as-is (dwarfort, data/, ...).
RUN curl -fSL https://www.bay12games.com/dwarves/df_53_15_linux.tar.bz2 | tar -xjf -
# DFHack 53.15-r2 Linux, extracted OVER the DF root (adds ./dfhack, hack/).
RUN curl -fSL https://github.com/DFHack/dfhack/releases/download/53.15-r2/dfhack-53.15-r2-Linux-64bit.tar.bz2 | tar -xjf -

# Mirror DFHack CI's init: silence sound, force a windowed SDL surface. PRINT_MODE
# stays DEFAULT (CI does NOT use TEXT).
RUN sed -i \
      -e 's/^\[SOUND:.*/[SOUND:NO]/' \
      -e 's/^\[WINDOWED:.*/[WINDOWED:YES]/' \
      -e 's/^\[WINDOWEDX:.*/[WINDOWEDX:1200]/' \
      -e 's/^\[WINDOWEDY:.*/[WINDOWEDY:800]/' \
      data/init/init_default.txt || true

# RPC stays bound to 127.0.0.1 (allow_remote:false). DFHack's RunCommand is
# localhost-only regardless, so a socat bridge (entrypoint) re-originates the
# external connection as local. Host publishes 127.0.0.1 only → never on the LAN.
RUN mkdir -p dfhack-config \
 && printf '{\n\t"allow_remote" : false,\n\t"port" : 5000\n}\n' > dfhack-config/remote-server.json

# Auto-load the fixture fort in-process at startup (ci/test.lua mouse-click nav).
COPY autoload.lua /opt/df/hack/scripts/autoload.lua
RUN mkdir -p dfhack-config/init && printf 'autoload\n' > dfhack-config/init/dfhack.init

# MCP query scripts, baked so a host server points DFHack here via
# DFHACK_MCP_QUERY_DIR=/opt/df/mcp-queries. Staged from src/dfhack-queries by build.sh.
COPY mcp-queries/ /opt/df/mcp-queries/

# The fixture fort. MUST be a COMPRESSED save (world.sav) — uncompressed saves
# stall the headless load at cur_step=1. Staged by fetch-fixture.sh. Last, so
# edits above don't re-invalidate the download/apt layers.
COPY ["fixture/region1", "/data/Bay 12 Games/Dwarf Fortress/save/region1"]

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 5001
ENTRYPOINT ["/entrypoint.sh"]
