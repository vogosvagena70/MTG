import { randomUUID } from 'node:crypto';
import { TIMER_OPTIONS, type DeckSavePayload, type SetCards } from '@mtg/shared';
import type { DraftState } from '../draft/engine';
import { mulberry32, type Rng } from '../rng';
import { generateCode, newToken, normalizeCode, sanitizeName, uniqueName } from './identity';
import { realScheduler, type Scheduler } from './scheduler';

export const SEATS = 8;
export const MAX_PLAYERS = 8;
export const MAX_ROOMS = 200;
export const ROOM_TTL_MS = 30 * 60 * 1000;
export const EMPTY_LOBBY_TTL_MS = 5 * 60 * 1000;
export const DISCONNECT_GRACE_MS = 5000;

export interface HumanSeat {
  kind: 'human';
  playerId: string;
  name: string;
  token: string;
  socketId: string | null;
}
export interface BotSeat {
  kind: 'bot';
}
export type Seat = HumanSeat | BotSeat;

export interface Room {
  id: string;
  code: string;
  setCode: string;
  setName: string;
  set: SetCards;
  timerSeconds: number | null;
  practice: boolean;
  hostPlayerId: string;
  phase: 'lobby' | 'drafting' | 'complete';
  players: HumanSeat[]; // join order; the same objects appear in `seats` after start
  seats: Seat[]; // empty until start, then length SEATS
  state: DraftState | null;
  round: number; // increments every time packs pass
  pickDeadline: number | null;
  rng: Rng;
  decks: Map<string, DeckSavePayload>;
  lastActivity: number;
  roundTimer: unknown | null;
  graceTimers: Map<string, unknown>; // playerId -> handle
}

export interface SeatResult {
  room: Room;
  player: HumanSeat;
}

export class RoomError extends Error {}

export interface RoomManagerDeps {
  getSetCards(code: string): Promise<SetCards>;
  getSetName?(code: string): Promise<string | undefined>;
  seed?: () => number;
  now?: () => number;
  scheduler?: Scheduler;
  onChange?: (room: Room) => void;
}

function parseTimer(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' && (TIMER_OPTIONS as readonly number[]).includes(raw)) return raw;
  throw new RoomError('Invalid pick timer');
}

export class RoomManager {
  onChange: (room: Room) => void;
  private rooms = new Map<string, Room>();
  private seed: () => number;
  private now: () => number;
  private scheduler: Scheduler;

  constructor(private deps: RoomManagerDeps) {
    this.seed = deps.seed ?? (() => Math.floor(Math.random() * 2 ** 32));
    this.now = deps.now ?? Date.now;
    this.scheduler = deps.scheduler ?? realScheduler;
    this.onChange = deps.onChange ?? (() => {});
  }

  get size(): number {
    return this.rooms.size;
  }

  async createRoom(input: {
    name: unknown;
    setCode: unknown;
    timerSeconds?: unknown;
    practice?: unknown;
    socketId: string;
  }): Promise<SeatResult> {
    const name = sanitizeName(input.name);
    if (!name) throw new RoomError('Enter a name (1–20 characters)');
    if (typeof input.setCode !== 'string' || !input.setCode.trim()) throw new RoomError('Choose a set');
    const setCode = input.setCode.trim().toLowerCase();
    const practice = input.practice === true;
    const timerSeconds = practice ? null : parseTimer(input.timerSeconds);
    if (this.rooms.size >= MAX_ROOMS) throw new RoomError('Server is busy, try again later');

    const set = await this.deps.getSetCards(setCode);
    const setName = (await this.deps.getSetName?.(setCode)) ?? setCode.toUpperCase();
    if (this.rooms.size >= MAX_ROOMS) throw new RoomError('Server is busy, try again later');

    const rng = mulberry32(this.seed());
    const host = this.newPlayer(name, input.socketId);
    const room: Room = {
      id: randomUUID(),
      code: generateCode(rng, (c) => this.findByCode(c) !== undefined),
      setCode,
      setName,
      set,
      timerSeconds,
      practice,
      hostPlayerId: host.playerId,
      phase: 'lobby',
      players: [host],
      seats: [],
      state: null,
      round: 0,
      pickDeadline: null,
      rng,
      decks: new Map(),
      lastActivity: this.now(),
      roundTimer: null,
      graceTimers: new Map(),
    };
    this.rooms.set(room.id, room);
    this.onChange(room); // PRACTICE-START (replaced in Task 3)
    return { room, player: host };
  }

  joinRoom(input: { code: unknown; name: unknown; socketId: string }): SeatResult {
    const code = normalizeCode(input.code);
    const room = code ? this.findByCode(code) : undefined;
    if (!room) throw new RoomError('Room not found');
    if (room.phase !== 'lobby') throw new RoomError('Draft already started');
    if (room.players.length >= MAX_PLAYERS) throw new RoomError('Room is full');
    const name = sanitizeName(input.name);
    if (!name) throw new RoomError('Enter a name (1–20 characters)');
    const player = this.newPlayer(
      uniqueName(name, room.players.map((p) => p.name)),
      input.socketId,
    );
    room.players.push(player);
    this.touch(room);
    this.onChange(room);
    return { room, player };
  }

  resume(input: { code: unknown; token: unknown; socketId: string }): SeatResult & { replacedSocketId: string | null } {
    const code = normalizeCode(input.code);
    const room = code ? this.findByCode(code) : undefined;
    const player =
      room && typeof input.token === 'string' ? room.players.find((p) => p.token === input.token) : undefined;
    if (!room || !player) throw new RoomError('Session not found or expired');
    const replacedSocketId = player.socketId && player.socketId !== input.socketId ? player.socketId : null;
    player.socketId = input.socketId;
    this.cancelGrace(room, player);
    this.touch(room);
    this.onChange(room);
    return { room, player, replacedSocketId };
  }

  leave(roomId: string, playerId: string): void {
    const room = this.get(roomId);
    const player = room.players.find((p) => p.playerId === playerId);
    if (!player) return;
    if (room.phase === 'lobby') {
      room.players = room.players.filter((p) => p !== player);
      if (room.players.length === 0) {
        this.deleteRoom(room);
        return;
      }
      if (room.hostPlayerId === playerId) room.hostPlayerId = room.players[0].playerId;
    } else {
      player.socketId = null;
      this.onSeatDisconnected(room, player);
    }
    this.onChange(room);
  }

  disconnect(socketId: string): void {
    for (const room of this.rooms.values()) {
      for (const player of room.players) {
        if (player.socketId !== socketId) continue;
        player.socketId = null;
        this.touch(room);
        this.onSeatDisconnected(room, player);
        this.onChange(room);
      }
    }
  }

  get(roomId: string): Room {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('Room not found or expired');
    this.touch(room);
    return room;
  }

  findByCode(code: string): Room | undefined {
    for (const room of this.rooms.values()) if (room.code === code) return room;
    return undefined;
  }

  sweep(): number {
    const now = this.now();
    let removed = 0;
    for (const room of [...this.rooms.values()]) {
      const idle = room.lastActivity < now - ROOM_TTL_MS;
      const abandonedLobby =
        room.phase === 'lobby' &&
        room.players.every((p) => p.socketId === null) &&
        room.lastActivity < now - EMPTY_LOBBY_TTL_MS;
      if (idle || abandonedLobby) {
        this.deleteRoom(room);
        removed++;
      }
    }
    return removed;
  }

  // ---- internals ----

  private newPlayer(name: string, socketId: string): HumanSeat {
    return { kind: 'human', playerId: randomUUID(), name, token: newToken(), socketId };
  }

  private touch(room: Room): void {
    room.lastActivity = this.now();
  }

  private deleteRoom(room: Room): void {
    this.clearTimers(room);
    this.rooms.delete(room.id);
  }

  private cancelGrace(room: Room, player: HumanSeat): void {
    const handle = room.graceTimers.get(player.playerId);
    if (handle !== undefined) {
      this.scheduler.clearTimeout(handle);
      room.graceTimers.delete(player.playerId);
    }
  }

  private clearTimers(room: Room): void {
    if (room.roundTimer !== null) {
      this.scheduler.clearTimeout(room.roundTimer);
      room.roundTimer = null;
    }
    for (const handle of room.graceTimers.values()) this.scheduler.clearTimeout(handle);
    room.graceTimers.clear();
  }

  // Auto-pick scheduling for disconnected seats is added in Task 4.
  private onSeatDisconnected(_room: Room, _player: HumanSeat): void {}
}
