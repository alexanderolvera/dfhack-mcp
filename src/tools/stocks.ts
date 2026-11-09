import { runJsonScript } from '../query.ts';
import { z } from 'zod';
import type { ToolDef } from '../register.ts';

export interface CitizenRow {
  unit_id: number;
  name: string;
}

export interface Clothing {
  worn_citizens: CitizenRow[];
  worn_citizens_truncated: boolean;
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
  inventory: Record<string, number>;
  clothing: Clothing;
}

export async function stocks(category?: string): Promise<Stocks | { error: string }> {
  const data = await runJsonScript<Stocks>('stocks', category ? [category] : [], [
    'notable_low',
    'notable_high',
  ]);
  if ('error' in data) return data;
  if (data.clothing && !Array.isArray(data.clothing.worn_citizens)) {
    data.clothing.worn_citizens = [];
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
    'drink per dwarf per season. clothing reports the citizens wearing worn ' +
    '(wear >= 2 — "X" heavily-worn/threadbare, or "XX" tattered/mangled; DF\'s ' +
    'own 4-stage scale is item -> x-item-x -> X-item-X -> XX-item-XX -> ' +
    'destroyed) shoes/armor/pants/gloves/helm — a chronic, easy-to-miss stress ' +
    'source — and how many citizens currently have no shoes worn at all (a ' +
    'count, since the population involved is usually the whole fort). inventory ' +
    'gives the usable count (same filter as counts) of EVERY item type DF tracks, ' +
    'keyed by its df.item_type token (BAR, ROUGH, AMMO, BARREL, ...), zeros ' +
    'included; pass category (one such token) to narrow inventory to that type. ' +
    'Returns {"error":"no fort loaded"} if no fort is active.',
  shape: {
    category: z
      .string()
      .min(1)
      .optional()
      .describe(
        'A df.item_type token (case-insensitive), e.g. "DRINK", "BAR", "AMMO". ' +
          'Narrows inventory to that one type; omit for every type.'
      ),
  },
  run: ({ category }) => stocks(category),
};
