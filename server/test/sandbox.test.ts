import { describe, expect, it } from 'vitest';
import { buildSandboxGame } from '../src/game/sandbox';
import { applyAction } from '../src/game/actions';
import { gameViewFor } from '../src/game/view';
import { makeSet } from './helpers';

describe('buildSandboxGame', () => {
  const game = () => buildSandboxGame({ set: makeSet(), seed: 3, now: 0, name: 'Sam', id: 'sandbox-1' });

  it('deals two 40-card decks with opening hands of 7', () => {
    const g = game();
    expect(g.players[0].zones.hand).toHaveLength(7);
    expect(g.players[0].zones.library).toHaveLength(33);
    expect(g.players[1].zones.hand).toHaveLength(7);
    expect(g.players[1].zones.library).toHaveLength(23);
    expect(g.players[0].name).toBe('Sam');
    expect(g.players[1].name).toBe('Test opponent');
  });

  it('uses 17 basic lands and 23 spells per deck', () => {
    const g = game();
    for (const p of g.players) {
      const all = Object.values(p.zones).flat().map((gid) => g.cards[gid].card);
      expect(all).toHaveLength(40);
      expect(all.filter((c) => c.typeLine.includes('Basic Land'))).toHaveLength(17);
    }
  });

  it('gives the opponent normal, tapped and face-down cards plus a graveyard and exile', () => {
    const g = game();
    const field = g.players[1].zones.battlefield.map((gid) => g.cards[gid]);
    expect(field.filter((c) => !c.tapped && !c.faceDown)).toHaveLength(2);
    expect(field.filter((c) => c.tapped && !c.faceDown)).toHaveLength(2);
    expect(field.filter((c) => c.faceDown && !c.tapped)).toHaveLength(1);
    expect(field.filter((c) => c.faceDown && c.tapped)).toHaveLength(1);
    expect(g.players[1].zones.graveyard).toHaveLength(2);
    expect(g.players[1].zones.exile).toHaveLength(2);
    expect(new Set(field.map((c) => `${c.x},${c.y}`)).size).toBe(6);
    expect(g.log).toHaveLength(1); // setting the table does not fill the log
    expect(g.players[0].zones.battlefield).toEqual([]);
  });

  it('puts regular and P/T counters on one face-up and one face-down opponent card', () => {
    const g = game();
    const field = g.players[1].zones.battlefield.map((gid) => g.cards[gid]);
    const marked = field.filter((c) => c.counters > 0 && (c.ptCounters.power !== 0 || c.ptCounters.toughness !== 0));
    expect(marked.filter((c) => !c.faceDown)).toHaveLength(1);
    expect(marked.filter((c) => c.faceDown)).toHaveLength(1);
    expect(field.filter((c) => c.counters > 0)).toHaveLength(2); // the other cards stay clean
    const down = marked.find((c) => c.faceDown)!;
    const seen = gameViewFor(g, 0, [true, true]).opp.battlefield.find((c) => c.gid === down.gid)!;
    expect(seen).toMatchObject({ counters: 0, ptCounters: { power: 0, toughness: 0 } }); // hidden from you
    expect(seen.card.name).toBe('Face-down card');
    expect(g.log).toHaveLength(1);
  });

  it('is playable from seat 0', () => {
    const g = applyAction(game(), 0, { type: 'draw', count: 1 }, 1);
    expect(g.players[0].zones.hand).toHaveLength(8);
  });
});
