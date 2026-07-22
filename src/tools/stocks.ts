import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface CitizenRow {
  unit_id: number;
  name: string;
}

export interface Clothing {
  tattered_citizens: CitizenRow[];
  tattered_citizens_truncated: boolean;
  no_shoes_count: number;
}

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
  clothing: Clothing;
}

export async function stocks(): Promise<Stocks | { error: string }> {
  const data = await runJsonScript<Stocks>('stocks', [], ['notable_low', 'notable_high']);
  if ('error' in data) return data;
  if (data.clothing && !Array.isArray(data.clothing.tattered_citizens)) {
    data.clothing.tattered_citizens = [];
  }
  return data;
}

export const stocksDef: ToolDef = {
  name: 'stocks',
  title: 'Stocks',
  description:
    'Food and drink as estimated days-of-supply for the current population, plus ' +
    'counts of critical materials (wood, fuel, cloth, tanned hides, stone) and ' +
    'lists of notably low or high stocks. Days-of-supply assume ~2 food and ~5 ' +
    "drink per dwarf per season. clothing reports the citizens wearing tattered " +
    '(wear >= 2, i.e. "XX" or worse) shoes/armor/pants/gloves/helm — a chronic, ' +
    'easy-to-miss stress source — and how many citizens currently have no shoes ' +
    'worn at all (a count, since the population involved is usually the whole ' +
    'fort). Returns {"error":"no fort loaded"} if no fort is active.',
  run: stocks,
};
