import { describe, expect, it } from 'vitest';
import type { RosterPlayer } from '@mtg/shared';
import { actionErrorText, canChallenge, dropPosition, secondsUntil } from '../src/lib/battle';

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

describe('dropPosition', () => {
  const rect = { left: 100, top: 200, width: 400, height: 200 };
  it('maps the centre to 50/50', () => expect(dropPosition(rect, 300, 300)).toEqual({ x: 50, y: 50 }));
  it('clamps below the origin to 0', () => expect(dropPosition(rect, 0, 0)).toEqual({ x: 0, y: 0 }));
  it('clamps past the far edge to 100', () => expect(dropPosition(rect, 900, 900)).toEqual({ x: 100, y: 100 }));
  it('rounds to one decimal', () => expect(dropPosition(rect, 101, 200.3).x).toBe(0.3));
  it('survives a zero-size rect', () => expect(dropPosition({ left: 0, top: 0, width: 0, height: 0 }, 5, 5)).toEqual({ x: 50, y: 50 }));
});

describe('actionErrorText', () => {
  it('is null when ok', () => expect(actionErrorText({ ok: true })).toBeNull());
  it('returns the message', () => expect(actionErrorText({ ok: false, message: 'Library is empty' })).toBe('Library is empty'));
  it('falls back', () => expect(actionErrorText({ ok: false })).toBe('Action failed'));
});
