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
      try {
        ack({ ok: true, sets: await deps.listSets() });
      } catch (err) {
        ack({ ok: false, message: message(err) });
      }
    });

    socket.on('practice:start', async ({ setCode }) => {
      try {
        const room = await manager.createPracticeRoom(String(setCode));
        socket.data.roomId = room.id;
        emitRoom(room);
      } catch (err) {
        fail(err);
      }
    });

    socket.on('draft:pick', ({ instanceId }) => {
      const roomId = socket.data.roomId;
      if (!roomId) return fail(new Error('No active draft'));
      try {
        emitRoom(manager.pick(roomId, String(instanceId)));
      } catch (err) {
        if (err instanceof InvalidPickError) emitRoom(manager.get(roomId));
        else fail(err);
      }
    });

    socket.on('room:resume', ({ roomId }) => {
      try {
        const room = manager.get(String(roomId));
        socket.data.roomId = room.id;
        emitRoom(room);
      } catch (err) {
        fail(err);
      }
    });

    socket.on('deck:save', (deck, ack) => {
      try {
        manager.saveDeck(socket.data.roomId ?? '', deck);
        ack({ ok: true });
      } catch {
        ack({ ok: false });
      }
    });
  });

  return { httpServer, io };
}
