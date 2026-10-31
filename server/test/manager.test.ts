import { describe, expect, it, vi } from 'vitest';
import type { SetCards } from '@mtg/shared';
import { InvalidPickError } from '../src/draft/engine';
import {
  DISCONNECT_GRACE_NO_TIMER_MS,
  EMPTY_LOBBY_TTL_MS,
  MAX_ROOMS,
  RoomError,
  RoomManager,
  ROOM_TTL_MS,
  seatIndexOf,
  type HumanSeat,
  type Room,
} from '../src/rooms/manager';
import { FakeClock, makeSet } from './helpers';

const SET = makeSet();

function setup(getSetCards: (code: string) => Promise<SetCards> = async () => SET) {
  const clock = new FakeClock();
  const changes: Room[] = [];
  const manager = new RoomManager({
    getSetCards,
    getSetName: async () => 'Test Set',
    seed: () => 7,
    now: () => clock.now,
    scheduler: clock,
    onChange: (r) => changes.push(r),
  });
  return { manager, clock, changes };
}

const createAnn = (m: RoomManager, timerSeconds: number | null = 60) =>
  m.createRoom({ name: 'Ann', setCode: 'TST', timerSeconds, socketId: 's-ann' });

describe('RoomManager lobby', () => {
  it('creates a lobby with the creator as host', async () => {
    const { manager, changes } = setup();
    const { room, player } = await createAnn(manager);
    expect(room.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    expect(room).toMatchObject({ phase: 'lobby', setCode: 'tst', setName: 'Test Set', timerSeconds: 60, practice: false });
    expect(room.hostPlayerId).toBe(player.playerId);
    expect(player).toMatchObject({ kind: 'human', name: 'Ann', socketId: 's-ann' });
    expect(player.token).toMatch(/^[0-9a-f]{32}$/);
    expect(changes).toContain(room);
    expect(manager.findByCode(room.code)).toBe(room);
  });

  it('validates name and timer', async () => {
    const { manager } = setup();
    await expect(manager.createRoom({ name: '  ', setCode: 'tst', socketId: 's' })).rejects.toThrow(RoomError);
    await expect(manager.createRoom({ name: 'A', setCode: 'tst', timerSeconds: 50, socketId: 's' })).rejects.toThrow('Invalid pick timer');
    await expect(manager.createRoom({ name: 'A', setCode: '', socketId: 's' })).rejects.toThrow('Choose a set');
    const { room } = await manager.createRoom({ name: 'A', setCode: 'tst', timerSeconds: null, socketId: 's' });
    expect(room.timerSeconds).toBeNull();
  });

  it('propagates set loading errors without creating a room', async () => {
    const { manager } = setup(async () => {
      throw new Error('No booster cards found for set "zzz"');
    });
    await expect(manager.createRoom({ name: 'A', setCode: 'zzz', socketId: 's' })).rejects.toThrow('No booster cards found');
    expect(manager.size).toBe(0);
  });

  it('caps the number of live rooms', async () => {
    const { manager } = setup();
    for (let i = 0; i < MAX_ROOMS; i++) await manager.createRoom({ name: 'A', setCode: 'tst', socketId: `s${i}` });
    await expect(manager.createRoom({ name: 'A', setCode: 'tst', socketId: 'x' })).rejects.toThrow('Server is busy, try again later');
  });

  it('joins by code (case-insensitive) with unique names', async () => {
    const { manager } = setup();
    const { room } = await createAnn(manager);
    const bob = manager.joinRoom({ code: room.code.toLowerCase(), name: 'ann', socketId: 's-bob' });
    expect(bob.room).toBe(room);
    expect(bob.player.name).toBe('ann (2)');
    expect(room.players).toHaveLength(2);
  });

  it('rejects unknown codes and full rooms', async () => {
    const { manager } = setup();
    expect(() => manager.joinRoom({ code: 'ZZZZ', name: 'B', socketId: 's' })).toThrow('Room not found');
    const { room } = await createAnn(manager);
    for (let i = 0; i < 7; i++) manager.joinRoom({ code: room.code, name: `P${i}`, socketId: `s${i}` });
    expect(() => manager.joinRoom({ code: room.code, name: 'Late', socketId: 'late' })).toThrow('Room is full');
  });

  it('resumes a seat by token and reports the replaced socket', async () => {
    const { manager } = setup();
    const { room, player } = await createAnn(manager);
    const res = manager.resume({ code: room.code, token: player.token, socketId: 's-ann-2' });
    expect(res.player).toBe(player);
    expect(res.replacedSocketId).toBe('s-ann');
    expect(player.socketId).toBe('s-ann-2');
    expect(() => manager.resume({ code: room.code, token: 'nope', socketId: 'x' })).toThrow('Session not found or expired');
  });

  it('passes host on leave and deletes an empty lobby', async () => {
    const { manager } = setup();
    const { room, player: ann } = await createAnn(manager);
    const { player: bob } = manager.joinRoom({ code: room.code, name: 'Bob', socketId: 's-bob' });
    manager.leave(room.id, ann.playerId);
    expect(room.players).toEqual([bob]);
    expect(room.hostPlayerId).toBe(bob.playerId);
    manager.leave(room.id, bob.playerId);
    expect(manager.size).toBe(0);
  });

  it('marks a disconnected socket and notifies', async () => {
    const { manager, changes } = setup();
    const { room, player } = await createAnn(manager);
    changes.length = 0;
    manager.disconnect('s-ann');
    expect(player.socketId).toBeNull();
    expect(changes).toEqual([room]);
  });

  it('sweeps idle rooms and abandoned lobbies', async () => {
    const { manager, clock } = setup();
    const { room: abandoned } = await createAnn(manager);
    manager.disconnect('s-ann');
    const { room: active } = await manager.createRoom({ name: 'C', setCode: 'tst', socketId: 's-c' });
    clock.advance(EMPTY_LOBBY_TTL_MS + 1);
    expect(manager.sweep()).toBe(1);
    expect(manager.findByCode(abandoned.code)).toBeUndefined();
    expect(manager.findByCode(active.code)).toBe(active);
    clock.advance(ROOM_TTL_MS);
    expect(manager.sweep()).toBe(1);
    expect(manager.size).toBe(0);
  });
});

function pickFirst(m: RoomManager, room: Room, player: HumanSeat) {
  const i = seatIndexOf(room, player.playerId);
  m.pick(room.id, player.playerId, room.state!.current[i][0].instanceId);
}

async function twoPlayerRoom(timerSeconds: number | null = null) {
  const ctx = setup();
  const { room, player: ann } = await createAnn(ctx.manager, timerSeconds);
  const { player: bob } = ctx.manager.joinRoom({ code: room.code, name: 'Bob', socketId: 's-bob' });
  return { ...ctx, room, ann, bob };
}

const noBasics = { W: 0, U: 0, B: 0, R: 0, G: 0 };

describe('RoomManager drafting', () => {
  it('only the host can start, and only once', async () => {
    const { manager, room, ann, bob } = await twoPlayerRoom();
    expect(() => manager.startRoom(room.id, bob.playerId)).toThrow('Only the host can start the draft');
    manager.startRoom(room.id, ann.playerId);
    expect(room.phase).toBe('drafting');
    expect(() => manager.startRoom(room.id, ann.playerId)).toThrow('Draft already started');
    expect(() => manager.joinRoom({ code: room.code, name: 'Late', socketId: 'x' })).toThrow('Draft already started');
  });

  it('seats every human once and fills the rest with bots', async () => {
    const { manager, room, ann, bob } = await twoPlayerRoom();
    manager.startRoom(room.id, ann.playerId);
    expect(room.seats).toHaveLength(8);
    expect(room.seats.filter((s) => s.kind === 'bot')).toHaveLength(6);
    expect(seatIndexOf(room, ann.playerId)).toBeGreaterThanOrEqual(0);
    expect(seatIndexOf(room, bob.playerId)).toBeGreaterThanOrEqual(0);
    expect(room.state!.current.every((p) => p.length === 15)).toBe(true);
  });

  it('waits for every human before bots pick and packs pass', async () => {
    const { manager, room, ann, bob, changes } = await twoPlayerRoom();
    manager.startRoom(room.id, ann.playerId);
    changes.length = 0;
    pickFirst(manager, room, ann);
    expect(room.round).toBe(0);
    expect(room.state!.picks.filter((p) => p.length === 1)).toHaveLength(1);
    expect(changes).toEqual([room]);
    pickFirst(manager, room, bob);
    expect(room.round).toBe(1);
    expect(room.state!.picks.every((p) => p.length === 1)).toBe(true);
    expect(room.state!.current.every((p) => p.length === 14)).toBe(true);
  });

  it('rejects invalid picks without changing state', async () => {
    const { manager, room, ann } = await twoPlayerRoom();
    manager.startRoom(room.id, ann.playerId);
    const before = room.state;
    expect(() => manager.pick(room.id, ann.playerId, 'nope')).toThrow(InvalidPickError);
    expect(room.state).toBe(before);
  });

  it('completes after 45 rounds', async () => {
    const { manager, room, ann, bob } = await twoPlayerRoom();
    manager.startRoom(room.id, ann.playerId);
    for (let i = 0; i < 45; i++) {
      pickFirst(manager, room, ann);
      pickFirst(manager, room, bob);
    }
    expect(room.phase).toBe('complete');
    expect(room.state!.picks.every((p) => p.length === 45)).toBe(true);
    expect(() => manager.pick(room.id, ann.playerId, 'x')).toThrow(InvalidPickError);
  });

  it('starts practice rooms immediately with no timer', async () => {
    const { manager } = setup();
    const { room, player } = await manager.createRoom({ name: 'Ann', setCode: 'tst', timerSeconds: 60, practice: true, socketId: 's' });
    expect(room).toMatchObject({ practice: true, timerSeconds: null, phase: 'drafting' });
    expect(room.seats.filter((s) => s.kind === 'human')).toEqual([player]);
    for (let i = 0; i < 45; i++) pickFirst(manager, room, player);
    expect(room.phase).toBe('complete');
  });

  it('saves decks per player against their own pool', async () => {
    const { manager, room, ann, bob } = await twoPlayerRoom();
    manager.startRoom(room.id, ann.playerId);
    expect(() => manager.saveDeck(room.id, ann.playerId, { main: [], basics: noBasics })).toThrow('Draft is not complete');
    for (let i = 0; i < 45; i++) {
      pickFirst(manager, room, ann);
      pickFirst(manager, room, bob);
    }
    const annPool = room.state!.picks[seatIndexOf(room, ann.playerId)].map((c) => c.instanceId);
    const bobPool = room.state!.picks[seatIndexOf(room, bob.playerId)].map((c) => c.instanceId);
    manager.saveDeck(room.id, ann.playerId, { main: annPool.slice(0, 23), basics: { ...noBasics, G: 17 } });
    expect(room.decks.get(ann.playerId)?.main).toHaveLength(23);
    expect(() => manager.saveDeck(room.id, ann.playerId, { main: [bobPool[0]], basics: noBasics })).toThrow(
      'Deck contains cards that are not in your pool',
    );
    expect(() => manager.saveDeck(room.id, bob.playerId, { main: [], basics: { ...noBasics, R: -1 } })).toThrow('Invalid basic land counts');
    expect(() => manager.saveDeck(room.id, bob.playerId, null)).toThrow('Invalid deck');
  });
});

describe('RoomManager timers', () => {
  it('sets a deadline and auto-picks idle humans when it passes', async () => {
    const { manager, room, ann, bob, clock } = await twoPlayerRoom(60);
    manager.startRoom(room.id, ann.playerId);
    expect(room.pickDeadline).toBe(clock.now + 60_000);
    const annIdx = seatIndexOf(room, ann.playerId);
    const chosen = room.state!.current[annIdx][3].instanceId;
    manager.pick(room.id, ann.playerId, chosen);
    clock.advance(59_999);
    expect(room.round).toBe(0);
    clock.advance(1);
    expect(room.round).toBe(1);
    expect(room.state!.picks[annIdx][0].instanceId).toBe(chosen);
    expect(room.state!.picks[seatIndexOf(room, bob.playerId)]).toHaveLength(1);
    expect(room.pickDeadline).toBe(clock.now + 60_000);
  });

  it('cancels the old round timer when everyone picks early', async () => {
    const { manager, room, ann, bob, clock } = await twoPlayerRoom(30);
    manager.startRoom(room.id, ann.playerId);
    pickFirst(manager, room, ann);
    pickFirst(manager, room, bob);
    expect(room.round).toBe(1);
    expect(clock.pending).toBe(1); // only the new round's timer
    clock.advance(29_999);
    expect(room.round).toBe(1);
  });

  it('has no deadline and no timers without a timer', async () => {
    const { manager, room, ann, clock } = await twoPlayerRoom(null);
    manager.startRoom(room.id, ann.playerId);
    expect(room.pickDeadline).toBeNull();
    expect(clock.pending).toBe(0);
  });

  it('auto-picks a disconnected player after 30 s in a no-timer multiplayer room', async () => {
    const { manager, room, ann, bob, clock } = await twoPlayerRoom(null);
    expect(DISCONNECT_GRACE_NO_TIMER_MS).toBe(30_000);
    manager.startRoom(room.id, ann.playerId);
    pickFirst(manager, room, ann);
    manager.disconnect('s-bob');
    clock.advance(29_999);
    expect(room.round).toBe(0);
    clock.advance(1);
    expect(room.round).toBe(1);
    // Bob is still away, so his next pick is made after another 30 s and Ann alone drives the draft.
    expect(room.state!.pickedThisTurn[seatIndexOf(room, bob.playerId)]).toBe(false);
    pickFirst(manager, room, ann);
    clock.advance(30_000);
    expect(room.round).toBe(2);
  });

  it('never auto-picks a disconnected player in a practice room', async () => {
    const { manager, clock } = setup();
    const { room } = await manager.createRoom({ name: 'Ann', setCode: 'TST', practice: true, socketId: 's-ann' });
    manager.disconnect('s-ann');
    const before = room.state;
    clock.advance(60 * 60 * 1000);
    expect(room.round).toBe(0);
    expect(room.state).toBe(before);
    expect(clock.pending).toBe(0);
  });

  it('gives disconnected players a 5 s grace in timer rooms, cancelled by reconnecting', async () => {
    const { manager, room, ann, bob, clock } = await twoPlayerRoom(60);
    manager.startRoom(room.id, ann.playerId);
    pickFirst(manager, room, ann);
    manager.disconnect('s-bob');
    clock.advance(4_000);
    manager.resume({ code: room.code, token: bob.token, socketId: 's-bob-2' });
    clock.advance(2_000);
    expect(room.round).toBe(0);
    manager.disconnect('s-bob-2');
    clock.advance(5_000);
    expect(room.round).toBe(1);
  });

  it('lets one remaining human finish a draft while the other is gone', async () => {
    const { manager, room, ann, bob, clock } = await twoPlayerRoom(null);
    manager.startRoom(room.id, ann.playerId);
    manager.leave(room.id, bob.playerId);
    for (let i = 0; i < 45; i++) {
      pickFirst(manager, room, ann);
      clock.advance(DISCONNECT_GRACE_NO_TIMER_MS);
    }
    expect(room.phase).toBe('complete');
    expect(clock.pending).toBe(0);
  });

  it('survives an onChange that throws inside timer callbacks', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { manager, room, ann, clock } = await twoPlayerRoom(60);
      manager.startRoom(room.id, ann.playerId);
      manager.disconnect('s-bob'); // arms a grace timer
      manager.onChange = () => {
        throw new Error('boom');
      };
      expect(() => clock.advance(5_000)).not.toThrow(); // grace callback
      expect(errors).toHaveBeenCalled();
      errors.mockClear();
      expect(() => clock.advance(60_000)).not.toThrow(); // round deadline
      expect(errors).toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});
