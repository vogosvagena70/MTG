import { COLORS, type Card, type Color, type Rarity } from '@mtg/shared';
import type { Rng } from '../rng';

const RARITY_BASE: Record<Rarity, number> = { mythic: 4, rare: 3.5, uncommon: 2, common: 1 };
const REMOVAL = /destroy target|exile target|deals \d+ damage to (any target|target creature)|fights/i;
const COMMIT_AFTER = 5; // picks 6+ use color commitment
const JITTER = 0.3;

function isDualLand(card: Card): boolean {
  const symbols = new Set<string>();
  for (const line of card.oracleText.split('\n')) {
    if (!/\badd\b/i.test(line)) continue;
    for (const m of line.matchAll(/\{([WUBRG])\}/g)) symbols.add(m[1]);
  }
  return symbols.size >= 2;
}

export function baseScore(card: Card): number {
  let s = RARITY_BASE[card.rarity];
  if (card.typeLine.includes('Basic Land')) return s - 3;
  if (card.typeLine.includes('Creature')) s += 0.5;
  if (REMOVAL.test(card.oracleText)) s += 0.75;
  if (/\bLand\b/.test(card.typeLine) && !isDualLand(card)) s -= 1;
  return s;
}

export function committedColors(picks: Card[]): Color[] {
  const weight = Object.fromEntries(COLORS.map((c) => [c, 0])) as Record<Color, number>;
  for (const p of picks) for (const c of p.colors) weight[c] += RARITY_BASE[p.rarity];
  return [...COLORS]
    .sort((a, b) => weight[b] - weight[a]) // stable: ties keep WUBRG order
    .filter((c) => weight[c] > 0)
    .slice(0, 2);
}

export function botPick(pack: Card[], picks: Card[], rng: Rng): string {
  if (pack.length === 0) throw new Error('Cannot pick from an empty pack');
  const committed = picks.length >= COMMIT_AFTER ? committedColors(picks) : null;
  let best = pack[0];
  let bestScore = -Infinity;
  for (const card of pack) {
    let s = baseScore(card);
    if (committed) {
      const onColor = card.colors.length === 0 || card.colors.every((c) => committed.includes(c));
      s *= onColor ? 1.5 : 0.5;
    }
    s += rng() * 2 * JITTER - JITTER;
    if (s > bestScore) {
      bestScore = s;
      best = card;
    }
  }
  return best.instanceId;
}
