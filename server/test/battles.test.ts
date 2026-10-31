import { describe, expect, it, vi } from 'vitest';
import { Battles, CHALLENGE_TTL_MS, ENDED_GAME_TTL_MS } from '../src/rooms/battles';
import { rosterFor } from '../src/rooms/battleViews';
import { RoomManager, ROOM_TTL_MS, seatIndexOf, type HumanSeat, type Room } from '../src/rooms/manager';
import { FakeClock, makeSet } from './helpers';

const SET = makeSet();

function deckFor(room: Room, p: HumanSeat, mainCount = 23, basicCount = 17) {
  const pool = room.state!.picks[seatIndexOf(room, p.playerId)];
  const w = Math.ceil(basicCount / 2);
  return { main: pool.slice(0, mainCount).map((c) => c.instanceId), basics: { W: w, U: basicCount - w, B: 0, R: 0, G: 0 } };
}

async function setup(opts: { players?: number; practice?: boolean; draft?: boolean; decks?: boolean } = {}) {
  const clock = new FakeClock();
  const manager = new RoomManager({
    getSetCards: async () => SET,
    getSetName: async () => 'Test Set',
    seed: () => 7,
    now: () => clock.now,
    scheduler: clock,
  });
  const { room, player: ann } = await manager.createRoom({ name: 'Ann', setCode: 'tst', timerSeconds: null, socketId: 's-ann' });
  const bob = manager.joinRoom({ code: room.code, name: 'Bob', socketId: 's-bob' }).player;
  const players = [ann, bob];
  if ((opts.players ?? 2) > 2) players.push(manager.joinRoom({ code: room.code, name: 'Cat', socketId: 's-cat' }).player);
  if (opts.draft !== false) {
    manager.startRoom(room.id, ann.playerId);
    for (let i = 0; i < 45; i++) {
      for (const p of players) {
        manager.pick(room.id, p.playerId, room.state!.current[seatIndexOf(room, p.playerId)][0].instanceId);
      }
    }
    if (opts.decks !== false) for (const p of players) manager.saveDeck(room.id, p.playerId, deckFor(room, p));
  }
  const onChange = vi.fn();
  const onDeclined = vi.fn();
  const onGameEnded = vi.fn();
  const battles = new Battles({ manager, now: () => clock.now, scheduler: clock, seed: () => 42, onChange, onDeclined, onGameEnded });
  return { clock, manager, battles, room, ann, bob, cat: players[2], onChange, onDeclined, onGameEnded };
}

describe('Battles challenge validation', () => {
  it('rejects ineligible challenges without changing state', async () => {
    const t = await setup({ players: 3 });
    const { battles, room, ann, bob, cat } = t;
    expect(() => battles.challenge(room.id, ann.playerId, ann.playerId)).toThrow("You can't challenge yourself");

    t.manager.saveDeck(room.id, bob.playerId, deckFor(room, bob)); // sanity: still valid
    room.decks.delete(ann.playerId);
    expect(() => battles.challenge(room.id, ann.playerId, bob.playerId)).toThrow('Save your deck first');
    room.decks.set(ann.playerId, deckFor(room, ann));
    room.decks.delete(bob.playerId);
    expect(() => battles.challenge(room.id, ann.playerId, bob.playerId)).toThrow("Bob hasn't saved a deck yet");
    room.decks.set(bob.playerId, deckFor(room, bob));

    battles.challenge(room.id, ann.playerId, bob.playerId);
    expect(() => battles.challenge(room.id, cat.playerId, bob.playerId)).toThrow('Bob is busy');
    expect(() => battles.challenge(room.id, ann.playerId, cat.playerId)).toThrow('You are already in a game or challenge');
    expect(battles.incomingFor(cat.playerId)).toBeNull();
    battles.respond(room.id, bob.playerId, true);
    expect(() => battles.challenge(room.id, cat.playerId, bob.playerId)).toThrow('Bob is busy');
  });

  it('rejects practice rooms and rooms that are not complete', async () => {
    const lobby = await setup({ draft: false });
    expect(() => lobby.battles.challenge(lobby.room.id, lobby.ann.playerId, lobby.bob.playerId)).toThrow(
      'Battles are only available after a multiplayer draft',
    );
    lobby.manager.startRoom(lobby.room.id, lobby.ann.playerId);
    expect(() => lobby.battles.challenge(lobby.room.id, lobby.ann.playerId, lobby.bob.playerId)).toThrow(
      'Battles are only available after a multiplayer draft',
    );

    const clock = new FakeClock();
    const manager = new RoomManager({ getSetCards: async () => SET, seed: () => 1, now: () => clock.now, scheduler: clock });
    const { room, player } = await manager.createRoom({ name: 'Solo', setCode: 'tst', practice: true, socketId: 's' });
    const battles = new Battles({ manager, now: () => clock.now, scheduler: clock, onChange: vi.fn(), onDeclined: vi.fn(), onGameEnded: vi.fn() });
    expect(() => battles.challenge(room.id, player.playerId, 'x')).toThrow('Battles are only available after a multiplayer draft');
  });
});

describe('Battles challenge flow', () => {
  it('accept starts a game for both', async () => {
    const { battles, room, ann, bob, onChange } = await setup();
    onChange.mockClear();
    battles.challenge(room.id, ann.playerId, bob.playerId);
    expect(onChange).toHaveBeenCalledWith(room);
    expect(battles.incomingFor(bob.playerId)).toMatchObject({ fromPlayerId: ann.playerId, fromName: 'Ann' });
    battles.respond(room.id, bob.playerId, true);
    const g = battles.gameFor(ann.playerId);
    expect(g).toBeDefined();
    expect(battles.gameFor(bob.playerId)).toBe(g);
    expect(g!.state.players[0].zones.hand).toHaveLength(7);
    expect(battles.incomingFor(bob.playerId)).toBeNull();
    expect(rosterFor(room, battles, ann.playerId).map((r) => [r.name, r.inGame, r.isYou, r.deckSaved])).toEqual([
      ['Ann', true, true, true],
      ['Bob', true, false, true],
    ]);
    expect(onChange).toHaveBeenCalledWith(room);
  });

  it('decline notifies the challenger', async () => {
    const { battles, room, ann, bob, onDeclined, onChange } = await setup();
    battles.challenge(room.id, ann.playerId, bob.playerId);
    onChange.mockClear();
    battles.respond(room.id, bob.playerId, false);
    expect(onChange).toHaveBeenCalledWith(room);
    expect(onDeclined).toHaveBeenCalledWith(room, ann.playerId, 'Bob', 'declined');
    expect(battles.incomingFor(bob.playerId)).toBeNull();
    expect(battles.gameFor(ann.playerId)).toBeUndefined();
    battles.challenge(room.id, ann.playerId, bob.playerId); // no longer busy
  });

  it('challenge expires after 60 s', async () => {
    const { battles, room, ann, bob, clock, onDeclined, onChange } = await setup();
    battles.challenge(room.id, ann.playerId, bob.playerId);
    clock.advance(CHALLENGE_TTL_MS - 1);
    expect(onDeclined).not.toHaveBeenCalled();
    onChange.mockClear();
    clock.advance(1);
    expect(onChange).toHaveBeenCalledWith(room);
    expect(onDeclined).toHaveBeenCalledWith(room, ann.playerId, 'Bob', 'expired');
    expect(() => battles.respond(room.id, bob.playerId, true)).toThrow('No pending challenge');
  });

  it('stale accept: invalid deck clears the challenge and notifies the challenger', async () => {
    const { battles, manager, room, ann, bob, onDeclined, onChange } = await setup();
    battles.challenge(room.id, ann.playerId, bob.playerId);
    manager.saveDeck(room.id, ann.playerId, deckFor(room, ann, 22, 17));
    onChange.mockClear();
    expect(() => battles.respond(room.id, bob.playerId, true)).toThrow('Deck must have at least 40 cards');
    expect(onChange).toHaveBeenCalledWith(room);
    expect(battles.gameFor(ann.playerId)).toBeUndefined();
    expect(battles.gameFor(bob.playerId)).toBeUndefined();
    expect(battles.incomingFor(bob.playerId)).toBeNull();
    expect(onDeclined).toHaveBeenCalledWith(room, ann.playerId, 'Bob', 'declined');
    expect(() => battles.respond(room.id, bob.playerId, true)).toThrow('No pending challenge');
  });

  it('stale accept: deleted room', async () => {
    const { battles, manager, clock, room, ann, bob } = await setup();
    battles.challenge(room.id, ann.playerId, bob.playerId);
    clock.now += ROOM_TTL_MS + 1; // without firing the challenge timer
    expect(manager.sweep()).toBe(1);
    expect(() => battles.respond(room.id, bob.playerId, true)).toThrow('Room not found or expired');
  });

  it('re-saving a deck mid-game does not change the game', async () => {
    const { battles, manager, room, ann, bob } = await setup();
    battles.challenge(room.id, ann.playerId, bob.playerId);
    battles.respond(room.id, bob.playerId, true);
    const game = battles.gameFor(ann.playerId)!;
    const before = Object.keys(game.state.cards).length;
    expect(before).toBe(80);
    manager.saveDeck(room.id, ann.playerId, deckFor(room, ann, 25, 17));
    expect(Object.keys(battles.gameFor(ann.playerId)!.state.cards)).toHaveLength(before);

    battles.leaveGame(room.id, ann.playerId);
    battles.leaveGame(room.id, bob.playerId);
    battles.challenge(room.id, ann.playerId, bob.playerId);
    battles.respond(room.id, bob.playerId, true);
    expect(Object.keys(battles.gameFor(ann.playerId)!.state.cards)).toHaveLength(82);
  });
});

describe('Battles live game', () => {
  async function started() {
    const t = await setup();
    t.battles.challenge(t.room.id, t.ann.playerId, t.bob.playerId);
    t.battles.respond(t.room.id, t.bob.playerId, true);
    t.onChange.mockClear();
    return t;
  }
  const seatOf = (t: Awaited<ReturnType<typeof started>>, id: string) =>
    t.battles.gameFor(id)!.state.players.findIndex((p) => p.playerId === id);

  it('act applies to the caller seat and refreshes room activity', async () => {
    const t = await started();
    const { battles, room, ann, clock, manager, onChange } = t;
    clock.advance(29 * 60_000);
    battles.act(room.id, ann.playerId, { type: 'draw', count: 1 });
    expect(battles.gameFor(ann.playerId)!.state.players[seatOf(t, ann.playerId)].zones.hand).toHaveLength(8);
    expect(onChange).toHaveBeenCalledWith(room);
    clock.advance(2 * 60_000);
    expect(manager.sweep()).toBe(0);
    expect(() => battles.act(room.id, ann.playerId, { type: 'bogus' })).toThrow('Invalid action');
  });

  it('act without a game throws', async () => {
    const { battles, room, ann } = await setup();
    expect(() => battles.act(room.id, ann.playerId, { type: 'draw', count: 1 })).toThrow('You are not in a game');
    expect(() => battles.leaveGame(room.id, ann.playerId)).toThrow('You are not in a game');
  });

  it('leaving before the end concedes', async () => {
    const t = await started();
    const { battles, room, ann, bob, onGameEnded, onChange } = t;
    const bobSeat = seatOf(t, bob.playerId);
    battles.leaveGame(room.id, bob.playerId);
    expect(onChange).toHaveBeenCalledWith(room);
    expect(battles.gameFor(bob.playerId)).toBeUndefined();
    const g = battles.gameFor(ann.playerId)!;
    expect(g.state.over).toEqual({ conceded: bobSeat });
    expect(onGameEnded).toHaveBeenCalledWith([bob.playerId]);
    expect(() => battles.act(room.id, bob.playerId, { type: 'draw', count: 1 })).toThrow('You are not in a game');
    expect(() => battles.act(room.id, ann.playerId, { type: 'draw', count: 1 })).toThrow('Game is over');
  });

  it('game deleted when both left', async () => {
    const t = await started();
    const { battles, room, ann, bob, onGameEnded } = t;
    battles.leaveGame(room.id, bob.playerId);
    battles.leaveGame(room.id, ann.playerId);
    expect(onGameEnded).toHaveBeenLastCalledWith([ann.playerId]);
    expect(t.clock.pending).toBe(0);
    t.clock.advance(ENDED_GAME_TTL_MS);
    expect(onGameEnded).toHaveBeenCalledTimes(2);
    expect(battles.gameFor(ann.playerId)).toBeUndefined();
    battles.challenge(room.id, ann.playerId, bob.playerId); // both free again
  });

  it('game deleted 5 minutes after it ended', async () => {
    const t = await started();
    const { battles, room, ann, bob, clock, onGameEnded, onChange } = t;
    battles.act(room.id, bob.playerId, { type: 'concede' });
    expect(battles.gameFor(ann.playerId)).toBeDefined();
    clock.advance(ENDED_GAME_TTL_MS - 1);
    expect(battles.gameFor(ann.playerId)).toBeDefined();
    onChange.mockClear();
    clock.advance(1);
    expect(onChange).toHaveBeenCalledWith(room);
    expect(onGameEnded).toHaveBeenCalledTimes(1);
    expect([...onGameEnded.mock.calls[0][0]].sort()).toEqual([ann.playerId, bob.playerId].sort());
    expect(battles.gameFor(ann.playerId)).toBeUndefined();
    expect(battles.gameFor(bob.playerId)).toBeUndefined();
  });

  it('sweep drops battles of deleted rooms', async () => {
    const t = await started();
    const { battles, manager, clock, room, ann, bob } = t;
    battles.leaveGame(room.id, bob.playerId); // leaves ann in an over game
    clock.now += ROOM_TTL_MS + 1;
    expect(manager.sweep()).toBe(1);
    battles.sweep();
    expect(battles.gameFor(ann.playerId)).toBeUndefined();
  });

  it('sweep drops challenges of deleted rooms', async () => {
    const { battles, manager, clock, room, ann, bob } = await setup();
    battles.challenge(room.id, ann.playerId, bob.playerId);
    clock.now += ROOM_TTL_MS + 1;
    manager.sweep();
    battles.sweep();
    expect(battles.incomingFor(bob.playerId)).toBeNull();
  });

  it('timer callbacks are error-guarded', async () => {
    const { battles, room, ann, bob, clock, onDeclined } = await setup();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    onDeclined.mockImplementation(() => {
      throw new Error('boom');
    });
    battles.challenge(room.id, ann.playerId, bob.playerId);
    expect(() => clock.advance(CHALLENGE_TTL_MS)).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
