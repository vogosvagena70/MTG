import { describe, expect, it } from 'vitest';
import { parseSession, roomCodeFromUrl, secondsLeft } from '../src/lib/session';

describe('parseSession', () => {
  it('accepts a well-formed session', () => {
    expect(parseSession('{"code":"KX7Q","playerId":"p","token":"t"}')).toEqual({ code: 'KX7Q', playerId: 'p', token: 't' });
  });
  it('rejects missing, malformed or incomplete data', () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession('not json')).toBeNull();
    expect(parseSession('{"code":"KX7Q"}')).toBeNull();
  });
});

describe('roomCodeFromUrl', () => {
  it('reads and uppercases ?room=', () => {
    expect(roomCodeFromUrl('?room=kx7q')).toBe('KX7Q');
    expect(roomCodeFromUrl('?x=1')).toBe('');
    expect(roomCodeFromUrl('')).toBe('');
  });
});

describe('secondsLeft', () => {
  it('rounds up and never goes below zero', () => {
    expect(secondsLeft(null, 0)).toBeNull();
    expect(secondsLeft(10_000, 0)).toBe(10);
    expect(secondsLeft(10_000, 9_001)).toBe(1);
    expect(secondsLeft(10_000, 12_000)).toBe(0);
  });
});
