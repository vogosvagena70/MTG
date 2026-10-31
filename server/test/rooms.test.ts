import { describe, expect, it } from 'vitest';
import { InvalidPickError, seatView } from '../src/draft/engine';
import { DeckError, HUMAN_SEAT, RoomManager, RoomNotFoundError, ROOM_TTL_MS, type Room } from '../src/rooms/RoomManager';
import { makeSet } from './helpers';

const noBasics = { W: 0, U: 0, B: 0, R: 0, G: 0 };

function setup() {
  let now = 1_000;
  const manager = new RoomManager({ getSetCards: async () => makeSet(), seed: () => 42, now: () => now });
  return { manager, advance: (ms: number) => (now += ms) };
}

function draftToEnd(manager: RoomManager, room: Room) {
  for (let i = 0; i < 45; i++) manager.pick(room.id, room.state.current[HUMAN_SEAT][0].instanceId);
}

describe('RoomManager', () => {
  it('creates an 8-seat practice draft', async () => {
    const { manager } = setup();
    const room = await manager.createPracticeRoom('tst');
    expect(room.state.seatCount).toBe(8);
    expect(seatView(room.state, HUMAN_SEAT).currentPack).toHaveLength(15);
    expect(manager.get(room.id)).toBe(room);
  });

  it('runs bot picks and passes after a human pick', async () => {
    const { manager } = setup();
    const room = await manager.createPracticeRoom('tst');
    manager.pick(room.id, room.state.current[HUMAN_SEAT][0].instanceId);
    expect(room.state.picks.every((p) => p.length === 1)).toBe(true);
    expect(seatView(room.state, HUMAN_SEAT)).toMatchObject({ pickNumber: 2 });
    expect(room.state.current[HUMAN_SEAT]).toHaveLength(14);
  });

  it('throws InvalidPickError and leaves state unchanged on a bad pick', async () => {
    const { manager } = setup();
    const room = await manager.createPracticeRoom('tst');
    const before = room.state;
    expect(() => manager.pick(room.id, 'nope')).toThrow(InvalidPickError);
    expect(room.state).toBe(before);
  });

  it('completes a full draft with 45 picks for the human', async () => {
    const { manager } = setup();
    const room = await manager.createPracticeRoom('tst');
    draftToEnd(manager, room);
    expect(room.state.complete).toBe(true);
    expect(room.state.picks[HUMAN_SEAT]).toHaveLength(45);
  });

  it('saves a valid deck only after completion', async () => {
    const { manager } = setup();
    const room = await manager.createPracticeRoom('tst');
    expect(() => manager.saveDeck(room.id, { main: [], basics: noBasics })).toThrow(DeckError);
    draftToEnd(manager, room);
    const main = room.state.picks[HUMAN_SEAT].slice(0, 23).map((c) => c.instanceId);
    manager.saveDeck(room.id, { main, basics: { ...noBasics, R: 8, G: 9 } });
    expect(room.deck?.main).toHaveLength(23);
    expect(() => manager.saveDeck(room.id, { main: ['not-in-pool'], basics: noBasics })).toThrow(DeckError);
    expect(() => manager.saveDeck(room.id, { main, basics: { ...noBasics, R: -1 } })).toThrow(DeckError);
  });

  it('throws RoomNotFoundError for unknown rooms', () => {
    const { manager } = setup();
    expect(() => manager.get('missing')).toThrow(RoomNotFoundError);
  });

  it('sweeps rooms idle for more than 30 minutes', async () => {
    const { manager, advance } = setup();
    const idle = await manager.createPracticeRoom('tst');
    const active = await manager.createPracticeRoom('tst');
    advance(ROOM_TTL_MS - 1);
    manager.get(active.id);
    advance(2);
    expect(manager.sweep()).toBe(1);
    expect(() => manager.get(idle.id)).toThrow(RoomNotFoundError);
    expect(manager.get(active.id)).toBe(active);
  });
});
