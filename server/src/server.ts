import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, SetInfo } from '@mtg/shared';
import { InvalidPickError, seatView } from './draft/engine';
import { HUMAN_SEAT, type Room, type RoomManager } from './rooms/RoomManager';

interface SocketData {
  roomId?: string;
}

const message = (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error');

export function createDraftServer(deps: { manager: RoomManager; listSets: () => Promise<SetInfo[]> }) {
  const { manager } = deps;
  const httpServer = createServer();
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    cors: { origin: true },
  });

  io.on('connection', (socket) => {
    const emitRoom = (room: Room) => {
      if (room.state.complete) {
        socket.emit('draft:complete', { roomId: room.id, pool: room.state.picks[HUMAN_SEAT] });
      } else {
        socket.emit('draft:state', { roomId: room.id, view: seatView(room.state, HUMAN_SEAT) });
      }
    };
    const fail = (err: unknown) => socket.emit('practice:error', { message: message(err) });

    socket.on('sets:list', async (ack) => {
      if (typeof ack !== 'function') return;
      let result: Parameters<typeof ack>[0];
      try {
        result = { ok: true, sets: await deps.listSets() };
      } catch (err) {
        result = { ok: false, message: message(err) };
      }
      try {
        ack(result);
      } catch {
        // ack threw; never call it twice
      }
    });

    socket.on('practice:start', async (p) => {
      try {
        const setCode = (p as { setCode?: unknown } | null | undefined)?.setCode;
        if (typeof setCode !== 'string' || !setCode) throw new Error('Invalid set code');
        const room = await manager.createPracticeRoom(setCode);
        socket.data.roomId = room.id;
        emitRoom(room);
      } catch (err) {
        fail(err);
      }
    });

    socket.on('draft:pick', (p) => {
      const roomId = socket.data.roomId;
      if (!roomId) return fail(new Error('No active draft'));
      try {
        const instanceId = (p as { instanceId?: unknown } | null | undefined)?.instanceId;
        if (typeof instanceId !== 'string') throw new Error('Invalid pick');
        emitRoom(manager.pick(roomId, instanceId));
      } catch (err) {
        if (err instanceof InvalidPickError) {
          try {
            emitRoom(manager.get(roomId));
          } catch (err2) {
            fail(err2);
          }
        } else fail(err);
      }
    });

    socket.on('room:resume', (p) => {
      try {
        const roomId = (p as { roomId?: unknown } | null | undefined)?.roomId;
        if (typeof roomId !== 'string') throw new Error('Invalid room id');
        const room = manager.get(roomId);
        socket.data.roomId = room.id;
        emitRoom(room);
      } catch (err) {
        fail(err);
      }
    });

    socket.on('deck:save', (deck, ack) => {
      if (typeof ack !== 'function') return;
      let ok = true;
      try {
        manager.saveDeck(socket.data.roomId ?? '', deck);
      } catch {
        ok = false;
      }
      try {
        ack({ ok });
      } catch {
        // ignore
      }
    });
  });

  return { httpServer, io };
}
