import type { ToolDef } from '../register.ts';
import { artifactsAndEngravingsDef } from './artifacts.ts';
import { blueprintApplyDef, blueprintUndoDef } from './blueprint.ts';
import { burrowsDef, civilianAlertDef } from './burrows.ts';
import { chronicleDef } from './chronicle.ts';
import { citizenDef } from './citizen.ts';
import { defensesDef } from './defenses.ts';
import { environmentDef } from './environment.ts';
import { farmingDef } from './farming.ts';
import { findUnitDef } from './findUnit.ts';
import { fluidsDef } from './fluids.ts';
import { fortHealthDef } from './fortHealth.ts';
import { fortStatusDef } from './fortStatus.ts';
import { gameDataDef } from './gameData.ts';
import { gameSaveDef } from './gameSave.ts';
import { geologyDef } from './geology.ts';
import { haulingRoutesDef } from './haulingRoutes.ts';
import { identifyDef } from './identify/index.ts';
import { injuriesAndHealthDef } from './injuriesAndHealth.ts';
import { jobsAndLaborDef } from './jobsAndLabor.ts';
import { livestockAndPasturesDef } from './livestockAndPastures.ts';
import { mandatesAndJusticeDef } from './mandatesAndJustice.ts';
import { mapOverviewDef } from './mapOverview.ts';
import { mechanismsDef, pullLeverDef } from './mechanisms.ts';
import { militaryDef } from './military.ts';
import { moodsDef } from './moods.ts';
import { noblesAndAdministratorsDef } from './noblesAndAdministrators.ts';
import { petitionsDef } from './petitions.ts';
import { roomsAndZonesDef } from './roomsAndZones.ts';
import { runLuaDef } from './runLua.ts';
import { siteHistoryDef } from './siteHistory.ts';
import { stockpilesDef } from './stockpiles.ts';
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
  burrowsDef,
  chronicleDef,
  citizenDef,
  civilianAlertDef,
  defensesDef,
  environmentDef,
  farmingDef,
  findUnitDef,
  fluidsDef,
  fortHealthDef,
  fortStatusDef,
  gameDataDef,
  gameSaveDef,
  geologyDef,
  haulingRoutesDef,
  identifyDef,
  injuriesAndHealthDef,
  jobsAndLaborDef,
  livestockAndPasturesDef,
  mandatesAndJusticeDef,
  mapOverviewDef,
  mechanismsDef,
  militaryDef,
  moodsDef,
  noblesAndAdministratorsDef,
  petitionsDef,
  pullLeverDef,
  roomsAndZonesDef,
  runLuaDef,
  siteHistoryDef,
  stockpilesDef,
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
