import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, generateCode, newToken, normalizeCode, sanitizeName, uniqueName } from '../src/rooms/identity';
import { mulberry32 } from '../src/rng';
import { FakeClock } from './helpers';

describe('room codes', () => {
  it('generates 4 characters from the alphabet', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 200; i++) {
      const code = generateCode(rng, () => false);
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    }
  });

  it('skips codes that are taken', () => {
    const rng = mulberry32(2);
    const first = generateCode(mulberry32(2), () => false);
    const code = generateCode(rng, (c) => c === first);
    expect(code).not.toBe(first);
  });

  it('throws when it cannot find a free code', () => {
    expect(() => generateCode(mulberry32(3), () => true)).toThrow('Could not allocate a room code');
  });

  it('normalizes user input', () => {
    expect(normalizeCode(' kx7q ')).toBe('KX7Q');
    expect(normalizeCode('KXOQ')).toBeNull(); // O not in alphabet
    expect(normalizeCode('KX7')).toBeNull();
    expect(normalizeCode(42)).toBeNull();
  });
});

describe('names', () => {
  it('strips control characters, trims and caps at 20', () => {
    expect(sanitizeName('  Sam\u0007  ')).toBe('Sam');
    expect(sanitizeName('x'.repeat(30))).toBe('x'.repeat(20));
    expect(sanitizeName('   ')).toBeNull();
    expect(sanitizeName(null)).toBeNull();
  });

  it('numbers duplicate names case-insensitively', () => {
    expect(uniqueName('Sam', [])).toBe('Sam');
    expect(uniqueName('sam', ['Sam'])).toBe('sam (2)');
    expect(uniqueName('Sam', ['Sam', 'Sam (2)'])).toBe('Sam (3)');
  });
});

describe('tokens', () => {
  it('are 32 hex chars and unique', () => {
    const a = newToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(newToken()).not.toBe(a);
  });
});

describe('FakeClock', () => {
  it('runs due callbacks in order and supports clearing', () => {
    const clock = new FakeClock();
    const log: string[] = [];
    clock.setTimeout(() => log.push('b'), 200);
    const h = clock.setTimeout(() => log.push('x'), 100);
    clock.setTimeout(() => {
      log.push('a');
      clock.setTimeout(() => log.push('a2'), 50);
    }, 100);
    clock.clearTimeout(h);
    clock.advance(160);
    expect(log).toEqual(['a', 'a2']);
    expect(clock.now).toBe(1160);
    clock.advance(100);
    expect(log).toEqual(['a', 'a2', 'b']);
    expect(clock.pending).toBe(0);
  });
});
