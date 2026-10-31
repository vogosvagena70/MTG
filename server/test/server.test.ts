import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import type { Card, ClientToServerEvents, ServerToClientEvents } from '@mtg/shared';
import { RoomManager } from '../src/rooms/RoomManager';
import { createDraftServer } from '../src/server';
import { makeSet } from './helpers';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let url = '';
let close: () => Promise<void>;
const clients: ClientSocket[] = [];

function connect(): ClientSocket {
  const c: ClientSocket = ioc(url, { transports: ['websocket'], forceNew: true });
  clients.push(c);
  return c;
}

async function start(getSetCards = async () => makeSet()) {
  const manager = new RoomManager({ getSetCards, seed: () => 1 });
  const { httpServer, io } = createDraftServer({
    manager,
    listSets: async () => [{ code: 'tst', name: 'Test Set', releasedAt: '2026-01-01', iconSvgUri: '' }],
  });
  await new Promise<void>((r) => httpServer.listen(0, r));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
  close = () => new Promise((r) => io.close(() => r()));
}

beforeEach(() => start());
afterEach(async () => {
  clients.splice(0).forEach((c) => c.close());
  await close();
});

describe('draft server', () => {
  it('lists sets', async () => {
    const res = await connect().emitWithAck('sets:list');
    expect(res).toEqual({ ok: true, sets: [expect.objectContaining({ code: 'tst' })] });
  });

  it('runs a full practice draft to completion', async () => {
    const client = connect();
    const pool = await new Promise<Card[]>((resolve) => {
      client.on('draft:state', ({ view }) => client.emit('draft:pick', { instanceId: view.currentPack![0].instanceId }));
      client.on('draft:complete', ({ pool }) => resolve(pool));
      client.emit('practice:start', { setCode: 'tst' });
    });
    expect(pool).toHaveLength(45);
    const res = await client.emitWithAck('deck:save', {
      main: pool.slice(0, 23).map((c) => c.instanceId),
      basics: { W: 0, U: 0, B: 0, R: 8, G: 9 },
    });
    expect(res).toEqual({ ok: true });
  });

  it('re-emits unchanged state on an invalid pick', async () => {
    const client = connect();
    const first = await new Promise<{ roomId: string }>((r) => {
      client.once('draft:state', r);
      client.emit('practice:start', { setCode: 'tst' });
    });
    const again = await new Promise<{ roomId: string; view: { pickNumber: number } }>((r) => {
      client.once('draft:state', r);
      client.emit('draft:pick', { instanceId: 'bogus' });
    });
    expect(again.roomId).toBe(first.roomId);
    expect(again.view.pickNumber).toBe(1);
  });

  it('resumes a draft from another connection', async () => {
    const a = connect();
    const { roomId } = await new Promise<{ roomId: string }>((r) => {
      a.once('draft:state', r);
      a.emit('practice:start', { setCode: 'tst' });
    });
    const b = connect();
    const resumed = await new Promise<{ roomId: string; view: { currentPack: Card[] | null } }>((r) => {
      b.once('draft:state', r);
      b.emit('room:resume', { roomId });
    });
    expect(resumed.roomId).toBe(roomId);
    expect(resumed.view.currentPack).toHaveLength(15);
  });

  it('reports errors for unknown rooms and failed set loads', async () => {
    const client = connect();
    const missing = await new Promise<{ message: string }>((r) => {
      client.once('practice:error', r);
      client.emit('room:resume', { roomId: 'nope' });
    });
    expect(missing.message).toBe('Draft not found or expired');

    await close();
    await start(async () => {
      throw new Error('No booster cards found for set "zzz"');
    });
    const c2 = connect();
    const failed = await new Promise<{ message: string }>((r) => {
      c2.once('practice:error', r);
      c2.emit('practice:start', { setCode: 'zzz' });
    });
    expect(failed.message).toBe('No booster cards found for set "zzz"');
  });
});
