import { describe, expect, it } from 'vitest';
import { RoomManager, seatIndexOf } from '../src/rooms/manager';
import { completeFor, draftStateFor, lobbyView, tableView } from '../src/rooms/views';
import { FakeClock, makeSet } from './helpers';

async function room2() {
  const clock = new FakeClock();
  const manager = new RoomManager({ getSetCards: async () => makeSet(), getSetName: async () => 'Test Set', seed: () => 3, now: () => clock.now, scheduler: clock });
  const { room, player: ann } = await manager.createRoom({ name: 'Ann', setCode: 'tst', timerSeconds: 45, socketId: 's-ann' });
  const { player: bob } = manager.joinRoom({ code: room.code, name: 'Bob', socketId: 's-bob' });
  return { manager, room, ann, bob };
}

describe('views', () => {
  it('lobby view lists players without tokens', async () => {
    const { room, ann, bob } = await room2();
    const view = lobbyView(room);
    expect(view).toEqual({
      code: room.code, setCode: 'tst', setName: 'Test Set', timerSeconds: 45, hostPlayerId: ann.playerId,
      players: [
        { playerId: ann.playerId, name: 'Ann', connected: true },
        { playerId: bob.playerId, name: 'Bob', connected: true },
      ],
    });
    expect(JSON.stringify(view)).not.toContain(ann.token);
  });

  it('table view names bots in seat order and marks you, picks and connections', async () => {
    const { manager, room, ann, bob } = await room2();
    manager.startRoom(room.id, ann.playerId);
    const annIdx = seatIndexOf(room, ann.playerId);
    manager.pick(room.id, ann.playerId, room.state!.current[annIdx][0].instanceId);
    manager.disconnect('s-bob');
    const table = tableView(room, ann.playerId);
    expect(table).toHaveLength(8);
    expect(table.filter((s) => s.isBot).map((s) => s.name)).toEqual(['Bot 1', 'Bot 2', 'Bot 3', 'Bot 4', 'Bot 5', 'Bot 6']);
    expect(table[annIdx]).toEqual({ name: 'Ann', isBot: false, picked: true, connected: true, isYou: true });
    expect(table[seatIndexOf(room, bob.playerId)]).toMatchObject({ name: 'Bob', picked: false, connected: false, isYou: false });
  });

  it('draft state contains only your own pack', async () => {
    const { manager, room, ann } = await room2();
    manager.startRoom(room.id, ann.playerId);
    const annIdx = seatIndexOf(room, ann.playerId);
    const payload = draftStateFor(room, ann.playerId);
    expect(payload.code).toBe(room.code);
    expect(payload.pickDeadline).toBe(room.pickDeadline);
    expect(payload.view.currentPack).toEqual(room.state!.current[annIdx]);
    const json = JSON.stringify(payload);
    room.state!.current.forEach((pack, i) => {
      if (i !== annIdx) for (const c of pack) expect(json).not.toContain(c.instanceId);
    });
  });

  it('complete view returns only your pool', async () => {
    const { manager, room, ann, bob } = await room2();
    manager.startRoom(room.id, ann.playerId);
    for (let i = 0; i < 45; i++) {
      for (const p of [ann, bob]) {
        const idx = seatIndexOf(room, p.playerId);
        manager.pick(room.id, p.playerId, room.state!.current[idx][0].instanceId);
      }
    }
    const done = completeFor(room, bob.playerId);
    expect(done.pool).toEqual(room.state!.picks[seatIndexOf(room, bob.playerId)]);
  });
});
