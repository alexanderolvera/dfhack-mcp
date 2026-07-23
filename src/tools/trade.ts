import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface DepotState {
  exists: boolean;
  accessible: boolean;
  complete: boolean;
  trader_requested: boolean;
}

export interface CaravanCiv {
  name?: string;
  race?: string;
}

export interface ManifestCategory {
  category: string;
  count: number;
}

export interface CaravanManifest {
  count: number;
  approx_value: number;
  by_category: ManifestCategory[];
  by_category_truncated: boolean;
}

export interface AgreementRow {
  category: string;
  entries: number;
  price_pct_min: number;
  price_pct_max: number;
}

export interface CaravanAgreements {
  export: AgreementRow[];
  export_truncated: boolean;
  import: AgreementRow[];
  import_truncated: boolean;
}

export interface CaravanRow {
  state: 'None' | 'Approaching' | 'AtDepot' | 'Leaving' | 'Stuck' | string;
  civ?: CaravanCiv;
  leaving_in_days?: number;
  manifest?: CaravanManifest;
  manifest_error?: string;
  agreements?: CaravanAgreements;
  agreements_error?: string;
}

export interface BrokerState {
  assigned: boolean;
  at_depot: boolean;
  name?: string;
  present?: boolean;
  current_job?: string;
}

export interface Trade {
  depot: DepotState;
  goods_at_depot: { count: number; approx_value: number };
  caravans: CaravanRow[];
  caravan_count: number;
  caravans_truncated: boolean;
  broker: BrokerState;
  alerts: string[];
}

export async function trade(): Promise<Trade | { error: string }> {
  const data = await runJsonScript<Trade>('trade', [], ['caravans', 'alerts']);
  if ('error' in data) return data;
  for (const row of data.caravans) {
    if (row.manifest && !Array.isArray(row.manifest.by_category)) row.manifest.by_category = [];
    if (row.agreements) {
      if (!Array.isArray(row.agreements.export)) row.agreements.export = [];
      if (!Array.isArray(row.agreements.import)) row.agreements.import = [];
    }
  }
  return data;
}

export const tradeDef: ToolDef = {
  name: 'trade',
  title: 'Trade and caravans',
  description:
    'The trade picture right now: whether a trade depot exists, is complete, and ' +
    "is wagon-accessible (DF's own pathability check, not merely built); which " +
    'caravans are present and their lifecycle state (none / approaching / at ' +
    'depot / leaving, with days remaining where knowable) and civ; whether a ' +
    'broker is assigned, present, at the depot, and their current job; and the ' +
    'count and approximate value of goods staged in the depot. Each caravan also ' +
    'reports manifest (count, approximate value, and a by-category breakdown of ' +
    "goods the caravan itself is carrying, before anything is unloaded to the " +
    'depot — distinct from goods_at_depot) and agreements (active liaison price ' +
    'agreements as price_pct_min/max, 100 = no markup, e.g. 200 = double price: ' +
    'export rows are items this fort earns a bonus selling to the caravan, by ' +
    "DF's item type; import rows are items this fort pays a premium buying from " +
    "the caravan, by DF's own request-tab category — a different, coarser " +
    'taxonomy than item type, so the two lists will not line up 1:1). If ' +
    "reading either one fails against a real caravan (a field-path or " +
    'calculation error, not simply "nothing to report"), that caravan\'s row ' +
    "carries manifest_error/agreements_error (the raw error string) instead of " +
    'the field, so a live check can tell a genuine bug apart from an empty ' +
    'result. Reports the state and the numbers, not what to trade. Returns ' +
    '{"error":"no fort loaded"} if no fort is active.',
  run: trade,
};
