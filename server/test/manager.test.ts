import { describe, expect, it } from 'vitest';
import type { SetCards } from '@mtg/shared';
import { EMPTY_LOBBY_TTL_MS, MAX_ROOMS, RoomError, RoomManager, ROOM_TTL_MS, type Room } from '../src/rooms/manager';
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
