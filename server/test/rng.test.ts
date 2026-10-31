import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/rng';

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, a);
    const seqB = Array.from({ length: 5 }, b);
    expect(seqA).toEqual(seqB);
  });

  it('returns values in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs between seeds', () => {
    expect(mulberry32(1)()).not.toEqual(mulberry32(2)());
  });
});
