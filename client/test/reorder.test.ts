import { describe, expect, it } from 'vitest';
import { reorder } from '../src/lib/reorder';

describe('reorder', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('puts a card before or after the target', () => {
    expect(reorder(ids, 'd', 'a', false)).toEqual(['d', 'a', 'b', 'c']);
    expect(reorder(ids, 'a', 'c', true)).toEqual(['b', 'c', 'a', 'd']);
    expect(reorder(ids, 'a', 'c', false)).toEqual(['b', 'a', 'c', 'd']);
    expect(reorder(ids, 'b', 'd', true)).toEqual(['a', 'c', 'd', 'b']);
  });
  it('leaves the list alone for itself or unknown ids', () => {
    expect(reorder(ids, 'b', 'b', true)).toBe(ids);
    expect(reorder(ids, 'x', 'b', true)).toBe(ids);
    expect(reorder(ids, 'b', 'x', true)).toBe(ids);
  });
});
