// stocks(): food/drink as days-of-supply plus a few critical materials.
// Thin wrapper over the STOCKS Lua query.

import { runJsonQuery } from '../query.ts';
import { STOCKS } from '../lua/queries.ts';

export interface Stocks {
  population: number;
  food_days: number;
  drink_days: number;
  notable_low: string[];
  notable_high: string[];
  counts: {
    food: number;
    prepared_meals: number;
    drink: number;
    wood: number;
    fuel: number;
    cloth: number;
    tanned_hides: number;
    stone: number;
  };
}

export function stocks(): Promise<Stocks | { error: string }> {
  return runJsonQuery<Stocks>(STOCKS, ['notable_low', 'notable_high']);
}
