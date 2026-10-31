import { describe, expect, it } from 'vitest';
import type { Card, DeckSavePayload } from '@mtg/shared';
import { buildGame, type BuildPlayer } from '../src/game/build';
import { GameError } from '../src/game/state';
import { makeSet } from './helpers';

const set = makeSet();

function pool(prefix: string): Card[] {
  return set.cards.slice(0, 45).map((c, i) => ({ ...c, instanceId: `${prefix}-${i}` }));
}

function player(i: 0 | 1, deck?: Partial<DeckSavePayload>): BuildPlayer {
  const p = pool(`p${i}`);
  return {
    playerId: `id${i}`, name: `Player${i}`, pool: p,
    deck: { main: p.slice(0, 23).map((c) => c.instanceId), basics: { W: 0, U: 0, B: 0, R: 8, G: 9 }, ...deck },
  };
}

function build(seed = 1, basics = set.basics, players: [BuildPlayer, BuildPlayer] = [player(0), player(1)]) {
  return buildGame({ id: 'game1', roomId: 'room1', seed, now: 5, basics, players });
}

describe('buildGame', () => {
  it('builds 40-card decks with basics', () => {
    const g = build();
    for (const seat of [0, 1] as const) {
      const p = g.players[seat];
      const all = Object.values(g.cards).filter((c) => c.owner === seat);
      expect(all).toHaveLength(40);
      expect(p.zones.hand).toHaveLength(7);
      expect(p.zones.library).toHaveLength(33);
      expect(p.life).toBe(20);
    }
    const mine = Object.values(g.cards).filter((c) => c.owner === 0);
    expect(mine.filter((c) => c.card.name === 'Mountain')).toHaveLength(8);
    expect(mine.filter((c) => c.card.name === 'Forest')).toHaveLength(9);
  });

  it('rejects decks under 40', () => {
    const bad = player(0, { basics: { W: 0, U: 0, B: 0, R: 8, G: 8 } });
    expect(() => build(1, set.basics, [bad, player(1)])).toThrow('Deck must have at least 40 cards');
  });

  it('assigns gids before shuffling and shuffles with the seed', () => {
    const a = build(7);
    const b = build(7);
    const c = build(8);
    expect(a.players[0].zones.library).toEqual(b.players[0].zones.library);
    expect(a.players[0].zones.library).not.toEqual(c.players[0].zones.library);
    const gids = Object.keys(a.cards);
    expect(gids).toHaveLength(80);
    expect(new Set(gids).size).toBe(80);
    for (const gid of gids) expect(gid).toMatch(/^g\d+$/);
  });

  it('flips for first player and logs it', () => {
    const g = build(3);
    expect([0, 1]).toContain(g.firstPlayer);
    expect(g.log[0].text).toBe(`${g.players[g.firstPlayer].name} goes first`);
  });

  it('falls back to a text-only basic when the set lacks one', () => {
    const g = build(1, set.basics.filter((b) => b.name !== 'Forest'));
    const forests = Object.values(g.cards).filter((c) => c.owner === 0 && c.card.name === 'Forest');
    expect(forests).toHaveLength(9);
    for (const f of forests) expect(f.card.imageUrl).toBe('');
  });

  it('rejects main ids not in the pool', () => {
    const p = player(0);
    p.deck.main[0] = 'nope';
    expect(() => build(1, set.basics, [p, player(1)])).toThrow(new GameError('Deck contains cards that are not in your pool'));
  });
});
