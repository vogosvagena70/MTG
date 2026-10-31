import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import type { Card, ClientToServerEvents, DraftStatePayload, LobbyView, ServerToClientEvents, SetCards } from '@mtg/shared';
import { RoomManager } from '../src/rooms/manager';
import { createDraftServer } from '../src/server';
import { FakeClock, makeSet } from './helpers';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let url = '';
let close: () => Promise<void>;
let clock: FakeClock;
const clients: ClientSocket[] = [];

function connect(): ClientSocket {
  const c: ClientSocket = ioc(url, { transports: ['websocket'], forceNew: true });
  clients.push(c);
  return c;
}

async function start(getSetCards: (code: string) => Promise<SetCards> = async () => makeSet()) {
  clock = new FakeClock();
  const manager = new RoomManager({ getSetCards, getSetName: async () => 'Test Set', seed: () => 1, now: () => clock.now, scheduler: clock });
  const { httpServer, io } = createDraftServer({
    manager,
    listSets: async () => [{ code: 'tst', name: 'Test Set', releasedAt: '2026-01-01', iconSvgUri: '' }],
    now: () => clock.now,
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
    const kicked = waitFor(a, 'room:error');
    const b = connect();
    await b.emitWithAck('room:resume', { code: created.code, token: created.token });
    expect(await kicked).toEqual({ message: 'Opened in another tab' });
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
      throw new Error('No booster cards found for set "zzz"');
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
