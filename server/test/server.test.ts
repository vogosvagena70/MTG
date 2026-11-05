import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import type { Card, ClientToServerEvents, DraftStatePayload, LobbyView, ServerToClientEvents, SetCards } from '@mtg/shared';
import { ScryfallError } from '../src/cards/client';
import { Battles } from '../src/rooms/battles';
import { RoomManager } from '../src/rooms/manager';
import { createDraftServer } from '../src/server';
import { FakeClock, makeSet } from './helpers';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let url = '';
let close: () => Promise<void>;
let clock: FakeClock;
let manager: RoomManager;
let battles: Battles | undefined;
const clients: ClientSocket[] = [];

function connect(): ClientSocket {
  const c: ClientSocket = ioc(url, { transports: ['websocket'], forceNew: true });
  clients.push(c);
  return c;
}

async function start(getSetCards: (code: string) => Promise<SetCards> = async () => makeSet(), withBattles = false) {
  clock = new FakeClock();
  battles = undefined;
  manager = new RoomManager({ getSetCards, getSetName: async () => 'Test Set', seed: () => 1, now: () => clock.now, scheduler: clock });
  const { httpServer, io } = createDraftServer({
    manager,
    listSets: async () => [{ code: 'tst', name: 'Test Set', releasedAt: '2026-01-01', iconSvgUri: '' }],
    getSetCards,
    now: () => clock.now,
    createBattles: withBattles
      ? (hooks) => (battles = new Battles({ manager, now: () => clock.now, scheduler: clock, seed: () => 7, ...hooks }))
      : undefined,
  });
  await new Promise<void>((r) => httpServer.listen(0, r));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
  close = () => new Promise((r) => io.close(() => r()));
}

/** Resolves with the first event payload matching `test`. */
function waitFor<E extends keyof ServerToClientEvents>(
  c: ClientSocket,
  event: E,
  test: (p: Parameters<ServerToClientEvents[E]>[0]) => boolean = () => true,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve) => {
    const handler = (p: Parameters<ServerToClientEvents[E]>[0]) => {
      if (!test(p)) return;
      c.off(event, handler as never);
      resolve(p);
    };
    c.on(event, handler as never);
  });
}

/** Picks the first card whenever a pack is shown; resolves with the final pool. */
function autoDraft(c: ClientSocket): Promise<Card[]> {
  return new Promise((resolve) => {
    c.on('draft:state', ({ view }) => {
      if (view.currentPack?.length) c.emit('draft:pick', { instanceId: view.currentPack[0].instanceId });
    });
    c.on('draft:complete', ({ pool }) => resolve(pool));
  });
}

async function createRoom(c: ClientSocket, extra: Partial<{ timerSeconds: number | null; practice: boolean }> = {}) {
  const res = await c.emitWithAck('room:create', { name: 'Ann', setCode: 'tst', timerSeconds: null, ...extra });
  if (!res.ok) throw new Error(res.message);
  return res;
}

beforeEach(() => start());
afterEach(async () => {
  clients.splice(0).forEach((c) => c.close());
  await close();
});

describe('draft server', () => {
  it('lists sets', async () => {
    expect(await connect().emitWithAck('sets:list')).toEqual({ ok: true, sets: [expect.objectContaining({ code: 'tst' })] });
  });

  it('runs a two-player room from lobby to saved decks', async () => {
    const ann = connect();
    const bob = connect();
    const annLobby = waitFor(ann, 'room:lobby', (l) => l.players.length === 2);
    const created = await createRoom(ann);
    const joined = await bob.emitWithAck('room:join', { code: created.code.toLowerCase(), name: 'Bob' });
    expect(joined).toMatchObject({ ok: true, code: created.code });
    const lobby: LobbyView = await annLobby;
    expect(lobby.players.map((p) => p.name)).toEqual(['Ann', 'Bob']);
    expect(lobby.hostPlayerId).toBe(created.playerId);

    const pools = Promise.all([autoDraft(ann), autoDraft(bob)]);
    expect(await bob.emitWithAck('room:start', {})).toEqual({ ok: false, message: 'Only the host can start the draft' });
    expect(await ann.emitWithAck('room:start', {})).toEqual({ ok: true });
    const [annPool, bobPool] = await pools;
    expect(annPool).toHaveLength(45);
    expect(bobPool).toHaveLength(45);
    const annIds = new Set(annPool.map((c) => c.instanceId));
    expect(bobPool.some((c) => annIds.has(c.instanceId))).toBe(false);
    const saved = await ann.emitWithAck('deck:save', { main: annPool.slice(0, 23).map((c) => c.instanceId), basics: { W: 0, U: 0, B: 0, R: 8, G: 9 } });
    expect(saved).toEqual({ ok: true });
  });

  it('shows who has picked in the table strip', async () => {
    const ann = connect();
    const bob = connect();
    const created = await createRoom(ann);
    await bob.emitWithAck('room:join', { code: created.code, name: 'Bob' });
    const annFirst = waitFor(ann, 'draft:state');
    await ann.emitWithAck('room:start', {});
    const first: DraftStatePayload = await annFirst;
    expect(first.table).toHaveLength(8);
    const bobSees = waitFor(bob, 'draft:state', (s) => s.table.some((t) => t.name === 'Ann' && t.picked));
    ann.emit('draft:pick', { instanceId: first.view.currentPack![0].instanceId });
    const seen = await bobSees;
    expect(seen.table.find((t) => t.isYou)).toMatchObject({ name: 'Bob', picked: false });
    expect(seen.view.pickNumber).toBe(1);
  });

  it('auto-picks for a player who lets the timer run out', async () => {
    const ann = connect();
    const bob = connect();
    const created = await createRoom(ann, { timerSeconds: 30 });
    await bob.emitWithAck('room:join', { code: created.code, name: 'Bob' });
    const annFirst = waitFor(ann, 'draft:state');
    await ann.emitWithAck('room:start', {});
    const first = await annFirst;
    expect(first.pickDeadline).toBe(clock.now + 30_000);
    const picked = waitFor(ann, 'draft:state', (s) => s.view.currentPack === null);
    ann.emit('draft:pick', { instanceId: first.view.currentPack![0].instanceId });
    await picked;
    const next = waitFor(ann, 'draft:state', (s) => s.view.pickNumber === 2);
    clock.advance(30_000);
    expect((await next).view.currentPack).toHaveLength(14);
  });

  it('restores a seat from its token on a new connection', async () => {
    const a = connect();
    const firstState = waitFor(a, 'draft:state');
    const created = await createRoom(a, { practice: true });
    await firstState;
    a.close();
    const b = connect();
    const restored = waitFor(b, 'draft:state');
    const res = await b.emitWithAck('room:resume', { code: created.code, token: created.token });
    expect(res).toEqual({ ok: true, code: created.code, playerId: created.playerId });
    const state = await restored;
    expect(state.view).toMatchObject({ packNumber: 1, pickNumber: 1 });
    expect(state.view.currentPack).toHaveLength(15);
  });

  it('tells the older tab when the same seat is opened elsewhere', async () => {
    const a = connect();
    const created = await createRoom(a);
    const kicked = waitFor(a, 'room:takeover');
    const b = connect();
    await b.emitWithAck('room:resume', { code: created.code, token: created.token });
    await kicked;
  });

  it('keeps the current lobby when a join fails', async () => {
    const ann = connect();
    await createRoom(ann);
    expect(await ann.emitWithAck('room:join', { code: 'ZZZZ', name: 'Ann' })).toEqual({ ok: false, message: 'Room not found' });
    expect(manager.size).toBe(1);
    expect(await ann.emitWithAck('room:start', {})).toEqual({ ok: true });
  });

  it('rejects a second create while one is pending and cleans up if the socket left', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await close();
    await start(async () => {
      await gate;
      return makeSet();
    });
    const c = connect();
    c.emitWithAck('room:create', { name: 'A', setCode: 'tst', timerSeconds: null }).catch(() => {});
    const second = await c.emitWithAck('room:create', { name: 'A', setCode: 'tst', timerSeconds: null });
    expect(second).toEqual({ ok: false, message: 'Already creating a room' });
    c.close();
    await new Promise((r) => setTimeout(r, 50));
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(manager.size).toBe(0);
  });

  it('runs a practice draft end to end', async () => {
    const c = connect();
    const pool = autoDraft(c);
    await createRoom(c, { practice: true });
    expect(await pool).toHaveLength(45);
  });

  it('reports errors through acks', async () => {
    const c = connect();
    expect(await c.emitWithAck('room:join', { code: 'ZZZZ', name: 'B' })).toEqual({ ok: false, message: 'Room not found' });
    expect(await c.emitWithAck('room:start', {})).toEqual({ ok: false, message: 'You are not in a room' });
    expect(await c.emitWithAck('room:resume', { code: 'ZZZZ', token: 'x' })).toEqual({ ok: false, message: 'Session not found or expired' });

    await close();
    await start(async () => {
      throw new ScryfallError('No booster cards found for set "zzz"');
    });
    const c2 = connect();
    const res = await c2.emitWithAck('room:create', { name: 'A', setCode: 'zzz', timerSeconds: null });
    expect(res).toEqual({ ok: false, message: 'No booster cards found for set "zzz"' });
  });

  it('limits room creation to 2 per minute per connection', async () => {
    const c = connect();
    await createRoom(c);
    await createRoom(c);
    const third = await c.emitWithAck('room:create', { name: 'A', setCode: 'tst', timerSeconds: null });
    expect(third).toEqual({ ok: false, message: 'Too many rooms created, wait a minute' });
    clock.advance(60_000);
    expect((await c.emitWithAck('room:create', { name: 'A', setCode: 'tst', timerSeconds: null })).ok).toBe(true);
  });

  it('survives malformed payloads and missing acks', async () => {
    const c = connect() as unknown as {
      emit: (...a: unknown[]) => void;
      emitWithAck: (...a: unknown[]) => Promise<unknown>;
    };
    expect(await c.emitWithAck('room:create', null)).toMatchObject({ ok: false });
    expect(await c.emitWithAck('room:resume', null)).toMatchObject({ ok: false });
    c.emit('room:join', { code: 'ZZZZ', name: 'x' });
    c.emit('room:create', { name: 'A', setCode: 'tst', timerSeconds: null });
    c.emit('draft:pick', null);
    c.emit('deck:save', null);
    c.emit('room:leave', null);
    c.emit('sets:list');
    expect(await c.emitWithAck('sets:list')).toMatchObject({ ok: true });
  });
});

describe('battles', () => {
  async function table() {
    await close();
    await start(async () => makeSet(), true);
    const ann = connect();
    const bob = connect();
    const created = await createRoom(ann);
    const joined = await bob.emitWithAck('room:join', { code: created.code, name: 'Bob' });
    if (!joined.ok) throw new Error(joined.message);
    const pools = Promise.all([autoDraft(ann), autoDraft(bob)]);
    await ann.emitWithAck('room:start', {});
    const [annPool, bobPool] = await pools;
    const basics = { W: 0, U: 0, B: 0, R: 8, G: 9 };
    for (const [c, pool] of [[ann, annPool], [bob, bobPool]] as const) {
      const res = await c.emitWithAck('deck:save', { main: pool.slice(0, 23).map((x) => x.instanceId), basics });
      expect(res.ok).toBe(true);
    }
    return { ann, bob, annId: created.playerId, bobId: joined.playerId, code: created.code, annToken: created.token, bobToken: joined.token };
  }

  async function startGame(t: Awaited<ReturnType<typeof table>>) {
    const challenged = waitFor(t.bob, 'battle:challenged');
    expect(await t.ann.emitWithAck('battle:challenge', { playerId: t.bobId })).toEqual({ ok: true });
    expect((await challenged).fromName).toBe('Ann');
    const annState = waitFor(t.ann, 'game:state');
    const bobState = waitFor(t.bob, 'game:state');
    expect(await t.bob.emitWithAck('battle:respond', { accept: true })).toEqual({ ok: true });
    return { a: await annState, b: await bobState };
  }

  it('challenge, accept, play, hidden info', async () => {
    const t = await table();
    const { a, b } = await startGame(t);
    expect(a.me.hand).toHaveLength(7);
    const bobNext = waitFor(t.bob, 'game:state', (v) => v.opp.handCount === 8);
    expect(await t.ann.emitWithAck('game:action', { type: 'draw', count: 1 })).toEqual({ ok: true });
    const seen = await bobNext;
    expect(seen.opp.handCount).toBe(8);
    const json = JSON.stringify(seen);
    for (const c of a.me.hand) expect(json).not.toContain(`"${c.gid}"`);
    expect(b.opp.handCount).toBe(7);

    const card = a.me.hand[0];
    const bobSees = waitFor(t.bob, 'game:state', (v) => v.opp.battlefield.some((c) => c.gid === card.gid));
    expect(await t.ann.emitWithAck('game:action', { type: 'move', gid: card.gid, to: 'battlefield' })).toEqual({ ok: true });
    expect((await bobSees).opp.battlefield).toHaveLength(1);
  });

  it('rejected actions return a message', async () => {
    const t = await table();
    await startGame(t);
    expect(await t.ann.emitWithAck('game:action', { type: 'draw', count: 9 })).toEqual({ ok: false, message: 'Invalid action' });
  });

  it('concede, leave, rematch', async () => {
    const t = await table();
    const { a } = await startGame(t);
    const conceded = waitFor(t.bob, 'game:state', (v) => v.over !== null);
    expect(await t.ann.emitWithAck('game:action', { type: 'concede' })).toEqual({ ok: true });
    const over = await conceded;
    expect(over.over?.conceded).toBe(a.you);

    const annEnded = waitFor(t.ann, 'game:ended');
    const bobEnded = waitFor(t.bob, 'game:ended');
    expect(await t.ann.emitWithAck('game:leave', {})).toEqual({ ok: true });
    expect(await t.bob.emitWithAck('game:leave', {})).toEqual({ ok: true });
    await annEnded;
    await bobEnded;
    const idle = waitFor(t.ann, 'battle:roster', (r) => r.players.every((p) => !p.inGame));
    expect(await t.ann.emitWithAck('battle:challenge', { playerId: t.bobId })).toEqual({ ok: true });
    await idle;
    const next = waitFor(t.ann, 'game:state');
    expect(await t.bob.emitWithAck('battle:respond', { accept: true })).toEqual({ ok: true });
    expect((await next).gameId).not.toBe(a.gameId);
  });

  it('reload restores the table and a pending challenge', async () => {
    const t = await table();
    await startGame(t);
    const bob2 = connect();
    const complete = waitFor(bob2, 'draft:complete');
    const roster = waitFor(bob2, 'battle:roster');
    const state = waitFor(bob2, 'game:state');
    const res = await bob2.emitWithAck('room:resume', { code: t.code, token: t.bobToken });
    expect(res.ok).toBe(true);
    await complete;
    expect((await roster).players).toHaveLength(2);
    expect((await state).you).toBeDefined();
  });

  it('restores a pending challenge on resume', async () => {
    const t = await table();
    expect(await t.ann.emitWithAck('battle:challenge', { playerId: t.bobId })).toEqual({ ok: true });
    const bob2 = connect();
    const challenged = waitFor(bob2, 'battle:challenged');
    await bob2.emitWithAck('room:resume', { code: t.code, token: t.bobToken });
    expect((await challenged).fromName).toBe('Ann');
  });

  it('notifies the challenger when declined', async () => {
    const t = await table();
    await t.ann.emitWithAck('battle:challenge', { playerId: t.bobId });
    const declined = waitFor(t.ann, 'battle:declined');
    await t.bob.emitWithAck('battle:respond', { accept: false });
    expect(await declined).toEqual({ byName: 'Bob', reason: 'declined' });
  });

  it('malformed battle payloads do not crash', async () => {
    const t = await table();
    const a = t.ann as unknown as { emitWithAck: (...x: unknown[]) => Promise<unknown> };
    expect(await a.emitWithAck('battle:challenge', null)).toMatchObject({ ok: false });
    expect(await a.emitWithAck('game:action', null)).toMatchObject({ ok: false });
    expect(await a.emitWithAck('battle:respond', { accept: 'yes' })).toMatchObject({ ok: false });
    expect(await a.emitWithAck('sets:list')).toMatchObject({ ok: true });
  });

  it('refreshes every roster when a deck is saved', async () => {
    await close();
    await start(async () => makeSet(), true);
    const ann = connect();
    const bob = connect();
    const created = await createRoom(ann);
    await bob.emitWithAck('room:join', { code: created.code, name: 'Bob' });
    const pools = Promise.all([autoDraft(ann), autoDraft(bob)]);
    await ann.emitWithAck('room:start', {});
    const [annPool, bobPool] = await pools;
    const bothSaved = (r: { players: { deckSaved: boolean }[] }) => r.players.length === 2 && r.players.every((p) => p.deckSaved);
    const annRoster = waitFor(ann, 'battle:roster', bothSaved);
    const bobRoster = waitFor(bob, 'battle:roster', bothSaved);
    const basics = { W: 0, U: 0, B: 0, R: 8, G: 9 };
    await ann.emitWithAck('deck:save', { main: annPool.slice(0, 23).map((x) => x.instanceId), basics });
    await bob.emitWithAck('deck:save', { main: bobPool.slice(0, 23).map((x) => x.instanceId), basics });
    await annRoster;
    await bobRoster;
  });

  it('game actions reach only the two players in the game', async () => {
    await close();
    await start(async () => makeSet(), true);
    const ann = connect();
    const bob = connect();
    const carl = connect();
    const created = await createRoom(ann);
    const joinedBob = await bob.emitWithAck('room:join', { code: created.code, name: 'Bob' });
    await carl.emitWithAck('room:join', { code: created.code, name: 'Carl' });
    if (!joinedBob.ok) throw new Error(joinedBob.message);
    const pools = Promise.all([autoDraft(ann), autoDraft(bob), autoDraft(carl)]);
    await ann.emitWithAck('room:start', {});
    const [annPool, bobPool] = await pools;
    const basics = { W: 0, U: 0, B: 0, R: 8, G: 9 };
    await ann.emitWithAck('deck:save', { main: annPool.slice(0, 23).map((x) => x.instanceId), basics });
    await bob.emitWithAck('deck:save', { main: bobPool.slice(0, 23).map((x) => x.instanceId), basics });
    const bobState = waitFor(bob, 'game:state');
    await ann.emitWithAck('battle:challenge', { playerId: joinedBob.playerId });
    await bob.emitWithAck('battle:respond', { accept: true });
    await bobState;
    await new Promise((r) => setTimeout(r, 100));
    const seen: string[] = [];
    carl.on('draft:complete', () => seen.push('draft:complete'));
    carl.on('battle:roster', () => seen.push('battle:roster'));
    const bobNext = waitFor(bob, 'game:state', (v) => v.opp.handCount === 8);
    expect(await ann.emitWithAck('game:action', { type: 'draw', count: 1 })).toEqual({ ok: true });
    await bobNext;
    await new Promise((r) => setTimeout(r, 100));
    expect(seen).toEqual([]);
  });

  it('does not leak internal error text', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await close();
    await start(async () => {
      throw new TypeError('secret internal detail');
    });
    const c = connect();
    const res = await c.emitWithAck('room:create', { name: 'A', setCode: 'zzz', timerSeconds: null });
    expect(res).toEqual({ ok: false, message: 'Unexpected error' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('reports battles as unavailable when not configured', async () => {
    await close();
    await start();
    const c = connect();
    await createRoom(c);
    expect(await c.emitWithAck('battle:challenge', { playerId: 'x' })).toEqual({ ok: false, message: 'Battles are not available' });
  });

  it('opens a solo test table without a room', async () => {
    const c = connect();
    const first = waitFor(c, 'game:state');
    expect(await c.emitWithAck('game:sandbox', { setCode: 'tst', name: 'Sam' })).toEqual({ ok: true });
    const view = await first;
    expect(view.me.name).toBe('Sam');
    expect(view.me.hand).toHaveLength(7);
    expect(view.opp.handCount).toBe(7);

    const drawn = waitFor(c, 'game:state', (v) => v.me.hand.length === 8);
    expect(await c.emitWithAck('game:action', { type: 'draw', count: 1 })).toEqual({ ok: true });
    expect((await drawn).me.libraryCount).toBe(32);

    expect(await c.emitWithAck('game:leave', {})).toEqual({ ok: true });
    expect(await c.emitWithAck('game:action', { type: 'draw', count: 1 })).toEqual({ ok: false, message: 'Battles are not available' });
  });
});
