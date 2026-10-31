import { describe, expect, it } from 'vitest';
import { baseScore, botPick, committedColors } from '../src/bots/botPick';
import { mulberry32 } from '../src/rng';
import { makeCard } from './helpers';

const card = (id: string, over: Parameters<typeof makeCard>[0] = {}) => makeCard({ instanceId: id, ...over });

describe('baseScore', () => {
  it('judges double-faced cards by their front face only', () => {
    expect(baseScore(card('dfc', { typeLine: 'Instant // Land' }))).toBe(1);
  });

  it('uses rarity base', () => {
    expect(baseScore(card('a', { rarity: 'mythic' }))).toBe(4);
    expect(baseScore(card('a', { rarity: 'rare' }))).toBe(3.5);
    expect(baseScore(card('a', { rarity: 'uncommon' }))).toBe(2);
    expect(baseScore(card('a', { rarity: 'common' }))).toBe(1);
  });

  it('adds creature and removal bonuses', () => {
    expect(baseScore(card('a', { typeLine: 'Creature — Elf' }))).toBe(1.5);
    expect(baseScore(card('a', { typeLine: 'Instant', oracleText: 'Destroy target creature.' }))).toBe(1.75);
    expect(baseScore(card('a', { oracleText: 'Shock deals 2 damage to any target.' }))).toBe(1.75);
    expect(baseScore(card('a', { oracleText: 'Target creature you control fights target creature.' }))).toBe(1.75);
  });

  it('penalizes basics and utility lands but not dual lands', () => {
    expect(baseScore(card('a', { typeLine: 'Basic Land — Forest' }))).toBe(-2);
    expect(baseScore(card('a', { typeLine: 'Land', oracleText: '{T}: Add {C}.' }))).toBe(0);
    expect(baseScore(card('a', { typeLine: 'Land', oracleText: '{T}: Add {R} or {G}.' }))).toBe(1);
  });
});

describe('committedColors', () => {
  it('returns the two heaviest colors', () => {
    const picks = [
      card('1', { colors: ['R'], rarity: 'rare' }),
      card('2', { colors: ['G'] }),
      card('3', { colors: ['G'] }),
      card('4', { colors: ['U'] }),
    ];
    expect(committedColors(picks)).toEqual(['R', 'G']);
  });

  it('ignores colors with no weight', () => {
    expect(committedColors([card('1', { colors: ['B'] }), card('2', { colors: [] })])).toEqual(['B']);
  });
});

describe('botPick', () => {
  it('returns an id from the pack', () => {
    const pack = [card('x'), card('y'), card('z')];
    expect(['x', 'y', 'z']).toContain(botPick(pack, [], mulberry32(1)));
  });

  it('takes the strongest card early', () => {
    const pack = [card('common'), card('rare', { rarity: 'rare' }), card('common2')];
    for (let seed = 0; seed < 20; seed++) expect(botPick(pack, [], mulberry32(seed))).toBe('rare');
  });

  it('prefers on-color cards once committed (pick 6+)', () => {
    const picks = Array.from({ length: 5 }, (_, i) => card(`p${i}`, { colors: ['R'] }));
    const pack = [card('blueRare', { rarity: 'rare', colors: ['U'] }), card('redUnc', { rarity: 'uncommon', colors: ['R'] })];
    for (let seed = 0; seed < 20; seed++) expect(botPick(pack, picks, mulberry32(seed))).toBe('redUnc');
  });

  it('treats colorless cards as on-color', () => {
    const picks = Array.from({ length: 5 }, (_, i) => card(`p${i}`, { colors: ['R'] }));
    const pack = [card('blueRare', { rarity: 'rare', colors: ['U'] }), card('artifact', { rarity: 'uncommon', colors: [] })];
    // colorless uncommon 2*1.5 = 3 beats off-color rare 3.5*0.5 = 1.75 (jitter is only ±0.3)
    for (let seed = 0; seed < 20; seed++) expect(botPick(pack, picks, mulberry32(seed))).toBe('artifact');
  });

  it('is deterministic with a fixed seed', () => {
    const pack = Array.from({ length: 10 }, (_, i) => card(`c${i}`));
    expect(botPick(pack, [], mulberry32(5))).toBe(botPick(pack, [], mulberry32(5)));
  });

  it('throws on an empty pack', () => {
    expect(() => botPick([], [], mulberry32(1))).toThrow();
  });
});
