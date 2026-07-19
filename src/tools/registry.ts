// The single collection point for every tool the server can expose. Each tool
// module owns its own ToolDef descriptor (name/title/description/schema/handler);
// this file just imports them and lists them in ALL_TOOLS. A new tool is one
// import + one array entry — both of which git can auto-merge, so sibling tool
// PRs no longer collide here. Entries are sorted ALPHABETICALLY BY TOOL NAME so
// insertions land at distinct positions. src/index.ts filters devOnly and registers
// the rest; scripts/verify.mjs derives the T0 expected set from this same array.

import type { ToolDef } from '../register.ts';
import { artifactsAndEngravingsDef } from './artifacts.ts';
import { chronicleDef } from './chronicle.ts';
import { citizenDef } from './citizen.ts';
import { defensesDef } from './defenses.ts';
import { findUnitDef } from './findUnit.ts';
import { fortStatusDef } from './fortStatus.ts';
import { gameDataDef } from './gameData.ts';
import { identifyDef } from './identify/index.ts';
import { injuriesAndHealthDef } from './injuriesAndHealth.ts';
import { jobsAndLaborDef } from './jobsAndLabor.ts';
import { mapOverviewDef } from './mapOverview.ts';
import { mandatesAndJusticeDef } from './mandatesAndJustice.ts';
import { militaryDef } from './military.ts';
import { moodsDef } from './moods.ts';
import { roomsAndZonesDef } from './roomsAndZones.ts';
import { runLuaDef } from './runLua.ts';
import { siteHistoryDef } from './siteHistory.ts';
import { stocksDef } from './stocks.ts';
import { threatsDef } from './threats.ts';
import { tileRegionDef } from './tileRegion.ts';
import { tradeDef } from './trade.ts';
import { unmetNeedsDef } from './unmetNeeds.ts';
import { wikiLookupDef } from './wikiLookup.ts';
import { wikiSearchDef } from './wikiSearch.ts';

// Alphabetical by tool name. run_lua carries devOnly:true; the caller filters it.
export const ALL_TOOLS: ToolDef[] = [
  artifactsAndEngravingsDef,
  chronicleDef,
  citizenDef,
  defensesDef,
  findUnitDef,
  fortStatusDef,
  gameDataDef,
  identifyDef,
  injuriesAndHealthDef,
  jobsAndLaborDef,
  mapOverviewDef,
  mandatesAndJusticeDef,
  militaryDef,
  moodsDef,
  roomsAndZonesDef,
  runLuaDef,
  siteHistoryDef,
  stocksDef,
  threatsDef,
  tileRegionDef,
  tradeDef,
  unmetNeedsDef,
  wikiLookupDef,
  wikiSearchDef,
];
