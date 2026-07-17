-- Headless auto-load of the first fortress save (DF 50+/Premium), run IN-PROCESS
-- via dfhack.init so its dfhack.timeout chain yields to DF's main loop across
-- frames — mirroring DFHack's own ci/test.lua (the method proven to load a fort
-- headless). The DF 50+/Premium title screen is MOUSE-driven, so we simulate
-- _MOUSE_L clicks on the top button (keyboard 'SELECT' does not navigate it) and
-- advance viewscreen_titlest.mode 0 -> 2 -> 3, then let DF's own loop run the load
-- and pause via resetDwarfmodeView(true). NOTE: the fixture must be a COMPRESSED
-- save (world.sav); uncompressed saves stall the load at cur_step=1.
local gui = require('gui')

local tick, MAX = 0, 1200

local function log(msg) print('[autoload tick=' .. tick .. '] ' .. msg) end

local function click_top(scr)
    local sw, sh = dfhack.screen.getWindowSize()
    df.global.gps.mouse_x = sw // 2
    df.global.gps.precise_mouse_x = df.global.gps.mouse_x * df.global.gps.tile_pixel_x
    df.global.gps.mouse_y = (sh < 60) and 25 or ((sh // 2) + 3)
    df.global.gps.precise_mouse_y = df.global.gps.mouse_y * df.global.gps.tile_pixel_y
    gui.simulateInput(scr, '_MOUSE_L')
end

local step
function step()
    tick = tick + 1
    if tick > MAX then log('GAVE UP') return end

    if df.global.gamemode == df.game_mode.DWARF then
        dfhack.gui.resetDwarfmodeView(true) -- pause on load
        log('DONE — fort loaded and paused, units=' .. #df.global.world.units.active)
        return
    end

    local title = dfhack.gui.getViewscreenByType(df.viewscreen_titlest, 0)
    if title and (title.mode == 0 or title.mode == 2 or title.mode == 3) then
        log('title mode=' .. title.mode .. ' -> click')
        click_top(title)
    end
    dfhack.timeout(5, 'frames', step)
end

log('autoload starting; gamemode=' .. tostring(df.global.gamemode))
dfhack.timeout(5, 'frames', step)
