import { createServer, type RequestListener } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, SetInfo } from '@mtg/shared';
import { InvalidPickError } from './draft/engine';
import { gameViewFor } from './game/view';
import type { Battles, BattlesDeps } from './rooms/battles';
import { rosterFor } from './rooms/battleViews';
import type { HumanSeat, Room, RoomManager } from './rooms/manager';
import { completeFor, draftStateFor, lobbyView } from './rooms/views';

interface SocketData {
  roomId?: string;
  playerId?: string;
  creates?: number[];
  creating?: boolean;
}
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export const CREATE_LIMIT = 2;
export const CREATE_WINDOW_MS = 60_000;

const message = (err: unknown) => (err instanceof Error ? err.message : 'Unexpected error');
const field = (p: unknown, key: string): unknown =>
  p && typeof p === 'object' ? (p as Record<string, unknown>)[key] : undefined;

function reply(ack: unknown, res: unknown): void {
  if (typeof ack !== 'function') return;
  try {
    ack(res);
  } catch {
    // never call an ack twice
  }
}

export function createDraftServer(deps: {
  manager: RoomManager;
  listSets: () => Promise<SetInfo[]>;
  requestListener?: RequestListener;
  now?: () => number;
  /** Builds the Battles service, wired to this server's socket broadcasts. */
  createBattles?: (hooks: Pick<BattlesDeps, 'onChange' | 'onDeclined' | 'onGameEnded'>) => Battles;
}) {
  const { manager } = deps;
  const now = deps.now ?? Date.now;
  const httpServer = deps.requestListener ? createServer(deps.requestListener) : createServer();
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer);

  const sendRoomTo = (socket: AppSocket, room: Room, player: HumanSeat) => {
    if (room.phase === 'lobby') socket.emit('room:lobby', lobbyView(room));
    else if (room.phase === 'drafting') socket.emit('draft:state', draftStateFor(room, player.playerId));
    else socket.emit('draft:complete', completeFor(room, player.playerId));
  };

  const sendBattleTo = (socket: AppSocket, room: Room, player: HumanSeat) => {
    if (!battles || room.phase !== 'complete' || room.practice) return;
    socket.emit('battle:roster', { players: rosterFor(room, battles, player.playerId) });
    const incoming = battles.incomingFor(player.playerId);
    if (incoming) socket.emit('battle:challenged', incoming);
    const game = battles.gameFor(player.playerId);
    if (game && game.roomId === room.id) {
      const seat = game.state.players[0].playerId === player.playerId ? 0 : 1;
      const connected = game.state.players.map(
        (gp) => room.players.find((rp) => rp.playerId === gp.playerId)?.socketId != null,
      ) as [boolean, boolean];
      socket.emit('game:state', gameViewFor(game.state, seat, connected));
    }
  };

  const broadcast = (room: Room) => {
    for (const player of room.players) {
      if (!player.socketId) continue;
      try {
        const socket = io.sockets.sockets.get(player.socketId);
        if (!socket) continue;
        sendRoomTo(socket, room, player);
        sendBattleTo(socket, room, player);
      } catch (err) {
        console.error('[server] failed to send room update', err);
      }
    }
  };
  manager.onChange = broadcast;

  const battles = deps.createBattles?.({
    onChange: broadcast,
    onDeclined: (room, challengerId, byName, reason) => {
      try {
        const sid = room.players.find((p) => p.playerId === challengerId)?.socketId;
        if (sid) io.sockets.sockets.get(sid)?.emit('battle:declined', { byName, reason });
      } catch (err) {
        console.error('[server] failed to send decline', err);
      }
    },
    onGameEnded: (playerIds) => {
      for (const id of playerIds) {
        try {
          for (const s of io.sockets.sockets.values()) {
            if (s.data.playerId === id) s.emit('game:ended', {});
          }
        } catch (err) {
          console.error('[server] failed to send game end', err);
        }
      }
    },
  });

  io.on('connection', (socket) => {
    const bind = (room: Room, player: HumanSeat) => {
      socket.data.roomId = room.id;
      socket.data.playerId = player.playerId;
    };
    const unbind = () => {
      delete socket.data.roomId;
      delete socket.data.playerId;
    };
    const leaveCurrent = () => {
      const { roomId, playerId } = socket.data;
      if (roomId && playerId) {
        try {
          manager.leave(roomId, playerId);
        } catch {
          // room already gone
        }
      }
      unbind();
    };
    const current = (): { room: Room; player: HumanSeat } | null => {
      const { roomId, playerId } = socket.data;
      if (!roomId || !playerId) return null;
      try {
        const room = manager.get(roomId);
        const player = room.players.find((p) => p.playerId === playerId);
        return player ? { room, player } : null;
      } catch {
        return null;
      }
    };

    socket.on('sets:list', async (ack) => {
      if (typeof ack !== 'function') return;
      let res: unknown;
      try {
        res = { ok: true, sets: await deps.listSets() };
      } catch (err) {
        res = { ok: false, message: message(err) };
      }
      reply(ack, res);
    });

    socket.on('room:create', async (p, ack) => {
      if (typeof ack !== 'function') return;
      if (socket.data.creating) return reply(ack, { ok: false, message: 'Already creating a room' });
      const t = now();
      const recent = (socket.data.creates ?? []).filter((at) => t - at < CREATE_WINDOW_MS);
      if (recent.length >= CREATE_LIMIT) return reply(ack, { ok: false, message: 'Too many rooms created, wait a minute' });
      socket.data.creates = [...recent, t];
      socket.data.creating = true;
      try {
        const { room, player } = await manager.createRoom({
          name: field(p, 'name'),
          setCode: field(p, 'setCode'),
          timerSeconds: field(p, 'timerSeconds'),
          practice: field(p, 'practice'),
          socketId: socket.id,
        });
        if (!socket.connected) {
          manager.leave(room.id, player.playerId);
          return;
        }
        leaveCurrent();
        bind(room, player);
        reply(ack, { ok: true, code: room.code, playerId: player.playerId, token: player.token });
      } catch (err) {
        reply(ack, { ok: false, message: message(err) });
      } finally {
        socket.data.creating = false;
      }
    });

    socket.on('room:join', (p, ack) => {
      if (typeof ack !== 'function') return;
      try {
        const { room, player } = manager.joinRoom({ code: field(p, 'code'), name: field(p, 'name'), socketId: socket.id });
        leaveCurrent();
        bind(room, player);
        reply(ack, { ok: true, code: room.code, playerId: player.playerId, token: player.token });
      } catch (err) {
        reply(ack, { ok: false, message: message(err) });
      }
    });

    socket.on('room:resume', (p, ack) => {
      if (typeof ack !== 'function') return;
      const previous = { ...socket.data };
      try {
        const res = manager.resume({ code: field(p, 'code'), token: field(p, 'token'), socketId: socket.id });
        if (res.replacedSocketId) {
          const old = io.sockets.sockets.get(res.replacedSocketId);
          if (old) {
            old.emit('room:takeover');
            delete old.data.roomId;
            delete old.data.playerId;
          }
        }
        if (previous.roomId && previous.playerId && previous.playerId !== res.player.playerId) {
          try {
            manager.leave(previous.roomId, previous.playerId);
          } catch {
            // ignore
          }
        }
        bind(res.room, res.player);
        reply(ack, { ok: true, code: res.room.code, playerId: res.player.playerId });
      } catch (err) {
        reply(ack, { ok: false, message: message(err) });
      }
    });

    socket.on('room:start', (_p, ack) => {
      if (typeof ack !== 'function') return;
      const cur = current();
      if (!cur) return reply(ack, { ok: false, message: 'You are not in a room' });
      try {
        manager.startRoom(cur.room.id, cur.player.playerId);
        reply(ack, { ok: true });
      } catch (err) {
        reply(ack, { ok: false, message: message(err) });
      }
    });

    socket.on('room:leave', (_p, ack) => {
      leaveCurrent();
      reply(ack, { ok: true });
    });

    socket.on('draft:pick', (p) => {
      const cur = current();
      const instanceId = field(p, 'instanceId');
      if (!cur || typeof instanceId !== 'string') return;
      try {
        manager.pick(cur.room.id, cur.player.playerId, instanceId);
      } catch (err) {
        if (err instanceof InvalidPickError) sendRoomTo(socket, cur.room, cur.player);
        else socket.emit('room:error', { message: message(err) });
      }
    });

    socket.on('deck:save', (deck, ack) => {
      if (typeof ack !== 'function') return;
      const cur = current();
      if (!cur) return reply(ack, { ok: false, message: 'Room not found or expired' });
      try {
        manager.saveDeck(cur.room.id, cur.player.playerId, deck);
        reply(ack, { ok: true });
      } catch (err) {
        reply(ack, { ok: false, message: message(err) });
      }
    });

    const battleAction = (ack: unknown, run: (b: Battles, cur: { room: Room; player: HumanSeat }) => void) => {
      if (typeof ack !== 'function') return;
      if (!battles) return reply(ack, { ok: false, message: 'Battles are not available' });
      const cur = current();
      if (!cur) return reply(ack, { ok: false, message: 'You are not in a room' });
      try {
        run(battles, cur);
        reply(ack, { ok: true });
      } catch (err) {
        reply(ack, { ok: false, message: message(err) });
      }
    };

    socket.on('battle:challenge', (p, ack) =>
      battleAction(ack, (b, cur) => {
        const target = field(p, 'playerId');
        if (typeof target !== 'string') throw new Error('Invalid challenge');
        b.challenge(cur.room.id, cur.player.playerId, target);
      }),
    );

    socket.on('battle:respond', (p, ack) =>
      battleAction(ack, (b, cur) => {
        const accept = field(p, 'accept');
        if (typeof accept !== 'boolean') throw new Error('Invalid response');
        b.respond(cur.room.id, cur.player.playerId, accept);
      }),
    );

    socket.on('game:action', (p, ack) =>
      battleAction(ack, (b, cur) => b.act(cur.room.id, cur.player.playerId, p)),
    );

    socket.on('game:leave', (_p, ack) =>
      battleAction(ack, (b, cur) => b.leaveGame(cur.room.id, cur.player.playerId)),
    );

    socket.on('disconnect', () => manager.disconnect(socket.id));
  });

  return { httpServer, io };
}
