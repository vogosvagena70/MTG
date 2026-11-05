import { describe, expect, it } from 'vitest';
import type { Card, DeckSavePayload } from '@mtg/shared';
import { buildGame, type BuildPlayer } from '../src/game/build';
import { applyAction, parseAction } from '../src/game/actions';
import { gameViewFor } from '../src/game/view';
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

  it('a move to the zone the card is already in is a silent no-op', () => {
    const g = newGame();
    const gid = g.players[0].zones.hand[0];
    const n = applyAction(g, 0, { type: 'move', gid, to: 'hand' }, 9);
    expect(n.players[0].zones).toEqual(g.players[0].zones);
    expect(n.log).toEqual(g.log);
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

  it('untapAll, shuffle', () => {
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
    applyAction(g, 0, { type: 'shuffle' }, 1);
    expect(snap()).toBe(before);
  });

  it('parseAction rejects bad payloads', () => {
    for (const bad of [null, { type: 'draw', count: 0 }, { type: 'draw', count: 8 }, { type: 'life', delta: 0 },
      { type: 'life', delta: 21 }, { type: 'move', gid: 'g1', to: 'sideboard' }, { type: 'tap', gid: 1, tapped: true }]) {
      expect(() => parseAction(bad)).toThrow('Invalid action');
    }
    for (const ok of [{ type: 'draw', count: 3 }, { type: 'move', gid: 'g1', to: 'hand' },
      { type: 'move', gid: 'g1', to: 'battlefield', x: 1, y: 2 }, { type: 'tap', gid: 'g1', tapped: false },
      { type: 'life', delta: -20 }, { type: 'untapAll' }, { type: 'shuffle' }, { type: 'concede' }]) {
      expect(parseAction(ok)).toEqual(ok);
    }
    expect(() => parseAction({ type: 'mulligan' })).toThrow(GameError);
  });
});

describe('gameViewFor', () => {
  it('shows my hand and counts for the opponent, with connection status', () => {
    let g = build(5);
    const bobCard = g.players[1].zones.hand[0];
    g = applyAction(g, 1, { type: 'move', gid: bobCard, to: 'battlefield', x: 10, y: 20 }, 2);
    g = applyAction(g, 0, { type: 'draw', count: 1 }, 3);
    const v = gameViewFor(g, 0, [true, false]);
    expect(v.gameId).toBe('game1');
    expect(v.you).toBe(0);
    expect(v.me.name).toBe('Player0');
    expect(v.me.life).toBe(20);
    expect(v.me.hand).toHaveLength(8);
    expect(v.me.hand[0]).toEqual(g.cards[g.players[0].zones.hand[0]]);
    expect(v.me.libraryCount).toBe(32);
    expect(v.opp.name).toBe('Player1');
    expect(v.opp.connected).toBe(false);
    expect(v.opp.handCount).toBe(6);
    expect(v.opp.libraryCount).toBe(33);
    expect(v.opp.battlefield.map((c) => c.gid)).toEqual([bobCard]);
    expect(v.opp.battlefield[0]).toMatchObject({ x: 10, y: 20, owner: 1 });
    expect(v.log).toEqual(g.log);
  });

  it('never leaks opponent hand or any library gid', () => {
    const g = build(9);
    const json = JSON.stringify(gameViewFor(g, 0, [true, true]));
    for (const gid of [...g.players[1].zones.hand, ...g.players[0].zones.library, ...g.players[1].zones.library]) {
      expect(json).not.toContain(`"${gid}"`);
    }
    expect(json).not.toContain('"gid":"' + g.players[1].zones.hand[0] + '"');
    const v1 = gameViewFor(g, 1, [false, true]);
    expect(v1.you).toBe(1);
    expect(v1.opp.connected).toBe(false);
    expect(v1.me.hand.map((c) => c.gid)).toEqual(g.players[1].zones.hand);
  });

  it('returns copies of arrays, not the state arrays', () => {
    const g = build(4);
    const v = gameViewFor(g, 0, [true, true]);
    expect(v.me.hand).not.toBe(g.players[0].zones.hand);
    expect(v.me.battlefield).not.toBe(g.players[0].zones.battlefield);
    expect(v.log).not.toBe(g.log);
  });

  it('reports over and the state firstPlayer', () => {
    let g = build(3);
    g = applyAction(g, 1, { type: 'concede' }, 4);
    const v = gameViewFor(g, 0, [true, true]);
    expect(v.over).toEqual({ conceded: 1 });
    expect(v.firstPlayer).toBe(g.firstPlayer);
  });
});

describe('counters', () => {
  const onField = () => {
    const g = build();
    const gid = g.players[0].zones.hand[0];
    return { gid, g: applyAction(g, 0, { type: 'move', gid, to: 'battlefield', x: 10, y: 10 }, 6) };
  };

  it('tracks regular counters and never lets them go below 0', () => {
    const start = onField();
    const gid = start.gid;
    let g = applyAction(start.g, 0, { type: 'counters', gid, delta: 3 }, 7);
    g = applyAction(g, 0, { type: 'counters', gid, delta: -1 }, 8);
    expect(g.cards[gid].counters).toBe(2);
    expect(g.cards[gid].ptCounters).toEqual({ power: 0, toughness: 0 });
    expect(g.log.at(-1)!.text).toBe(`Player0: ${g.cards[gid].card.name} counters 3 → 2`);
    expect(() => applyAction(g, 0, { type: 'counters', gid, delta: -3 }, 9)).toThrow('No counters to remove');
  });

  it('keeps a running total of any power/toughness amounts', () => {
    const start = onField();
    const gid = start.gid;
    let g = applyAction(start.g, 0, { type: 'ptCounters', gid, power: 1, toughness: 1 }, 7);
    expect(g.log.at(-1)!.text).toBe(`Player0: ${g.cards[gid].card.name} is now +1/+1`);
    g = applyAction(g, 0, { type: 'ptCounters', gid, power: 2, toughness: 0 }, 8);
    expect(g.cards[gid].ptCounters).toEqual({ power: 3, toughness: 1 });
    expect(g.log.at(-1)!.text).toBe(`Player0: ${g.cards[gid].card.name} is now +3/+1`);
    g = applyAction(g, 0, { type: 'ptCounters', gid, power: 2, toughness: 0 }, 9);
    expect(g.cards[gid].ptCounters).toEqual({ power: 5, toughness: 1 });
    g = applyAction(g, 0, { type: 'ptCounters', gid, power: -6, toughness: -3 }, 10);
    expect(g.cards[gid].ptCounters).toEqual({ power: -1, toughness: -2 });
    expect(g.log.at(-1)!.text).toBe(`Player0: ${g.cards[gid].card.name} is now -1/-2`);
    expect(gameViewFor(g, 1, [true, true]).opp.battlefield[0].ptCounters).toEqual({ power: -1, toughness: -2 });
    expect(g.cards[gid].counters).toBe(0);
  });

  it('caps totals so a badge stays readable', () => {
    const start = onField();
    const gid = start.gid;
    let g = start.g;
    for (let i = 0; i < 10; i++) g = applyAction(g, 0, { type: 'ptCounters', gid, power: 99, toughness: 0 }, 7);
    g = applyAction(g, 0, { type: 'ptCounters', gid, power: 9, toughness: 0 }, 8);
    expect(g.cards[gid].ptCounters.power).toBe(999);
    expect(() => applyAction(g, 0, { type: 'ptCounters', gid, power: 1, toughness: 0 }, 9)).toThrow('Too many counters');
  });

  it('keeps both kinds on one card and clears them when it leaves the battlefield', () => {
    const start = onField();
    const gid = start.gid;
    let g = applyAction(start.g, 0, { type: 'counters', gid, delta: 2 }, 7);
    g = applyAction(g, 0, { type: 'ptCounters', gid, power: 1, toughness: 2 }, 8);
    g = applyAction(g, 0, { type: 'move', gid, to: 'battlefield', x: 50, y: 50 }, 9);
    expect(g.cards[gid]).toMatchObject({ counters: 2, ptCounters: { power: 1, toughness: 2 } }); // repositioning keeps them
    g = applyAction(g, 0, { type: 'move', gid, to: 'graveyard' }, 10);
    expect(g.cards[gid]).toMatchObject({ counters: 0, ptCounters: { power: 0, toughness: 0 } });
  });

  it('only works on your own battlefield cards', () => {
    const { g, gid } = onField();
    expect(() => applyAction(g, 1, { type: 'ptCounters', gid, power: 1, toughness: 1 }, 7)).toThrow('Card is not on the battlefield');
    const inHand = g.players[0].zones.hand[0];
    expect(() => applyAction(g, 0, { type: 'counters', gid: inHand, delta: 1 }, 7)).toThrow('Card is not on the battlefield');
    expect(() => applyAction(g, 0, { type: 'ptCounters', gid: inHand, power: 1, toughness: 1 }, 7)).toThrow('Card is not on the battlefield');
  });

  it('rejects bad amounts', () => {
    expect(() => parseAction({ type: 'counters', gid: 'g1', delta: 0 })).toThrow(GameError);
    expect(parseAction({ type: 'ptCounters', gid: 'g1', power: 2, toughness: 0 })).toEqual({ type: 'ptCounters', gid: 'g1', power: 2, toughness: 0 });
    for (const bad of [
      { power: 0, toughness: 0 }, { power: 1.5, toughness: 1 }, { power: 100, toughness: 1 }, { power: '1', toughness: 1 }, { power: 1 },
    ]) expect(() => parseAction({ type: 'ptCounters', gid: 'g1', ...bad })).toThrow(GameError);
  });
});

describe('exile', () => {
  it('moves cards to exile, shows them to both players, and back out again', () => {
    let g = build();
    const gid = g.players[0].zones.hand[0];
    g = applyAction(g, 0, { type: 'move', gid, to: 'exile' }, 6);
    expect(g.players[0].zones.exile).toEqual([gid]);
    expect(g.log.at(-1)!.text).toBe(`Player0 moved ${g.cards[gid].card.name} to exile`);
    expect(gameViewFor(g, 0, [true, true]).me.exile.map((c) => c.gid)).toEqual([gid]);
    expect(gameViewFor(g, 1, [true, true]).opp.exile.map((c) => c.gid)).toEqual([gid]);
    g = applyAction(g, 0, { type: 'move', gid, to: 'battlefield', x: 20, y: 20 }, 7);
    expect(g.players[0].zones.exile).toEqual([]);
    expect(g.players[0].zones.battlefield).toContain(gid);
  });
});

describe('tokens', () => {
  const make = (g = build()) => applyAction(g, 0, { type: 'token', name: 'Goblin', power: '1', toughness: '1' }, 6);

  it('creates a named token on your battlefield, visible to both players', () => {
    const g = make();
    const gid = g.players[0].zones.battlefield[0];
    expect(gid).toBe('t1');
    expect(g.cards[gid]).toMatchObject({ owner: 0, tapped: false, counters: 0, token: { power: '1', toughness: '1' } });
    expect(g.cards[gid].card.name).toBe('Goblin');
    expect(g.log.at(-1)!.text).toBe('Player0 created a 1/1 Goblin token');
    expect(gameViewFor(g, 1, [true, true]).opp.battlefield[0].token).toEqual({ power: '1', toughness: '1' });
  });

  it('gives every token its own id', () => {
    const g = make(make());
    expect(g.players[0].zones.battlefield).toEqual(['t1', 't2']);
  });

  it('can be tapped, moved around and given counters', () => {
    let g = make();
    g = applyAction(g, 0, { type: 'tap', gid: 't1', tapped: true }, 7);
    g = applyAction(g, 0, { type: 'counters', gid: 't1', delta: 2 }, 8);
    g = applyAction(g, 0, { type: 'move', gid: 't1', to: 'battlefield', x: 10, y: 90 }, 9);
    expect(g.cards.t1).toMatchObject({ tapped: true, counters: 2, x: 10, y: 90 });
  });

  it('ceases to exist when it leaves the battlefield', () => {
    let g = make();
    g = applyAction(g, 0, { type: 'move', gid: 't1', to: 'graveyard' }, 7);
    expect(g.players[0].zones.battlefield).toEqual([]);
    expect(g.players[0].zones.graveyard).toEqual([]);
    expect(g.cards.t1).toBeUndefined();
    expect(g.log.at(-1)!.text).toBe("Player0's Goblin token left the battlefield");
    expect(make(g).players[0].zones.battlefield).toEqual(['t2']); // ids are never reused
  });

  it('can have a description and no power or toughness', () => {
    const g = applyAction(build(), 0, { type: 'token', name: 'Treasure', description: 'Sacrifice: add one mana.' }, 6);
    expect(g.cards.t1.token).toEqual({});
    expect(g.cards.t1.card).toMatchObject({ name: 'Treasure', oracleText: 'Sacrifice: add one mana.', typeLine: 'Token' });
    expect(g.log.at(-1)!.text).toBe('Player0 created a Treasure token');
    expect(gameViewFor(g, 1, [true, true]).opp.battlefield[0].card.oracleText).toBe('Sacrifice: add one mana.');
  });

  it('shows power and toughness in the type line when present', () => {
    const g = make();
    expect(g.cards.t1.card.typeLine).toBe('Token — 1/1');
    expect(g.cards.t1.card.oracleText).toBe('');
  });

  it('validates the optional fields', () => {
    expect(parseAction({ type: 'token', name: 'Treasure', description: ' ', power: ' ', toughness: '' }))
      .toEqual({ type: 'token', name: 'Treasure' });
    expect(() => parseAction({ type: 'token', name: 'A', power: '1' })).toThrow(GameError);
    expect(() => parseAction({ type: 'token', name: 'A', toughness: '1' })).toThrow(GameError);
    expect(() => parseAction({ type: 'token', name: 'A', description: 'x'.repeat(301) })).toThrow(GameError);
    expect(() => parseAction({ type: 'token', name: 'A', description: 5 })).toThrow(GameError);
    expect(() => parseAction({ type: 'token', power: '1', toughness: '1' })).toThrow(GameError);
  });

  it('validates name and power/toughness', () => {
    expect(parseAction({ type: 'token', name: '  Spirit ', power: '*', toughness: 'X' }))
      .toEqual({ type: 'token', name: 'Spirit', power: '*', toughness: 'X' });
    for (const bad of [
      { name: '', power: '1', toughness: '1' },
      { name: 'A'.repeat(31), power: '1', toughness: '1' },
      { name: 'A', power: '', toughness: '1' },
      { name: 'A', power: '1000', toughness: '1' },
      { name: 'A', power: 1, toughness: '1' },
    ]) expect(() => parseAction({ type: 'token', ...bad })).toThrow(GameError);
  });
});

describe('library window', () => {
  it('shows the top X only to you and keeps them in the library', () => {
    const g = applyAction(build(), 0, { type: 'searchTop', count: 3 }, 6);
    const top3 = g.players[0].zones.library.slice(0, 3);
    const view = gameViewFor(g, 0, [true, true]);
    expect(view.me.peek?.mode).toBe('top');
    expect(view.me.peek?.cards.map((c) => c.gid)).toEqual(top3);
    expect(view.me.libraryCount).toBe(33);
    const oppView = JSON.stringify(gameViewFor(g, 1, [true, true]));
    for (const gid of top3) expect(oppView).not.toContain(`"${gid}"`);
    expect(g.log.at(-1)!.text).toBe('Player0 searched the top 3 of their library');
  });

  it('shows what is left when X is bigger than the library, and rejects an empty library', () => {
    let g = applyAction(build(), 0, { type: 'searchTop', count: 99 }, 6);
    expect(gameViewFor(g, 0, [true, true]).me.peek?.cards).toHaveLength(33);
    g = applyAction(g, 0, { type: 'closeLibrary' }, 7);
    for (let i = 0; i < 5; i++) g = applyAction(g, 0, { type: 'draw', count: 7 }, 8);
    expect(() => applyAction(g, 0, { type: 'searchLibrary' }, 9)).toThrow('Library is empty');
  });

  it('search shows the whole library in its real order', () => {
    const g = applyAction(build(), 0, { type: 'searchLibrary' }, 6);
    const cards = gameViewFor(g, 0, [true, true]).me.peek!.cards;
    expect(cards).toHaveLength(33);
    expect(cards.map((c) => c.gid)).toEqual(g.players[0].zones.library);
    expect(g.log.at(-1)!.text).toBe('Player0 searched their library');
  });

  it('cannot move a library card that is not in the window', () => {
    const base = build();
    const [first, second] = base.players[0].zones.library;
    expect(() => applyAction(base, 0, { type: 'move', gid: first, to: 'hand' }, 6)).toThrow('Card is not available');
    const g = applyAction(base, 0, { type: 'searchTop', count: 1 }, 6);
    expect(() => applyAction(g, 0, { type: 'move', gid: second, to: 'hand' }, 7)).toThrow('Card is not available');
    expect(() => applyAction(g, 1, { type: 'move', gid: first, to: 'hand' }, 7)).toThrow('Card is not available');
  });

  it('moves a window card to any zone, logging its name only when it becomes public', () => {
    let g = applyAction(build(), 0, { type: 'searchTop', count: 3 }, 6);
    const [a, b, c] = g.players[0].zones.library;
    g = applyAction(g, 0, { type: 'move', gid: a, to: 'hand' }, 7);
    expect(g.players[0].zones.hand).toContain(a);
    expect(g.log.at(-1)!.text).toBe('Player0 put a card from their library into their hand');
    g = applyAction(g, 0, { type: 'move', gid: b, to: 'graveyard' }, 8);
    expect(g.log.at(-1)!.text).toBe(`Player0 moved ${g.cards[b].card.name} to graveyard`);
    expect(gameViewFor(g, 0, [true, true]).me.peek?.cards.map((x) => x.gid)).toEqual([c]);
    g = applyAction(g, 0, { type: 'move', gid: c, to: 'exile' }, 9);
    expect(g.players[0].zones.exile).toEqual([c]);
    expect(gameViewFor(g, 0, [true, true]).me.peek).toBeNull(); // nothing left to show
  });

  it('reorders within the library without naming the card', () => {
    let g = applyAction(build(), 0, { type: 'searchTop', count: 3 }, 6);
    const [a, b, c] = g.players[0].zones.library;
    g = applyAction(g, 0, { type: 'move', gid: a, to: 'library', bottom: true }, 7);
    expect(g.players[0].zones.library.at(-1)).toBe(a);
    expect(g.log.at(-1)!.text).toBe('Player0 moved a card to the bottom of their library');
    g = applyAction(g, 0, { type: 'move', gid: c, to: 'library' }, 8);
    expect(g.players[0].zones.library.slice(0, 2)).toEqual([c, b]);
    expect(gameViewFor(g, 0, [true, true]).me.peek?.cards.map((x) => x.gid)).toEqual([c, b, a]);
  });

  it('puts any other card on the bottom of the library, hiding hand cards', () => {
    const base = build();
    const gid = base.players[0].zones.hand[0];
    let g = applyAction(base, 0, { type: 'move', gid, to: 'library', bottom: true }, 6);
    expect(g.players[0].zones.library.at(-1)).toBe(gid);
    expect(g.log.at(-1)!.text).toBe('Player0 put a card from their hand on the bottom of their library');
    expect(() => parseAction({ type: 'move', gid, to: 'library', bottom: 'yes' })).toThrow(GameError);
    g = applyAction(base, 0, { type: 'move', gid, to: 'graveyard' }, 6);
    g = applyAction(g, 0, { type: 'move', gid, to: 'library', bottom: true }, 7);
    expect(g.log.at(-1)!.text).toBe(`Player0 moved ${g.cards[gid].card.name} to the bottom of their library`);
  });

  it('closes on close and shuffle, and stays open through other actions', () => {
    const open = applyAction(build(), 0, { type: 'searchTop', count: 2 }, 6);
    const [top, second] = open.players[0].zones.library;
    const closed = applyAction(open, 0, { type: 'closeLibrary' }, 7);
    expect(gameViewFor(closed, 0, [true, true]).me.peek).toBeNull();
    expect(closed.log).toHaveLength(open.log.length);
    expect(() => applyAction(closed, 0, { type: 'move', gid: top, to: 'hand' }, 8)).toThrow('Card is not available');
    expect(gameViewFor(applyAction(open, 0, { type: 'shuffle' }, 7), 0, [true, true]).me.peek).toBeNull();
    const drawn = applyAction(open, 0, { type: 'draw', count: 1 }, 7);
    expect(gameViewFor(drawn, 0, [true, true]).me.peek?.cards.map((c) => c.gid)).toEqual([second]);
  });

  it('accepts search counts 1-99 only', () => {
    expect(parseAction({ type: 'searchTop', count: 99 })).toEqual({ type: 'searchTop', count: 99 });
    expect(() => parseAction({ type: 'searchTop', count: 0 })).toThrow(GameError);
    expect(() => parseAction({ type: 'searchTop', count: 100 })).toThrow(GameError);
  });
});

describe('face-down cards', () => {
  const setup = () => {
    const g = build();
    const gid = g.players[0].zones.hand[0];
    return { g, gid, name: g.cards[gid].card.name };
  };
  const down = (g: ReturnType<typeof build>, gid: string) => applyAction(g, 0, { type: 'flip', gid }, 6);

  it('keeps a flipped card face down when it is moved to the battlefield', () => {
    const { g, gid } = setup();
    const next = applyAction(down(g, gid), 0, { type: 'move', gid, to: 'battlefield', x: 20, y: 30 }, 7);
    expect(next.cards[gid]).toMatchObject({ faceDown: true, x: 20, y: 30 });
  });

  it('hides everything about the card from the opponent but not from the owner', () => {
    const { g, gid, name } = setup();
    const next = applyAction(down(g, gid), 0, { type: 'move', gid, to: 'battlefield', x: 20, y: 30 }, 7);
    const mine = gameViewFor(next, 0, [true, true]).me.battlefield[0];
    expect(mine).toMatchObject({ faceDown: true, card: { name } });
    expect(mine.card.imageUrl).toBe(next.cards[gid].card.imageUrl);
    const theirs = gameViewFor(next, 1, [true, true]).opp.battlefield[0];
    expect(theirs).toMatchObject({ gid, faceDown: true, x: 20, y: 30 });
    expect(theirs.card.name).toBe('Face-down card');
    expect(theirs.card.imageUrl).toBe('');
    expect(theirs.card.scryfallId).toBe('');
    // the opponent's own hand may hold the same printing, so only their view of this player is checked
    const seen = JSON.stringify(gameViewFor(next, 1, [true, true]).opp);
    expect(seen).not.toContain(next.cards[gid].card.scryfallId);
    expect(seen).not.toContain(`"${next.cards[gid].card.name}"`);
  });

  it('hides a face-down token and face-down cards in public piles', () => {
    let g = applyAction(build(), 0, { type: 'token', name: 'Goblin', power: '1', toughness: '1' }, 6);
    g = applyAction(g, 0, { type: 'flip', gid: 't1' }, 7);
    const view = gameViewFor(g, 1, [true, true]);
    expect(view.opp.battlefield[0].token).toBeUndefined();
    expect(JSON.stringify(view.opp.battlefield)).not.toContain('Goblin');
    const gid = g.players[0].zones.hand[0];
    g = applyAction(applyAction(g, 0, { type: 'flip', gid }, 8), 0, { type: 'move', gid, to: 'exile' }, 9);
    expect(gameViewFor(g, 1, [true, true]).opp.exile[0].card.name).toBe('Face-down card');
  });

  it('never names a face-down card in the log, until it is flipped up in public', () => {
    const { g, gid, name } = setup();
    let next = down(g, gid);
    expect(next.log).toHaveLength(g.log.length); // flipping in hand is private
    next = applyAction(next, 0, { type: 'move', gid, to: 'battlefield', x: 1, y: 1 }, 7);
    expect(next.log.at(-1)!.text).toBe('Player0 moved a face-down card to battlefield');
    next = applyAction(next, 0, { type: 'tap', gid, tapped: true }, 8);
    expect(next.log.at(-1)!.text).toBe('Player0 tapped a face-down card');
    next = applyAction(next, 0, { type: 'counters', gid, delta: 1 }, 9);
    expect(next.log.at(-1)!.text).toBe('Player0 changed the counters on a face-down card');
    next = applyAction(next, 0, { type: 'ptCounters', gid, power: 2, toughness: 1 }, 9);
    expect(next.log.at(-1)!.text).toBe('Player0 changed the counters on a face-down card');
    // the owner sees the counters; the opponent sees none until the card is flipped up
    expect(gameViewFor(next, 0, [true, true]).me.battlefield[0]).toMatchObject({ counters: 1, ptCounters: { power: 2, toughness: 1 } });
    expect(gameViewFor(next, 1, [true, true]).opp.battlefield[0]).toMatchObject({ counters: 0, ptCounters: { power: 0, toughness: 0 } });
    expect(next.log.map((l) => l.text).join()).not.toContain(name);
    next = down(next, gid);
    expect(next.cards[gid].faceDown).toBe(false);
    expect(next.log.at(-1)!.text).toBe(`Player0 flipped ${name} face up`);
    expect(gameViewFor(next, 1, [true, true]).opp.battlefield[0]).toMatchObject({
      card: { name }, counters: 1, ptCounters: { power: 2, toughness: 1 },
    });
    next = down(next, gid);
    expect(next.log.at(-1)!.text).toBe('Player0 flipped a card face down');
  });

  it('only lets the owner flip, and only cards they can reach', () => {
    const { g, gid } = setup();
    expect(() => applyAction(g, 1, { type: 'flip', gid }, 6)).toThrow('Card is not available');
    const top = g.players[0].zones.library[0];
    expect(() => applyAction(g, 0, { type: 'flip', gid: top }, 6)).toThrow('Card is not available');
    const open = applyAction(g, 0, { type: 'searchTop', count: 1 }, 6);
    const flipped = applyAction(open, 0, { type: 'flip', gid: top }, 7);
    expect(flipped.cards[top].faceDown).toBe(true);
    expect(() => parseAction({ type: 'flip' })).toThrow(GameError);
  });

  it('comes back face up after returning to the library', () => {
    const { g, gid } = setup();
    const back = applyAction(down(g, gid), 0, { type: 'move', gid, to: 'library' }, 7);
    expect(back.cards[gid].faceDown).toBe(false);
  });

  it('does not reveal deck position through card ids', () => {
    const first = (seed: number) => build(seed).cards.g1.card.name;
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8].map(first)).size).toBeGreaterThan(1);
  });
});
