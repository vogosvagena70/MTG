import { describe, expect, it } from 'vitest';
import { generatePack } from '../src/packs/generatePack';
import { mulberry32 } from '../src/rng';
import { makeSet } from './helpers';

describe('generatePack', () => {
  const set = makeSet();

  it('has 15 cards in the correct slot rarities', () => {
    const pack = generatePack(set, mulberry32(1));
    expect(pack).toHaveLength(15);
    expect(['rare', 'mythic']).toContain(pack[0].rarity);
    expect(pack.slice(1, 4).every((c) => c.rarity === 'uncommon')).toBe(true);
    expect(pack.slice(4, 14).every((c) => c.rarity === 'common')).toBe(true);
    expect(pack[14].typeLine).toContain('Basic Land');
  });

  it('never repeats a name within a pack', () => {
    for (let seed = 0; seed < 300; seed++) {
      const names = generatePack(set, mulberry32(seed)).map((c) => c.name);
      expect(new Set(names).size).toBe(15);
    }
  });

  it('returns copies, not the set objects', () => {
    const pack = generatePack(set, mulberry32(3));
    expect(set.cards).not.toContain(pack[1]);
  });

  it('opens a mythic about 1 in 8 packs', () => {
    const rng = mulberry32(99);
    let mythics = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) if (generatePack(set, rng)[0].rarity === 'mythic') mythics++;
    expect(mythics / n).toBeGreaterThan(0.09);
    expect(mythics / n).toBeLessThan(0.16);
  });

  it('always opens a rare when the set has no mythics', () => {
    const noMythic = makeSet({ common: 30, uncommon: 10, rare: 5, mythic: 0 });
    for (let seed = 0; seed < 50; seed++) expect(generatePack(noMythic, mulberry32(seed))[0].rarity).toBe('rare');
  });

  it('falls back to lower rarities when a pool is too small', () => {
    const tiny = makeSet({ common: 20, uncommon: 2, rare: 0, mythic: 0 });
    const pack = generatePack(tiny, mulberry32(5));
    expect(pack).toHaveLength(15);
    const nonBasic = pack.slice(0, 14);
    expect(nonBasic.filter((c) => c.rarity === 'uncommon')).toHaveLength(2);
    expect(nonBasic.filter((c) => c.rarity === 'common')).toHaveLength(12);
  });

  it('uses a common for the basic slot when the set has no basics', () => {
    const noBasics = { ...makeSet(), basics: [] };
    const pack = generatePack(noBasics, mulberry32(8));
    expect(pack).toHaveLength(15);
    expect(pack[14].rarity).toBe('common');
  });

  it('fills slots from other rarities when a set is mostly rares', () => {
    const pack = generatePack(makeSet({ common: 1, uncommon: 13, rare: 63, mythic: 0 }), mulberry32(1));
    expect(pack.filter((c) => !c.typeLine.includes('Basic Land'))).toHaveLength(14);
    expect(new Set(pack.map((c) => c.name)).size).toBe(pack.length);
  });

  it('throws when there are not enough cards', () => {
    expect(() => generatePack(makeSet({ common: 5, uncommon: 0, rare: 0, mythic: 0 }), mulberry32(1)))
      .toThrow('Not enough cards in set to build a pack');
  });
});
