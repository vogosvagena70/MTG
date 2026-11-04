import { describe, expect, it } from 'vitest';
import { buildSandboxGame } from '../src/game/sandbox';
import { applyAction } from '../src/game/actions';
import { makeSet } from './helpers';

describe('buildSandboxGame', () => {
  const game = () => buildSandboxGame({ set: makeSet(), seed: 3, now: 0, name: 'Sam', id: 'sandbox-1' });

  it('deals two 40-card decks with opening hands of 7', () => {
    const g = game();
    for (const p of g.players) {
      expect(p.zones.hand).toHaveLength(7);
      expect(p.zones.library).toHaveLength(33);
    }
    expect(g.players[0].name).toBe('Sam');
    expect(g.players[1].name).toBe('Test opponent');
  });

  it('uses 17 basic lands and 23 spells per deck', () => {
    const g = game();
    for (const p of g.players) {
      const all = [...p.zones.hand, ...p.zones.library].map((gid) => g.cards[gid].card);
      expect(all.filter((c) => c.typeLine.includes('Basic Land'))).toHaveLength(17);
    }
  });

  it('is playable from seat 0', () => {
    const g = applyAction(game(), 0, { type: 'draw', count: 1 }, 1);
    expect(g.players[0].zones.hand).toHaveLength(8);
  });
});
