import { describe, expect, it } from 'vitest';
import type { Card, DeckSavePayload } from '@mtg/shared';
import { buildGame, type BuildPlayer } from '../src/game/build';
import { applyAction, parseAction } from '../src/game/actions';
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

describe('applyAction', () => {
  const newGame = () => build(5);
  const last = (g: ReturnType<typeof newGame>) => g.log[g.log.length - 1].text;
  const nameOf = (g: ReturnType<typeof newGame>, gid: string) => g.cards[gid].card.name;

  it('draw moves from library top to hand and logs', () => {
    const g = newGame();
    const [a, b] = g.players[0].zones.library;
    const n = applyAction(g, 0, { type: 'draw', count: 2 }, 10);
    expect(n.players[0].zones.hand).toHaveLength(9);
    expect(n.players[0].zones.library).toHaveLength(31);
    expect(n.players[0].zones.hand.slice(-2)).toEqual([a, b]);
    expect(last(n)).toBe('Player0 drew 2 cards');
    expect(last(applyAction(g, 0, { type: 'draw', count: 1 }, 10))).toBe('Player0 drew 1 card');
  });

  it('draw with an empty library fails', () => {
    let g = newGame();
    for (let i = 0; i < 5; i++) g = applyAction(g, 0, { type: 'draw', count: 7 }, 1);
    expect(g.players[0].zones.library).toHaveLength(0);
    expect(() => applyAction(g, 0, { type: 'draw', count: 1 }, 1)).toThrow('Library is empty');
  });

  it('move hand→battlefield sets position, untapped, logs name', () => {
    const g = newGame();
    const gid = g.players[0].zones.hand[0];
    const n = applyAction(g, 0, { type: 'move', gid, to: 'battlefield', x: 120, y: -5 }, 10);
    expect(n.players[0].zones.battlefield).toEqual([gid]);
    expect(n.cards[gid]).toMatchObject({ x: 100, y: 0, tapped: false });
    expect(last(n)).toBe(`Player0 moved ${nameOf(g, gid)} to battlefield`);
  });

  it('reposition on battlefield is silent and keeps tapped', () => {
    let g = newGame();
    const gid = g.players[0].zones.hand[0];
    g = applyAction(g, 0, { type: 'move', gid, to: 'battlefield' }, 1);
    g = applyAction(g, 0, { type: 'tap', gid, tapped: true }, 2);
    const len = g.log.length;
    const n = applyAction(g, 0, { type: 'move', gid, to: 'battlefield', x: 10, y: 20 }, 3);
    expect(n.cards[gid]).toMatchObject({ x: 10, y: 20, tapped: true });
    expect(n.log).toHaveLength(len);
  });

  it('leaving the battlefield untaps; to library goes on top', () => {
    let g = newGame();
    const [h0, h1] = g.players[0].zones.hand;
    g = applyAction(g, 0, { type: 'move', gid: h0, to: 'battlefield' }, 1);
    g = applyAction(g, 0, { type: 'tap', gid: h0, tapped: true }, 2);
    g = applyAction(g, 0, { type: 'move', gid: h0, to: 'graveyard' }, 3);
    expect(g.cards[h0].tapped).toBe(false);
    g = applyAction(g, 0, { type: 'move', gid: h1, to: 'library' }, 4);
    expect(g.players[0].zones.library[0]).toBe(h1);
    expect(last(g)).toBe('Player0 put a card from their hand on top of their library');
  });

  it("cannot touch the opponent's cards or library cards", () => {
    const g = newGame();
    const theirs = g.players[1].zones.hand[0];
    expect(() => applyAction(g, 0, { type: 'move', gid: theirs, to: 'graveyard' }, 1)).toThrow(GameError);
    expect(() => applyAction(g, 0, { type: 'move', gid: g.players[0].zones.library[0], to: 'hand' }, 1)).toThrow('Card is not available');
  });

  it('tap requires a battlefield card', () => {
    const g = newGame();
    expect(() => applyAction(g, 0, { type: 'tap', gid: g.players[0].zones.hand[0], tapped: true }, 1)).toThrow(GameError);
  });

  it('untapAll, shuffle, mulligan', () => {
    let g = newGame();
    const gid = g.players[0].zones.hand[0];
    g = applyAction(g, 0, { type: 'move', gid, to: 'battlefield' }, 1);
    g = applyAction(g, 0, { type: 'tap', gid, tapped: true }, 1);
    g = applyAction(g, 0, { type: 'untapAll' }, 1);
    expect(g.cards[gid].tapped).toBe(false);
    expect(last(g)).toBe('Player0 untapped all');
    const before = [...g.players[0].zones.library].sort();
    const s = applyAction(g, 0, { type: 'shuffle' }, 2);
    expect([...s.players[0].zones.library].sort()).toEqual(before);
    expect(last(s)).toBe('Player0 shuffled their library');
    const m = applyAction(newGame(), 0, { type: 'mulligan' }, 2);
    expect(m.players[0].zones.hand).toHaveLength(7);
    expect(m.players[0].zones.library).toHaveLength(33);
    expect(last(m)).toBe('Player0 took a mulligan');
  });

  it('life and concede', () => {
    let g = newGame();
    g = applyAction(g, 0, { type: 'life', delta: 3 }, 1);
    expect(last(g)).toBe("Player0's life: 20 → 23");
    g = applyAction(g, 0, { type: 'life', delta: -20 }, 1);
    g = applyAction(g, 0, { type: 'life', delta: -5 }, 1);
    g = applyAction(g, 0, { type: 'life', delta: -2 }, 1);
    expect(g.players[0].life).toBe(-4);
    g = applyAction(g, 0, { type: 'concede' }, 2);
    expect(g.over).toEqual({ conceded: 0 });
    expect(last(g)).toBe('Player0 conceded');
    expect(() => applyAction(g, 1, { type: 'life', delta: 1 }, 3)).toThrow('Game is over');
  });

  it('log is capped at 100', () => {
    let g = newGame();
    for (let i = 0; i < 120; i++) g = applyAction(g, 0, { type: 'life', delta: 1 }, i);
    expect(g.log).toHaveLength(100);
    expect(g.log[99].text).toBe("Player0's life: 139 → 140");
  });

  it('does not mutate its input', () => {
    const g = newGame();
    const snap = () => JSON.stringify({ ...g, rng: undefined });
    const before = snap();
    applyAction(g, 0, { type: 'move', gid: g.players[0].zones.hand[0], to: 'battlefield', x: 5 }, 1);
    applyAction(g, 0, { type: 'mulligan' }, 1);
    expect(snap()).toBe(before);
  });

  it('parseAction rejects bad payloads', () => {
    for (const bad of [null, { type: 'draw', count: 0 }, { type: 'draw', count: 8 }, { type: 'life', delta: 0 },
      { type: 'life', delta: 21 }, { type: 'move', gid: 'g1', to: 'exile' }, { type: 'tap', gid: 1, tapped: true }]) {
      expect(() => parseAction(bad)).toThrow('Invalid action');
    }
    for (const ok of [{ type: 'draw', count: 3 }, { type: 'move', gid: 'g1', to: 'hand' },
      { type: 'move', gid: 'g1', to: 'battlefield', x: 1, y: 2 }, { type: 'tap', gid: 'g1', tapped: false },
      { type: 'life', delta: -20 }, { type: 'untapAll' }, { type: 'shuffle' }, { type: 'mulligan' }, { type: 'concede' }]) {
      expect(parseAction(ok)).toEqual(ok);
    }
  });
});
