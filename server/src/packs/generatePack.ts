import type { Card, Rarity, SetCards } from '@mtg/shared';
import { ScryfallError } from '../cards/client';
import type { Rng } from '../rng';

export function generatePack(set: SetCards, rng: Rng): Card[] {
  const by: Record<Rarity, Card[]> = { common: [], uncommon: [], rare: [], mythic: [] };
  for (const c of set.cards) by[c.rarity].push(c);

  const used = new Set<string>();
  const pack: Card[] = [];
  // Sets with an unusual rarity mix (e.g. bonus sets that are mostly rares) fill an empty slot from any rarity.
  const fallback = [by.common, by.uncommon, by.rare, by.mythic];
  const take = (pools: Card[][]) => {
    for (const pool of [...pools, ...fallback]) {
      const avail = pool.filter((c) => !used.has(c.name));
      if (avail.length > 0) {
        const c = avail[Math.floor(rng() * avail.length)];
        used.add(c.name);
        pack.push({ ...c });
        return;
      }
    }
    throw new ScryfallError('Not enough cards in set to build a pack');
  };

  const mythicSlot = by.mythic.length > 0 && rng() < 1 / 8;
  take(mythicSlot ? [by.mythic, by.rare, by.uncommon, by.common] : [by.rare, by.mythic, by.uncommon, by.common]);
  for (let i = 0; i < 3; i++) take([by.uncommon, by.common]);
  for (let i = 0; i < 10; i++) take([by.common]);
  if (set.basics.length > 0) pack.push({ ...set.basics[Math.floor(rng() * set.basics.length)] });
  else take([by.common]);
  return pack;
}
