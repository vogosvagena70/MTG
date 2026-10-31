import { describe, expect, it } from 'vitest';
import type { RosterPlayer } from '@mtg/shared';
import { canChallenge, secondsUntil } from '../src/lib/battle';

const p = (o: Partial<RosterPlayer> = {}): RosterPlayer => ({
  playerId: 'a', name: 'A', deckSaved: true, inGame: false, connected: true, isYou: false, ...o,
});
const me = p({ playerId: 'me', isYou: true });

describe('canChallenge', () => {
  it('allows a ready opponent', () => expect(canChallenge(me, p())).toBe(true));
  it('rejects yourself', () => expect(canChallenge(me, me)).toBe(false));
  it('rejects when I am unknown', () => expect(canChallenge(undefined, p())).toBe(false));
  it('rejects when my deck is not saved', () => expect(canChallenge({ ...me, deckSaved: false }, p())).toBe(false));
  it('rejects when I am in a game', () => expect(canChallenge({ ...me, inGame: true }, p())).toBe(false));
  it('rejects a target without a deck', () => expect(canChallenge(me, p({ deckSaved: false }))).toBe(false));
  it('rejects a target in a game', () => expect(canChallenge(me, p({ inGame: true }))).toBe(false));
  it('rejects a disconnected target', () => expect(canChallenge(me, p({ connected: false }))).toBe(false));
});

describe('secondsUntil', () => {
  it('rounds up', () => expect(secondsUntil(10_001, 10_000)).toBe(1));
  it('is exact on whole seconds', () => expect(secondsUntil(15_000, 10_000)).toBe(5));
  it('never goes negative', () => expect(secondsUntil(5_000, 10_000)).toBe(0));
});
