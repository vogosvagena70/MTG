import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/shared';
import { buildDecklist, colorGroup, deckSize, groupByColor, manaCurve } from '../src/lib/cards';

let n = 0;
const card = (over: Partial<Card> = {}): Card => ({
  instanceId: `i${++n}`, scryfallId: `s${n}`, name: `Card ${n}`, manaCost: '', manaValue: 2, colors: [],
  typeLine: 'Creature — Test', oracleText: '', rarity: 'common', imageUrl: '', ...over,
});
const noBasics = { W: 0, U: 0, B: 0, R: 0, G: 0 };

describe('colorGroup / groupByColor', () => {
  it('classifies mono, multi and colorless', () => {
    expect(colorGroup(card({ colors: ['R'] }))).toBe('R');
    expect(colorGroup(card({ colors: ['R', 'G'] }))).toBe('multi');
    expect(colorGroup(card())).toBe('colorless');
  });

  it('returns non-empty groups in WUBRG, multi, colorless order', () => {
    const groups = groupByColor([card(), card({ colors: ['G'] }), card({ colors: ['W', 'U'] }), card({ colors: ['W'] })]);
    expect(groups.map((g) => g.group)).toEqual(['W', 'G', 'multi', 'colorless']);
  });
});

describe('manaCurve', () => {
  it('buckets nonland cards 0..6+', () => {
    const curve = manaCurve([
      card({ manaValue: 0 }), card({ manaValue: 2 }), card({ manaValue: 2 }), card({ manaValue: 9 }),
      card({ manaValue: 0, typeLine: 'Land' }),
    ]);
    expect(curve).toEqual([1, 0, 2, 0, 0, 0, 1]);
  });
});

describe('deckSize / buildDecklist', () => {
  it('counts main cards plus basics', () => {
    expect(deckSize([card(), card()], { ...noBasics, R: 3 })).toBe(5);
  });

  it('formats main deck, basics merged by name, then sideboard', () => {
    const bolt = card({ name: 'Lightning Bolt' });
    const bolt2 = card({ name: 'Lightning Bolt' });
    const drafted = card({ name: 'Mountain', typeLine: 'Basic Land — Mountain' });
    const side = card({ name: 'Giant Growth' });
    const text = buildDecklist([bolt, bolt2, drafted], [side], { ...noBasics, R: 7, G: 1 });
    expect(text).toBe(['2 Lightning Bolt', '8 Mountain', '1 Forest', '', 'Sideboard', '1 Giant Growth'].join('\n'));
  });
});
