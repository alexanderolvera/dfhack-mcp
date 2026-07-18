// stocks(): food/drink as days-of-supply plus a few critical materials.
// Thin wrapper over the STOCKS Lua query.

import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

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
  return runJsonScript<Stocks>('stocks', [], ['notable_low', 'notable_high']);
}

export const stocksDef: ToolDef = {
  name: 'stocks',
  title: 'Stocks',
  description:
    'Food and drink as estimated days-of-supply for the current population, plus ' +
    'counts of critical materials (wood, fuel, cloth, tanned hides, stone) and ' +
    'lists of notably low or high stocks. Days-of-supply assume ~2 food and ~5 ' +
    'drink per dwarf per season. Returns {"error":"no fort loaded"} if no fort is active.',
  run: stocks,
};
