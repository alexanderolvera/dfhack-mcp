import { ALL_TOOLS } from './tools/registry.ts';
import { isGatedOff } from './register.ts';

export const SURFACE_ACTUATORS_ON = ALL_TOOLS.filter((def) =>
  !isGatedOff(def, { DFHACK_MCP_ACTUATORS: '1' })
).length;
