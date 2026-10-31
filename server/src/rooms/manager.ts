import { randomUUID } from 'node:crypto';
import { COLORS, TIMER_OPTIONS, type DeckSavePayload, type SetCards } from '@mtg/shared';
import { botPick } from '../bots/botPick';
import { advanceIfReady, applyPick, createDraft, InvalidPickError, ROUNDS, type DraftState } from '../draft/engine';
import { generatePack } from '../packs/generatePack';
import { mulberry32, type Rng } from '../rng';
import { generateCode, newToken, normalizeCode, sanitizeName, uniqueName } from './identity';
import { realScheduler, type Scheduler } from './scheduler';

export const SEATS = 8;
export const MAX_PLAYERS = 8;
export const MAX_ROOMS = 200;
export const ROOM_TTL_MS = 30 * 60 * 1000;
export const EMPTY_LOBBY_TTL_MS = 5 * 60 * 1000;
export const DISCONNECT_GRACE_MS = 5000;
export const DISCONNECT_GRACE_NO_TIMER_MS = 30_000;

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

export function seatIndexOf(room: Room, playerId: string): number {
  return room.seats.findIndex((s) => s.kind === 'human' && s.playerId === playerId);
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
    if (practice) this.begin(room);
    else this.onChange(room);
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

  startRoom(roomId: string, playerId: string): void {
    const room = this.get(roomId);
    if (room.phase !== 'lobby') throw new RoomError('Draft already started');
    if (room.hostPlayerId !== playerId) throw new RoomError('Only the host can start the draft');
    this.begin(room);
  }

  pick(roomId: string, playerId: string, instanceId: string): void {
    const room = this.get(roomId);
    if (room.phase !== 'drafting' || !room.state) throw new InvalidPickError('Draft is not in progress');
    const seat = seatIndexOf(room, playerId);
    if (seat < 0) throw new InvalidPickError('You are not seated in this draft');
    room.state = applyPick(room.state, seat, instanceId); // throws before mutating
    this.advance(room);
  }

  saveDeck(roomId: string, playerId: string, deck: unknown): void {
    const room = this.get(roomId);
    if (!deck || typeof deck !== 'object') throw new RoomError('Invalid deck');
    if (room.phase !== 'complete' || !room.state) throw new RoomError('Draft is not complete');
    const seat = seatIndexOf(room, playerId);
    if (seat < 0) throw new RoomError('You are not seated in this draft');
    const { main, basics } = deck as { main?: unknown; basics?: unknown };
    const pool = new Set(room.state.picks[seat].map((c) => c.instanceId));
    if (
      !Array.isArray(main) ||
      !main.every((id) => typeof id === 'string' && pool.has(id)) ||
      new Set(main).size !== main.length
    ) {
      throw new RoomError('Deck contains cards that are not in your pool');
    }
    const counts = {} as DeckSavePayload['basics'];
    for (const c of COLORS) {
      const n = (basics as Record<string, unknown> | null | undefined)?.[c];
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new RoomError('Invalid basic land counts');
      counts[c] = n;
    }
    room.decks.set(playerId, { main: [...(main as string[])], basics: counts });
  }

  get(roomId: string): Room {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('Room not found or expired');
    this.touch(room);
    return room;
  }

  /** Non-throwing lookup that does not refresh activity (for timers and sweeps). */
  peek(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
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

  private begin(room: Room): void {
    const order = shuffle(
      Array.from({ length: SEATS }, (_, i) => i),
      room.rng,
    );
    const seats: Seat[] = Array.from({ length: SEATS }, () => ({ kind: 'bot' }) as BotSeat);
    room.players.forEach((p, i) => {
      seats[order[i]] = p;
    });
    const packs = Array.from({ length: SEATS }, () =>
      Array.from({ length: ROUNDS }, () => generatePack(room.set, room.rng)),
    );
    room.seats = seats;
    room.state = createDraft(SEATS, packs);
    room.phase = 'drafting';
    room.round = 0;
    this.touch(room);
    this.beginRound(room);
    this.onChange(room);
  }

  private beginRound(room: Room): void {
    room.pickDeadline = null;
    if (room.timerSeconds !== null) {
      const ms = room.timerSeconds * 1000;
      const round = room.round;
      room.pickDeadline = this.now() + ms;
      room.roundTimer = this.scheduler.setTimeout(() => this.safely('round deadline', () => this.onDeadline(room.id, round)), ms);
    }
    for (const p of room.players) if (p.socketId === null) this.scheduleGrace(room, p);
  }

  private onDeadline(roomId: string, round: number): void {
    const room = this.rooms.get(roomId);
    if (!room || room.phase !== 'drafting' || room.round !== round) return;
    room.roundTimer = null;
    for (const p of room.players) {
      const i = seatIndexOf(room, p.playerId);
      if (i >= 0 && !room.state!.pickedThisTurn[i]) this.autoPick(room, i);
    }
    this.advance(room);
  }

  private scheduleGrace(room: Room, player: HumanSeat): void {
    if (room.graceTimers.has(player.playerId)) return;
    if (room.practice) return; // nobody is waiting on a practice draft
    const i = seatIndexOf(room, player.playerId);
    if (i < 0 || room.state!.pickedThisTurn[i]) return;
    const round = room.round;
    const delay = room.timerSeconds !== null ? DISCONNECT_GRACE_MS : DISCONNECT_GRACE_NO_TIMER_MS;
    const handle = this.scheduler.setTimeout(() => {
      room.graceTimers.delete(player.playerId);
      this.safely('disconnect grace', () => {
        const stale =
          this.rooms.get(room.id) !== room || room.phase !== 'drafting' || room.round !== round || player.socketId !== null;
        if (stale || room.state!.pickedThisTurn[i]) return;
        this.autoPick(room, i);
        this.advance(room);
      });
    }, delay);
    room.graceTimers.set(player.playerId, handle);
  }

  private safely(label: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error(`[rooms] ${label} failed`, err);
    }
  }

  private autoPick(room: Room, seat: number): void {
    const st = room.state!;
    room.state = applyPick(st, seat, botPick(st.current[seat], st.picks[seat], room.rng));
  }

  /** After any pick: once every human has picked, bots pick and packs pass. */
  private advance(room: Room): void {
    const current = room.state!;
    const humansDone = room.seats.every((s, i) => s.kind === 'bot' || current.pickedThisTurn[i]);
    if (!humansDone) {
      this.onChange(room);
      return;
    }
    let st = current;
    room.seats.forEach((s, i) => {
      if (s.kind === 'bot') st = applyPick(st, i, botPick(st.current[i], st.picks[i], room.rng));
    });
    room.state = advanceIfReady(st);
    room.round++;
    this.clearTimers(room);
    if (room.state.complete) {
      room.phase = 'complete';
      room.pickDeadline = null;
    } else {
      this.beginRound(room);
    }
    this.onChange(room);
  }

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

  private onSeatDisconnected(room: Room, player: HumanSeat): void {
    if (room.phase === 'drafting') this.scheduleGrace(room, player);
  }
}
