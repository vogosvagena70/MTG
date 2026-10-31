import type { Card, Rarity, SetCards } from '@mtg/shared';
import type { Rng } from '../rng';

export function generatePack(set: SetCards, rng: Rng): Card[] {
  const by: Record<Rarity, Card[]> = { common: [], uncommon: [], rare: [], mythic: [] };
  for (const c of set.cards) by[c.rarity].push(c);

  const used = new Set<string>();
  const pack: Card[] = [];
  const take = (pools: Card[][]) => {
    for (const pool of pools) {
      const avail = pool.filter((c) => !used.has(c.name));
      if (avail.length > 0) {
        const c = avail[Math.floor(rng() * avail.length)];
        used.add(c.name);
        pack.push({ ...c });
        return;
      }
    }
    throw new Error('Not enough cards in set to build a pack');
  };

  const mythicSlot = by.mythic.length > 0 && rng() < 1 / 8;
  take(mythicSlot ? [by.mythic, by.rare, by.uncommon, by.common] : [by.rare, by.mythic, by.uncommon, by.common]);
  for (let i = 0; i < 3; i++) take([by.uncommon, by.common]);
  for (let i = 0; i < 10; i++) take([by.common]);
  if (set.basics.length > 0) pack.push({ ...set.basics[Math.floor(rng() * set.basics.length)] });
  else take([by.common]);
  return pack;
}
