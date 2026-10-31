import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/shared';
import { advanceIfReady, applyPick, createDraft, InvalidPickError, seatView, type DraftState } from '../src/draft/engine';
import { makeCard } from './helpers';

// packs[seat][round] with names "s{seat}r{round}c{i}" so we can see where a pack came from
function packs(seats: number, size = 15): Card[][][] {
  return Array.from({ length: seats }, (_, s) =>
    Array.from({ length: 3 }, (_, r) => Array.from({ length: size }, (_, i) => makeCard({ name: `s${s}r${r}c${i}` }))),
  );
}

function everyonePicksFirst(state: DraftState): DraftState {
  let s = state;
  for (let seat = 0; seat < s.seatCount; seat++) s = applyPick(s, seat, s.current[seat][0].instanceId);
  return advanceIfReady(s);
}

const origin = (pack: Card[]) => pack[0].name.slice(0, 4); // e.g. "s0r0"

describe('draft engine', () => {
  it('creates unique instance ids and opens round 1 packs', () => {
    const st = createDraft(8, packs(8));
    const ids = st.unopened.flat(2).map((c) => c.instanceId);
    expect(new Set(ids).size).toBe(8 * 3 * 15);
    expect(st.current[3][0].instanceId).toBe('r0s3c0');
    expect(seatView(st, 0)).toMatchObject({ packNumber: 1, pickNumber: 1, complete: false });
  });

  it('rejects mismatched pack input', () => {
    expect(() => createDraft(8, packs(7))).toThrow();
  });

  it('passes left in pack 1', () => {
    const st = everyonePicksFirst(createDraft(8, packs(8)));
    expect(origin(st.current[1])).toBe('s0r0');
    expect(origin(st.current[0])).toBe('s7r0');
    expect(st.current[1]).toHaveLength(14);
    expect(seatView(st, 0).pickNumber).toBe(2);
  });

  it('passes right in pack 2 and left in pack 3', () => {
    let st = createDraft(8, packs(8));
    for (let i = 0; i < 15; i++) st = everyonePicksFirst(st);
    expect(st.round).toBe(1);
    expect(seatView(st, 0)).toMatchObject({ packNumber: 2, pickNumber: 1 });
    st = everyonePicksFirst(st);
    expect(origin(st.current[0])).toBe('s1r1');
    for (let i = 0; i < 14; i++) st = everyonePicksFirst(st);
    expect(st.round).toBe(2);
    st = everyonePicksFirst(st);
    expect(origin(st.current[1])).toBe('s0r2');
  });

  it('completes after 45 picks per seat', () => {
    let st = createDraft(8, packs(8));
    for (let i = 0; i < 45; i++) st = everyonePicksFirst(st);
    expect(st.complete).toBe(true);
    expect(st.picks.every((p) => p.length === 45)).toBe(true);
    expect(seatView(st, 0)).toMatchObject({ complete: true, currentPack: null });
    expect(() => applyPick(st, 0, 'r0s0c0')).toThrow(InvalidPickError);
  });

  it('rejects a card that is not in the current pack', () => {
    const st = createDraft(8, packs(8));
    expect(() => applyPick(st, 0, 'r0s1c0')).toThrow(InvalidPickError);
  });

  it('rejects a second pick in the same turn', () => {
    let st = createDraft(8, packs(8));
    st = applyPick(st, 0, 'r0s0c0');
    expect(() => applyPick(st, 0, 'r0s0c1')).toThrow(InvalidPickError);
  });

  it('does not advance until every seat has picked, and hides the pack meanwhile', () => {
    let st = createDraft(8, packs(8));
    st = applyPick(st, 0, 'r0s0c0');
    expect(advanceIfReady(st)).toBe(st);
    expect(seatView(st, 0).currentPack).toBeNull();
    expect(seatView(st, 0).picks.map((c) => c.instanceId)).toEqual(['r0s0c0']);
  });

  it('is pure (does not mutate the input state)', () => {
    const st = createDraft(8, packs(8));
    const before = JSON.stringify(st);
    applyPick(st, 0, 'r0s0c0');
    expect(JSON.stringify(st)).toBe(before);
  });

  it('seat views expose only that seat', () => {
    const view = seatView(createDraft(8, packs(8)), 2);
    expect(Object.keys(view).sort()).toEqual(['complete', 'currentPack', 'packNumber', 'pickNumber', 'picks']);
    expect(view.currentPack!.every((c) => c.name.startsWith('s2r0'))).toBe(true);
  });
});
