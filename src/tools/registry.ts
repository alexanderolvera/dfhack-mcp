import type { ToolDef } from '../register.ts';
import { artifactsAndEngravingsDef } from './artifacts.ts';
import { blueprintApplyDef, blueprintUndoDef } from './blueprint.ts';
import { chronicleDef } from './chronicle.ts';
import { citizenDef } from './citizen.ts';
import { defensesDef } from './defenses.ts';
import { environmentDef } from './environment.ts';
import { farmingDef } from './farming.ts';
import { findUnitDef } from './findUnit.ts';
import { fortHealthDef } from './fortHealth.ts';
import { fortStatusDef } from './fortStatus.ts';
import { gameDataDef } from './gameData.ts';
import { gameSaveDef } from './gameSave.ts';
import { geologyDef } from './geology.ts';
import { identifyDef } from './identify/index.ts';
import { injuriesAndHealthDef } from './injuriesAndHealth.ts';
import { jobsAndLaborDef } from './jobsAndLabor.ts';
import { livestockAndPasturesDef } from './livestockAndPastures.ts';
import { mapOverviewDef } from './mapOverview.ts';
import { mandatesAndJusticeDef } from './mandatesAndJustice.ts';
import { militaryDef } from './military.ts';
import { moodsDef } from './moods.ts';
import { noblesAndAdministratorsDef } from './noblesAndAdministrators.ts';
import { roomsAndZonesDef } from './roomsAndZones.ts';
import { runLuaDef } from './runLua.ts';
import { siteHistoryDef } from './siteHistory.ts';
import { stocksDef } from './stocks.ts';
import { threatsDef } from './threats.ts';
import { tileRegionDef } from './tileRegion.ts';
import { tradeDef } from './trade.ts';
import { unmetNeedsDef } from './unmetNeeds.ts';
import { assignWorkDetailDef, workDetailsDef } from './workDetail.ts';
import { wikiLookupDef } from './wikiLookup.ts';
import { wikiSearchDef } from './wikiSearch.ts';
import { workOrderCancelDef, workOrderCreateDef, workOrderListDef } from './workOrder.ts';

export const ALL_TOOLS: ToolDef[] = [
  artifactsAndEngravingsDef,
  assignWorkDetailDef,
  blueprintApplyDef,
  blueprintUndoDef,
  chronicleDef,
  citizenDef,
  defensesDef,
  environmentDef,
  farmingDef,
  findUnitDef,
  fortHealthDef,
  fortStatusDef,
  gameDataDef,
  gameSaveDef,
  geologyDef,
  identifyDef,
  injuriesAndHealthDef,
  jobsAndLaborDef,
  livestockAndPasturesDef,
  mapOverviewDef,
  mandatesAndJusticeDef,
  militaryDef,
  moodsDef,
  noblesAndAdministratorsDef,
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
  workDetailsDef,
  workOrderCancelDef,
  workOrderCreateDef,
  workOrderListDef,
];
