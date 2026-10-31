# Multiplayer Draft Rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Friends create or join a draft room by 4-letter code, draft together with bots filling empty seats (synchronized picks, optional timer), build their own decks, and do this on a Render-hosted URL; practice mode becomes a one-human room.

**Architecture:** A new socket-free `RoomManager` (`server/src/rooms/manager.ts`) owns rooms with lobby → drafting → complete phases, human/bot seats, per-round timers via an injected `Scheduler`, and an `onChange(room)` callback. `server.ts` maps sockets to `(roomId, playerId)` and, on every change, sends each connected human only their own view built by `views.ts`. The draft engine, bots, packs and card modules are unchanged. In production the same Node process serves `client/dist`.

**Tech Stack:** TypeScript 5 strict ESM, Node 22, Socket.IO 4.8, React 18 + Vite 5, Vitest 2, tsx, Render Blueprint.

**Spec:** `docs/superpowers/specs/2026-10-31-multiplayer-draft-design.md`

## Global Constraints

- Room code alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, length 4, case-insensitive input, unique among live rooms.
- Names: control characters stripped, trimmed, 1–20 chars; duplicates (case-insensitive) become `Name (2)`, `Name (3)`…
- Max 8 humans per room; 8 seats total; empty seats are bots named `Bot 1`…`Bot 7` in seat order.
- Timer values: 30, 45, 60, 90 seconds or `null` (off). Default in the UI: 60. Practice rooms: always `null`.
- Disconnected human auto-pick grace: 5000 ms when the room has a timer, 0 ms when it does not.
- Room TTL 30 minutes since last activity; lobby with zero connected humans deleted after 5 minutes; max 200 live rooms; max 2 `room:create` per socket per rolling 60 s.
- Seat tokens: 128-bit random hex, never sent to other players.
- Acks are `{ ok: true, ... } | { ok: false, message }`. Malformed payloads never crash the server.
- Each human only ever receives their own pack/pool.
- Client session in localStorage key `mtg.session` (`{ code, playerId, token }`), name in `mtg.name`; every storage access wrapped in try/catch.
- Clarification of the spec: room broadcasts are sent per socket (each human's own view); Socket.IO rooms are not used.
- Tests never hit the network. Write files without a UTF-8 BOM. Stage files by path; never commit `.superpowers/`, `server/.cache/`, `client/dist/`.
- Between Task 6 and Task 7 the client does not typecheck (events change in Task 6). In Task 6 run `npm run typecheck -w @mtg/shared -w @mtg/server` only.

## File Structure

```
shared/src/types.ts               + LobbyPlayer, LobbyView, TableSeat, DraftStatePayload, SessionInfo, TIMER_OPTIONS
shared/src/events.ts              rewritten for room events (Task 6)
server/src/rooms/identity.ts      generateCode, normalizeCode, sanitizeName, uniqueName, newToken
server/src/rooms/scheduler.ts     Scheduler interface + realScheduler
server/src/rooms/manager.ts       new RoomManager (Tasks 2–4)
server/src/rooms/views.ts         lobbyView, tableView, draftStateFor, completeFor (Task 5)
server/src/rooms/RoomManager.ts   deleted in Task 6 (old practice manager)
server/src/http.ts                health + static file handler (Task 10)
server/src/server.ts              socket wiring rewritten (Task 6)
server/src/index.ts               wiring (Tasks 6, 10)
server/test/helpers.ts            + FakeClock
server/test/identity.test.ts, manager.test.ts, timers.test.ts, views.test.ts, server.test.ts (rewritten), http.test.ts
client/src/lib/session.ts         parseSession, roomCodeFromUrl, secondsLeft, storage wrappers
client/src/App.tsx                rewritten screen state machine (Task 7)
client/src/screens/Home.tsx       name + practice / create / join (Task 7)
client/src/screens/Lobby.tsx      (Task 8)
client/src/screens/Draft.tsx      + countdown + table strip (Task 9)
client/src/components/TableStrip.tsx (Task 9)
client/test/session.test.ts
render.yaml, README.md            (Task 10)
```

---

### Task 1: Shared room types, identity helpers, scheduler, fake clock

**Files:**
- Modify: `shared/src/types.ts` (append)
- Create: `server/src/rooms/identity.ts`, `server/src/rooms/scheduler.ts`
- Modify: `server/test/helpers.ts` (append `FakeClock`)
- Test: `server/test/identity.test.ts`

**Interfaces:**
- Produces (shared): `LobbyPlayer`, `LobbyView`, `TableSeat`, `DraftStatePayload`, `SessionInfo`, `TIMER_OPTIONS` (exact shapes below).
- Produces (server): `CODE_ALPHABET`, `generateCode(rng: Rng, isTaken: (code: string) => boolean): string`, `normalizeCode(raw: unknown): string | null`, `sanitizeName(raw: unknown): string | null`, `uniqueName(name: string, taken: string[]): string`, `newToken(): string`; `interface Scheduler { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void }`, `realScheduler: Scheduler`.
- Produces (tests): `class FakeClock implements Scheduler` with `now: number` (starts 1000), `advance(ms: number): void` (runs due callbacks in time order, setting `now` to each callback's time), `pending: number`.

- [ ] **Step 1: Append shared types**

Append to `shared/src/types.ts`:
```ts
export const TIMER_OPTIONS = [30, 45, 60, 90] as const;

export interface SessionInfo {
  code: string;
  playerId: string;
  token: string;
}

export interface LobbyPlayer {
  playerId: string;
  name: string;
  connected: boolean;
}

export interface LobbyView {
  code: string;
  setCode: string;
  setName: string;
  timerSeconds: number | null;
  hostPlayerId: string;
  players: LobbyPlayer[];
}

export interface TableSeat {
  name: string;
  isBot: boolean;
  picked: boolean; // picked this round
  connected: boolean; // bots are always connected
  isYou: boolean;
}

export interface DraftStatePayload {
  code: string;
  view: SeatView;
  pickDeadline: number | null; // epoch ms
  table: TableSeat[]; // 8 seats in passing order
}
```

- [ ] **Step 2: Write the failing tests**

`server/test/identity.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, generateCode, newToken, normalizeCode, sanitizeName, uniqueName } from '../src/rooms/identity';
import { mulberry32 } from '../src/rng';
import { FakeClock } from './helpers';

describe('room codes', () => {
  it('generates 4 characters from the alphabet', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 200; i++) {
      const code = generateCode(rng, () => false);
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    }
  });

  it('skips codes that are taken', () => {
    const rng = mulberry32(2);
    const first = generateCode(mulberry32(2), () => false);
    const code = generateCode(rng, (c) => c === first);
    expect(code).not.toBe(first);
  });

  it('throws when it cannot find a free code', () => {
    expect(() => generateCode(mulberry32(3), () => true)).toThrow('Could not allocate a room code');
  });

  it('normalizes user input', () => {
    expect(normalizeCode(' kx7q ')).toBe('KX7Q');
    expect(normalizeCode('KXOQ')).toBeNull(); // O not in alphabet
    expect(normalizeCode('KX7')).toBeNull();
    expect(normalizeCode(42)).toBeNull();
  });
});

describe('names', () => {
  it('strips control characters, trims and caps at 20', () => {
    expect(sanitizeName('  Sam\u0007  ')).toBe('Sam');
    expect(sanitizeName('x'.repeat(30))).toBe('x'.repeat(20));
    expect(sanitizeName('   ')).toBeNull();
    expect(sanitizeName(null)).toBeNull();
  });

  it('numbers duplicate names case-insensitively', () => {
    expect(uniqueName('Sam', [])).toBe('Sam');
    expect(uniqueName('sam', ['Sam'])).toBe('sam (2)');
    expect(uniqueName('Sam', ['Sam', 'Sam (2)'])).toBe('Sam (3)');
  });
});

describe('tokens', () => {
  it('are 32 hex chars and unique', () => {
    const a = newToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(newToken()).not.toBe(a);
  });
});

describe('FakeClock', () => {
  it('runs due callbacks in order and supports clearing', () => {
    const clock = new FakeClock();
    const log: string[] = [];
    clock.setTimeout(() => log.push('b'), 200);
    const h = clock.setTimeout(() => log.push('x'), 100);
    clock.setTimeout(() => {
      log.push('a');
      clock.setTimeout(() => log.push('a2'), 50);
    }, 100);
    clock.clearTimeout(h);
    clock.advance(160);
    expect(log).toEqual(['a', 'a2']);
    expect(clock.now).toBe(1160);
    clock.advance(100);
    expect(log).toEqual(['a', 'a2', 'b']);
    expect(clock.pending).toBe(0);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w @mtg/server -- identity`
Expected: FAIL (cannot resolve `../src/rooms/identity`).

- [ ] **Step 4: Implement**

`server/src/rooms/identity.ts`:
```ts
import { randomBytes } from 'node:crypto';
import type { Rng } from '../rng';

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}$/;
const MAX_NAME = 20;

export function generateCode(rng: Rng, isTaken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
    if (!isTaken(code)) return code;
  }
  throw new Error('Could not allocate a room code');
}

export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME).trim();
  return name.length > 0 ? name : null;
}

export function uniqueName(name: string, taken: string[]): string {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

export function newToken(): string {
  return randomBytes(16).toString('hex');
}
```

`server/src/rooms/scheduler.ts`:
```ts
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realScheduler: Scheduler = {
  setTimeout(fn, ms) {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};
```

Append to `server/test/helpers.ts`:
```ts
import type { Scheduler } from '../src/rooms/scheduler';

export class FakeClock implements Scheduler {
  now = 1_000;
  private tasks: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;

  setTimeout(fn: () => void, ms: number): number {
    const id = this.nextId++;
    this.tasks.push({ at: this.now + ms, fn, id });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.tasks = this.tasks.filter((t) => t.id !== handle);
  }

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = this.tasks.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.tasks = this.tasks.filter((t) => t !== due);
      this.now = due.at;
      due.fn();
    }
    this.now = target;
  }

  get pending(): number {
    return this.tasks.length;
  }
}
```
(Move the new `import type` line to the top of `helpers.ts` with the other imports.)

- [ ] **Step 5: Verify**

Run: `npm test -w @mtg/server -- identity` → PASS (8 tests). Run `npm test` and `npm run typecheck` → all pass.

- [ ] **Step 6: Commit**

```bash
git add shared/src/types.ts server/src/rooms/identity.ts server/src/rooms/scheduler.ts server/test/helpers.ts server/test/identity.test.ts
git commit -m "feat: room identity helpers, scheduler, shared room types"
```

### Task 2: RoomManager — lobby lifecycle

**Files:**
- Create: `server/src/rooms/manager.ts`
- Test: `server/test/manager.test.ts`

**Interfaces:**
- Consumes: Task 1 (`identity.ts`, `Scheduler`, `realScheduler`, `FakeClock`, `TIMER_OPTIONS`); `makeSet` helper; `mulberry32`; `SetCards`, `DeckSavePayload` from `@mtg/shared`.
- Produces (used by Tasks 3–6): constants `SEATS = 8`, `MAX_PLAYERS = 8`, `MAX_ROOMS = 200`, `ROOM_TTL_MS`, `EMPTY_LOBBY_TTL_MS`, `DISCONNECT_GRACE_MS = 5000`; types `HumanSeat`, `BotSeat`, `Seat`, `Room` (fields below), `SeatResult = { room: Room; player: HumanSeat }`; `class RoomError extends Error`; `class RoomManager` with public `onChange: (room: Room) => void`, `size`, `createRoom(input): Promise<SeatResult>`, `joinRoom(input): SeatResult`, `resume(input): SeatResult & { replacedSocketId: string | null }`, `leave(roomId, playerId): void`, `disconnect(socketId): void`, `get(roomId): Room` (refreshes activity; throws `RoomError('Room not found or expired')`), `findByCode(code): Room | undefined`, `sweep(): number`. Private helpers used by later tasks: `touch`, `cancelGrace`, `clearTimers`, `deleteRoom`, `onSeatDisconnected` (no-op until Task 4).

- [ ] **Step 1: Write the failing tests**

`server/test/manager.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { SetCards } from '@mtg/shared';
import { EMPTY_LOBBY_TTL_MS, MAX_ROOMS, RoomError, RoomManager, ROOM_TTL_MS, type Room } from '../src/rooms/manager';
import { FakeClock, makeSet } from './helpers';

const SET = makeSet();

function setup(getSetCards: (code: string) => Promise<SetCards> = async () => SET) {
  const clock = new FakeClock();
  const changes: Room[] = [];
  const manager = new RoomManager({
    getSetCards,
    getSetName: async () => 'Test Set',
    seed: () => 7,
    now: () => clock.now,
    scheduler: clock,
    onChange: (r) => changes.push(r),
  });
  return { manager, clock, changes };
}

const createAnn = (m: RoomManager, timerSeconds: number | null = 60) =>
  m.createRoom({ name: 'Ann', setCode: 'TST', timerSeconds, socketId: 's-ann' });

describe('RoomManager lobby', () => {
  it('creates a lobby with the creator as host', async () => {
    const { manager, changes } = setup();
    const { room, player } = await createAnn(manager);
    expect(room.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    expect(room).toMatchObject({ phase: 'lobby', setCode: 'tst', setName: 'Test Set', timerSeconds: 60, practice: false });
    expect(room.hostPlayerId).toBe(player.playerId);
    expect(player).toMatchObject({ kind: 'human', name: 'Ann', socketId: 's-ann' });
    expect(player.token).toMatch(/^[0-9a-f]{32}$/);
    expect(changes).toContain(room);
    expect(manager.findByCode(room.code)).toBe(room);
  });

  it('validates name and timer', async () => {
    const { manager } = setup();
    await expect(manager.createRoom({ name: '  ', setCode: 'tst', socketId: 's' })).rejects.toThrow(RoomError);
    await expect(manager.createRoom({ name: 'A', setCode: 'tst', timerSeconds: 50, socketId: 's' })).rejects.toThrow('Invalid pick timer');
    await expect(manager.createRoom({ name: 'A', setCode: '', socketId: 's' })).rejects.toThrow('Choose a set');
    const { room } = await manager.createRoom({ name: 'A', setCode: 'tst', timerSeconds: null, socketId: 's' });
    expect(room.timerSeconds).toBeNull();
  });

  it('propagates set loading errors without creating a room', async () => {
    const { manager } = setup(async () => {
      throw new Error('No booster cards found for set "zzz"');
    });
    await expect(manager.createRoom({ name: 'A', setCode: 'zzz', socketId: 's' })).rejects.toThrow('No booster cards found');
    expect(manager.size).toBe(0);
  });

  it('caps the number of live rooms', async () => {
    const { manager } = setup();
    for (let i = 0; i < MAX_ROOMS; i++) await manager.createRoom({ name: 'A', setCode: 'tst', socketId: `s${i}` });
    await expect(manager.createRoom({ name: 'A', setCode: 'tst', socketId: 'x' })).rejects.toThrow('Server is busy, try again later');
  });

  it('joins by code (case-insensitive) with unique names', async () => {
    const { manager } = setup();
    const { room } = await createAnn(manager);
    const bob = manager.joinRoom({ code: room.code.toLowerCase(), name: 'ann', socketId: 's-bob' });
    expect(bob.room).toBe(room);
    expect(bob.player.name).toBe('ann (2)');
    expect(room.players).toHaveLength(2);
  });

  it('rejects unknown codes and full rooms', async () => {
    const { manager } = setup();
    expect(() => manager.joinRoom({ code: 'ZZZZ', name: 'B', socketId: 's' })).toThrow('Room not found');
    const { room } = await createAnn(manager);
    for (let i = 0; i < 7; i++) manager.joinRoom({ code: room.code, name: `P${i}`, socketId: `s${i}` });
    expect(() => manager.joinRoom({ code: room.code, name: 'Late', socketId: 'late' })).toThrow('Room is full');
  });

  it('resumes a seat by token and reports the replaced socket', async () => {
    const { manager } = setup();
    const { room, player } = await createAnn(manager);
    const res = manager.resume({ code: room.code, token: player.token, socketId: 's-ann-2' });
    expect(res.player).toBe(player);
    expect(res.replacedSocketId).toBe('s-ann');
    expect(player.socketId).toBe('s-ann-2');
    expect(() => manager.resume({ code: room.code, token: 'nope', socketId: 'x' })).toThrow('Session not found or expired');
  });

  it('passes host on leave and deletes an empty lobby', async () => {
    const { manager } = setup();
    const { room, player: ann } = await createAnn(manager);
    const { player: bob } = manager.joinRoom({ code: room.code, name: 'Bob', socketId: 's-bob' });
    manager.leave(room.id, ann.playerId);
    expect(room.players).toEqual([bob]);
    expect(room.hostPlayerId).toBe(bob.playerId);
    manager.leave(room.id, bob.playerId);
    expect(manager.size).toBe(0);
  });

  it('marks a disconnected socket and notifies', async () => {
    const { manager, changes } = setup();
    const { room, player } = await createAnn(manager);
    changes.length = 0;
    manager.disconnect('s-ann');
    expect(player.socketId).toBeNull();
    expect(changes).toEqual([room]);
  });

  it('sweeps idle rooms and abandoned lobbies', async () => {
    const { manager, clock } = setup();
    const { room: abandoned } = await createAnn(manager);
    manager.disconnect('s-ann');
    const { room: active } = await manager.createRoom({ name: 'C', setCode: 'tst', socketId: 's-c' });
    clock.advance(EMPTY_LOBBY_TTL_MS + 1);
    expect(manager.sweep()).toBe(1);
    expect(manager.findByCode(abandoned.code)).toBeUndefined();
    expect(manager.findByCode(active.code)).toBe(active);
    clock.advance(ROOM_TTL_MS);
    expect(manager.sweep()).toBe(1);
    expect(manager.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @mtg/server -- manager`
Expected: FAIL (cannot resolve `../src/rooms/manager`).

- [ ] **Step 3: Implement**

`server/src/rooms/manager.ts`:
```ts
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
```

- [ ] **Step 4: Verify**

Run: `npm test -w @mtg/server -- manager` → PASS (10 tests). Run `npm test` and `npm run typecheck` → all pass (old `RoomManager.ts` and its tests are untouched).

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/manager.ts server/test/manager.test.ts
git commit -m "feat(server): room manager lobby lifecycle"
```

### Task 3: RoomManager — start, synchronized picks, practice rooms, deck save

**Files:**
- Modify: `server/src/rooms/manager.ts`
- Test: `server/test/manager.test.ts` (append)

**Interfaces:**
- Consumes: Task 2 manager; `createDraft`, `applyPick`, `advanceIfReady`, `InvalidPickError`, `ROUNDS` from `../draft/engine`; `botPick`; `generatePack`; `COLORS`.
- Produces: `export function seatIndexOf(room: Room, playerId: string): number` (−1 if not seated); `RoomManager.startRoom(roomId, playerId): void`; `RoomManager.pick(roomId, playerId, instanceId): void` (throws `InvalidPickError` on a bad pick, leaving state unchanged); `RoomManager.saveDeck(roomId, playerId, deck: unknown): void` (throws `RoomError`); practice rooms (`practice: true`) start immediately with timer `null`. Private hooks used by Task 4: `beginRound(room)`, `advance(room)`.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/manager.test.ts` (add `InvalidPickError` import from `../src/draft/engine`, and `seatIndexOf`, `type HumanSeat` to the manager import):
```ts
function pickFirst(m: RoomManager, room: Room, player: HumanSeat) {
  const i = seatIndexOf(room, player.playerId);
  m.pick(room.id, player.playerId, room.state!.current[i][0].instanceId);
}

async function twoPlayerRoom(timerSeconds: number | null = null) {
  const ctx = setup();
  const { room, player: ann } = await createAnn(ctx.manager, timerSeconds);
  const { player: bob } = ctx.manager.joinRoom({ code: room.code, name: 'Bob', socketId: 's-bob' });
  return { ...ctx, room, ann, bob };
}

const noBasics = { W: 0, U: 0, B: 0, R: 0, G: 0 };

describe('RoomManager drafting', () => {
  it('only the host can start, and only once', async () => {
    const { manager, room, ann, bob } = await twoPlayerRoom();
    expect(() => manager.startRoom(room.id, bob.playerId)).toThrow('Only the host can start the draft');
    manager.startRoom(room.id, ann.playerId);
    expect(room.phase).toBe('drafting');
    expect(() => manager.startRoom(room.id, ann.playerId)).toThrow('Draft already started');
    expect(() => manager.joinRoom({ code: room.code, name: 'Late', socketId: 'x' })).toThrow('Draft already started');
  });

  it('seats every human once and fills the rest with bots', async () => {
    const { manager, room, ann, bob } = await twoPlayerRoom();
    manager.startRoom(room.id, ann.playerId);
    expect(room.seats).toHaveLength(8);
    expect(room.seats.filter((s) => s.kind === 'bot')).toHaveLength(6);
    expect(seatIndexOf(room, ann.playerId)).toBeGreaterThanOrEqual(0);
    expect(seatIndexOf(room, bob.playerId)).toBeGreaterThanOrEqual(0);
    expect(room.state!.current.every((p) => p.length === 15)).toBe(true);
  });

  it('waits for every human before bots pick and packs pass', async () => {
    const { manager, room, ann, bob, changes } = await twoPlayerRoom();
    manager.startRoom(room.id, ann.playerId);
    changes.length = 0;
    pickFirst(manager, room, ann);
    expect(room.round).toBe(0);
    expect(room.state!.picks.filter((p) => p.length === 1)).toHaveLength(1);
    expect(changes).toEqual([room]);
    pickFirst(manager, room, bob);
    expect(room.round).toBe(1);
    expect(room.state!.picks.every((p) => p.length === 1)).toBe(true);
    expect(room.state!.current.every((p) => p.length === 14)).toBe(true);
  });

  it('rejects invalid picks without changing state', async () => {
    const { manager, room, ann } = await twoPlayerRoom();
    manager.startRoom(room.id, ann.playerId);
    const before = room.state;
    expect(() => manager.pick(room.id, ann.playerId, 'nope')).toThrow(InvalidPickError);
    expect(room.state).toBe(before);
  });

  it('completes after 45 rounds', async () => {
    const { manager, room, ann, bob } = await twoPlayerRoom();
    manager.startRoom(room.id, ann.playerId);
    for (let i = 0; i < 45; i++) {
      pickFirst(manager, room, ann);
      pickFirst(manager, room, bob);
    }
    expect(room.phase).toBe('complete');
    expect(room.state!.picks.every((p) => p.length === 45)).toBe(true);
    expect(() => manager.pick(room.id, ann.playerId, 'x')).toThrow(InvalidPickError);
  });

  it('starts practice rooms immediately with no timer', async () => {
    const { manager } = setup();
    const { room, player } = await manager.createRoom({ name: 'Ann', setCode: 'tst', timerSeconds: 60, practice: true, socketId: 's' });
    expect(room).toMatchObject({ practice: true, timerSeconds: null, phase: 'drafting' });
    expect(room.seats.filter((s) => s.kind === 'human')).toEqual([player]);
    for (let i = 0; i < 45; i++) pickFirst(manager, room, player);
    expect(room.phase).toBe('complete');
  });

  it('saves decks per player against their own pool', async () => {
    const { manager, room, ann, bob } = await twoPlayerRoom();
    manager.startRoom(room.id, ann.playerId);
    expect(() => manager.saveDeck(room.id, ann.playerId, { main: [], basics: noBasics })).toThrow('Draft is not complete');
    for (let i = 0; i < 45; i++) {
      pickFirst(manager, room, ann);
      pickFirst(manager, room, bob);
    }
    const annPool = room.state!.picks[seatIndexOf(room, ann.playerId)].map((c) => c.instanceId);
    const bobPool = room.state!.picks[seatIndexOf(room, bob.playerId)].map((c) => c.instanceId);
    manager.saveDeck(room.id, ann.playerId, { main: annPool.slice(0, 23), basics: { ...noBasics, G: 17 } });
    expect(room.decks.get(ann.playerId)?.main).toHaveLength(23);
    expect(() => manager.saveDeck(room.id, ann.playerId, { main: [bobPool[0]], basics: noBasics })).toThrow(
      'Deck contains cards that are not in your pool',
    );
    expect(() => manager.saveDeck(room.id, bob.playerId, { main: [], basics: { ...noBasics, R: -1 } })).toThrow('Invalid basic land counts');
    expect(() => manager.saveDeck(room.id, bob.playerId, null)).toThrow('Invalid deck');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @mtg/server -- manager`
Expected: FAIL (`seatIndexOf` / `startRoom` do not exist).

- [ ] **Step 3: Implement**

In `server/src/rooms/manager.ts`:

1. Replace the imports at the top with:
```ts
import { randomUUID } from 'node:crypto';
import { COLORS, TIMER_OPTIONS, type DeckSavePayload, type SetCards } from '@mtg/shared';
import { botPick } from '../bots/botPick';
import { advanceIfReady, applyPick, createDraft, InvalidPickError, ROUNDS, type DraftState } from '../draft/engine';
import { generatePack } from '../packs/generatePack';
import { mulberry32, type Rng } from '../rng';
import { generateCode, newToken, normalizeCode, sanitizeName, uniqueName } from './identity';
import { realScheduler, type Scheduler } from './scheduler';
```

2. Add after the `parseTimer` function:
```ts
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
```

3. In `createRoom`, replace the line
```ts
    this.onChange(room); // PRACTICE-START (replaced in Task 3)
```
with
```ts
    if (practice) this.begin(room);
    else this.onChange(room);
```

4. Add these public methods after `disconnect`:
```ts
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
```

5. Add these private methods in the internals section:
```ts
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

  // Timers are added in Task 4.
  private beginRound(room: Room): void {
    room.pickDeadline = null;
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
```

- [ ] **Step 4: Verify**

Run: `npm test -w @mtg/server -- manager` → PASS (17 tests). Run `npm test` and `npm run typecheck` → all pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/manager.ts server/test/manager.test.ts
git commit -m "feat(server): synchronized multiplayer picks and practice rooms"
```

### Task 4: RoomManager — pick timer and disconnect auto-picks

**Files:**
- Modify: `server/src/rooms/manager.ts`
- Test: `server/test/manager.test.ts` (append)

**Interfaces:**
- Consumes: Task 3 (`beginRound`, `advance`, `seatIndexOf`, `clearTimers`, `cancelGrace`), `Scheduler`, `FakeClock`, `DISCONNECT_GRACE_MS`.
- Produces: rooms with a timer set `room.pickDeadline = now + timerSeconds * 1000` at the start of every round and auto-pick un-picked humans when it passes (stale timers from earlier rounds do nothing); disconnected humans who haven't picked are auto-picked after 5000 ms (timer room) or 0 ms (no timer); reconnecting within the grace cancels it. Auto-picks use `botPick` with that player's own picks.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/manager.test.ts`:
```ts
describe('RoomManager timers', () => {
  it('sets a deadline and auto-picks idle humans when it passes', async () => {
    const { manager, room, ann, bob, clock } = await twoPlayerRoom(60);
    manager.startRoom(room.id, ann.playerId);
    expect(room.pickDeadline).toBe(clock.now + 60_000);
    const annIdx = seatIndexOf(room, ann.playerId);
    const chosen = room.state!.current[annIdx][3].instanceId;
    manager.pick(room.id, ann.playerId, chosen);
    clock.advance(59_999);
    expect(room.round).toBe(0);
    clock.advance(1);
    expect(room.round).toBe(1);
    expect(room.state!.picks[annIdx][0].instanceId).toBe(chosen);
    expect(room.state!.picks[seatIndexOf(room, bob.playerId)]).toHaveLength(1);
    expect(room.pickDeadline).toBe(clock.now + 60_000);
  });

  it('cancels the old round timer when everyone picks early', async () => {
    const { manager, room, ann, bob, clock } = await twoPlayerRoom(30);
    manager.startRoom(room.id, ann.playerId);
    pickFirst(manager, room, ann);
    pickFirst(manager, room, bob);
    expect(room.round).toBe(1);
    expect(clock.pending).toBe(1); // only the new round's timer
    clock.advance(29_999);
    expect(room.round).toBe(1);
  });

  it('has no deadline and no timers without a timer', async () => {
    const { manager, room, ann, clock } = await twoPlayerRoom(null);
    manager.startRoom(room.id, ann.playerId);
    expect(room.pickDeadline).toBeNull();
    expect(clock.pending).toBe(0);
  });

  it('auto-picks a disconnected player immediately in a no-timer room', async () => {
    const { manager, room, ann, bob, clock } = await twoPlayerRoom(null);
    manager.startRoom(room.id, ann.playerId);
    pickFirst(manager, room, ann);
    manager.disconnect('s-bob');
    expect(room.round).toBe(0);
    clock.advance(0);
    expect(room.round).toBe(1);
    // Bob is still away, so his next pick is made right away too and Ann alone drives the draft.
    expect(room.state!.pickedThisTurn[seatIndexOf(room, bob.playerId)]).toBe(true);
    pickFirst(manager, room, ann);
    expect(room.round).toBe(2);
  });

  it('gives disconnected players a 5 s grace in timer rooms, cancelled by reconnecting', async () => {
    const { manager, room, ann, bob, clock } = await twoPlayerRoom(60);
    manager.startRoom(room.id, ann.playerId);
    pickFirst(manager, room, ann);
    manager.disconnect('s-bob');
    clock.advance(4_000);
    manager.resume({ code: room.code, token: bob.token, socketId: 's-bob-2' });
    clock.advance(2_000);
    expect(room.round).toBe(0);
    manager.disconnect('s-bob-2');
    clock.advance(5_000);
    expect(room.round).toBe(1);
  });

  it('lets one remaining human finish a draft while the other is gone', async () => {
    const { manager, room, ann, bob, clock } = await twoPlayerRoom(null);
    manager.startRoom(room.id, ann.playerId);
    manager.leave(room.id, bob.playerId);
    for (let i = 0; i < 45; i++) {
      pickFirst(manager, room, ann);
      clock.advance(0);
    }
    expect(room.phase).toBe('complete');
    expect(clock.pending).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @mtg/server -- manager`
Expected: FAIL (no deadline is set; disconnected players are never auto-picked).

- [ ] **Step 3: Implement**

In `server/src/rooms/manager.ts` replace the Task 3 `beginRound` and the Task 2 `onSeatDisconnected` with the following, and add `onDeadline`, `scheduleGrace`, `autoPick`:
```ts
  private beginRound(room: Room): void {
    room.pickDeadline = null;
    if (room.timerSeconds !== null) {
      const ms = room.timerSeconds * 1000;
      const round = room.round;
      room.pickDeadline = this.now() + ms;
      room.roundTimer = this.scheduler.setTimeout(() => this.onDeadline(room.id, round), ms);
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

  private onSeatDisconnected(room: Room, player: HumanSeat): void {
    if (room.phase === 'drafting') this.scheduleGrace(room, player);
  }

  private scheduleGrace(room: Room, player: HumanSeat): void {
    if (room.graceTimers.has(player.playerId)) return;
    const i = seatIndexOf(room, player.playerId);
    if (i < 0 || room.state!.pickedThisTurn[i]) return;
    const round = room.round;
    const delay = room.timerSeconds !== null ? DISCONNECT_GRACE_MS : 0;
    const handle = this.scheduler.setTimeout(() => {
      room.graceTimers.delete(player.playerId);
      const stale =
        this.rooms.get(room.id) !== room || room.phase !== 'drafting' || room.round !== round || player.socketId !== null;
      if (stale || room.state!.pickedThisTurn[i]) return;
      this.autoPick(room, i);
      this.advance(room);
    }, delay);
    room.graceTimers.set(player.playerId, handle);
  }

  private autoPick(room: Room, seat: number): void {
    const st = room.state!;
    room.state = applyPick(st, seat, botPick(st.current[seat], st.picks[seat], room.rng));
  }
```
Also: in `pick`, a player who picks while a grace timer is pending needs nothing extra (the callback sees `pickedThisTurn` and returns).

- [ ] **Step 4: Verify**

Run: `npm test -w @mtg/server -- manager` → PASS (23 tests), run twice to confirm determinism. Run `npm test` and `npm run typecheck` → all pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/manager.ts server/test/manager.test.ts
git commit -m "feat(server): pick timer and auto-picks for disconnected players"
```

### Task 5: Per-player views

**Files:**
- Create: `server/src/rooms/views.ts`
- Test: `server/test/views.test.ts`

**Interfaces:**
- Consumes: `Room`, `seatIndexOf`, `RoomManager` (Tasks 2–4); `seatView` from `../draft/engine`; `LobbyView`, `TableSeat`, `DraftStatePayload`, `Card` from `@mtg/shared`.
- Produces (used by Task 6): `lobbyView(room): LobbyView`; `tableView(room, playerId): TableSeat[]`; `draftStateFor(room, playerId): DraftStatePayload`; `completeFor(room, playerId): { code: string; pool: Card[] }`. Never include another seat's pack or pool, or any token.

- [ ] **Step 1: Write the failing tests**

`server/test/views.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @mtg/server -- views` → FAIL (cannot resolve `../src/rooms/views`).

- [ ] **Step 3: Implement**

`server/src/rooms/views.ts`:
```ts
import type { Card, DraftStatePayload, LobbyView, TableSeat } from '@mtg/shared';
import { seatView } from '../draft/engine';
import { seatIndexOf, type Room } from './manager';

export function lobbyView(room: Room): LobbyView {
  return {
    code: room.code,
    setCode: room.setCode,
    setName: room.setName,
    timerSeconds: room.timerSeconds,
    hostPlayerId: room.hostPlayerId,
    players: room.players.map((p) => ({ playerId: p.playerId, name: p.name, connected: p.socketId !== null })),
  };
}

export function tableView(room: Room, playerId: string): TableSeat[] {
  let bots = 0;
  return room.seats.map((seat, i) => {
    const picked = room.state?.pickedThisTurn[i] ?? false;
    if (seat.kind === 'bot') {
      bots++;
      return { name: `Bot ${bots}`, isBot: true, picked, connected: true, isYou: false };
    }
    return { name: seat.name, isBot: false, picked, connected: seat.socketId !== null, isYou: seat.playerId === playerId };
  });
}

export function draftStateFor(room: Room, playerId: string): DraftStatePayload {
  const seat = seatIndexOf(room, playerId);
  return {
    code: room.code,
    view: seatView(room.state!, seat),
    pickDeadline: room.pickDeadline,
    table: tableView(room, playerId),
  };
}

export function completeFor(room: Room, playerId: string): { code: string; pool: Card[] } {
  const seat = seatIndexOf(room, playerId);
  return { code: room.code, pool: room.state!.picks[seat] };
}
```

- [ ] **Step 4: Verify**

Run: `npm test -w @mtg/server -- views` → PASS (4 tests). Run `npm test` and `npm run typecheck` → all pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/views.ts server/test/views.test.ts
git commit -m "feat(server): per-player lobby, table and draft views"
```

### Task 6: Room events and socket wiring

**Files:**
- Modify: `shared/src/events.ts` (rewrite)
- Modify: `server/src/server.ts` (rewrite), `server/src/index.ts`
- Delete: `server/src/rooms/RoomManager.ts`, `server/test/rooms.test.ts`
- Test: `server/test/server.test.ts` (rewrite)

**Interfaces:**
- Consumes: `RoomManager`, `Room`, `HumanSeat`, `RoomError` (Tasks 2–4); `lobbyView`, `draftStateFor`, `completeFor` (Task 5); `InvalidPickError`; shared room types (Task 1).
- Produces: the event contract below (used by Tasks 7–9); `createDraftServer(deps: { manager: RoomManager; listSets: () => Promise<SetInfo[]>; requestListener?: http.RequestListener; now?: () => number }): { httpServer, io }` (Task 10 passes `requestListener`).
- Note: after this task the client no longer typechecks until Task 7. Typecheck with `npm run typecheck -w @mtg/shared -w @mtg/server`.

- [ ] **Step 1: Rewrite the shared events**

`shared/src/events.ts`:
```ts
import type { Card, DeckSavePayload, DraftStatePayload, LobbyView, SessionInfo, SetInfo } from './types';

export type Ack<T extends object = Record<never, never>> = ({ ok: true } & T) | { ok: false; message: string };
export type SetsListResult = Ack<{ sets: SetInfo[] }>;

export interface CreateRoomPayload {
  name: string;
  setCode: string;
  timerSeconds: number | null;
  practice?: boolean;
}

export interface ClientToServerEvents {
  'sets:list': (ack: (res: SetsListResult) => void) => void;
  'room:create': (p: CreateRoomPayload, ack: (res: Ack<SessionInfo>) => void) => void;
  'room:join': (p: { code: string; name: string }, ack: (res: Ack<SessionInfo>) => void) => void;
  'room:resume': (p: { code: string; token: string }, ack: (res: Ack<{ code: string; playerId: string }>) => void) => void;
  'room:start': (p: Record<string, never>, ack: (res: Ack) => void) => void;
  'room:leave': (p: Record<string, never>, ack: (res: Ack) => void) => void;
  'draft:pick': (p: { instanceId: string }) => void;
  'deck:save': (p: DeckSavePayload, ack: (res: { ok: boolean; message?: string }) => void) => void;
}

export interface ServerToClientEvents {
  'room:lobby': (p: LobbyView) => void;
  'draft:state': (p: DraftStatePayload) => void;
  'draft:complete': (p: { code: string; pool: Card[] }) => void;
  'room:error': (p: { message: string }) => void;
}
```

- [ ] **Step 2: Write the failing integration tests**

Replace `server/test/server.test.ts` entirely:
```ts
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
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w @mtg/server -- server`
Expected: FAIL (`room:create` is not handled; the old server still imports the old manager).

- [ ] **Step 4: Rewrite the server**

`server/src/server.ts`:
```ts
import { createServer, type RequestListener } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, SetInfo } from '@mtg/shared';
import { InvalidPickError } from './draft/engine';
import type { HumanSeat, Room, RoomManager } from './rooms/manager';
import { completeFor, draftStateFor, lobbyView } from './rooms/views';

interface SocketData {
  roomId?: string;
  playerId?: string;
  creates?: number[];
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

  manager.onChange = (room) => {
    for (const player of room.players) {
      if (!player.socketId) continue;
      const socket = io.sockets.sockets.get(player.socketId);
      if (socket) sendRoomTo(socket, room, player);
    }
  };

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
      const t = now();
      const recent = (socket.data.creates ?? []).filter((at) => t - at < CREATE_WINDOW_MS);
      if (recent.length >= CREATE_LIMIT) return reply(ack, { ok: false, message: 'Too many rooms created, wait a minute' });
      socket.data.creates = [...recent, t];
      try {
        leaveCurrent();
        const { room, player } = await manager.createRoom({
          name: field(p, 'name'),
          setCode: field(p, 'setCode'),
          timerSeconds: field(p, 'timerSeconds'),
          practice: field(p, 'practice'),
          socketId: socket.id,
        });
        bind(room, player);
        reply(ack, { ok: true, code: room.code, playerId: player.playerId, token: player.token });
      } catch (err) {
        reply(ack, { ok: false, message: message(err) });
      }
    });

    socket.on('room:join', (p, ack) => {
      if (typeof ack !== 'function') return;
      try {
        leaveCurrent();
        const { room, player } = manager.joinRoom({ code: field(p, 'code'), name: field(p, 'name'), socketId: socket.id });
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
            old.emit('room:error', { message: 'Opened in another tab' });
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

    socket.on('disconnect', () => manager.disconnect(socket.id));
  });

  return { httpServer, io };
}
```

`server/src/index.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { createScryfallClient } from './cards/client';
import { createCardSource } from './cards/source';
import { RoomManager } from './rooms/manager';
import { createDraftServer } from './server';

const cacheDir = fileURLToPath(new URL('../.cache', import.meta.url));
const source = createCardSource({ client: createScryfallClient(), cacheDir });
const manager = new RoomManager({
  getSetCards: (code) => source.getSetCards(code),
  getSetName: async (code) => {
    try {
      return (await source.listDraftableSets()).find((s) => s.code === code)?.name;
    } catch {
      return undefined;
    }
  },
});
const { httpServer } = createDraftServer({ manager, listSets: () => source.listDraftableSets() });

setInterval(() => manager.sweep(), 60_000).unref();

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, () => console.log(`Draft server listening on http://localhost:${port}`));
```

Delete the old practice manager and its tests:
```bash
git rm server/src/rooms/RoomManager.ts server/test/rooms.test.ts
```

- [ ] **Step 5: Verify**

Run: `npm test -w @mtg/server` three times → all PASS, no flakes, no stray output. Run: `npm run typecheck -w @mtg/shared -w @mtg/server` → no errors. (The client typecheck fails until Task 7; that is expected.)

- [ ] **Step 6: Commit**

```bash
git add shared/src/events.ts server/src/server.ts server/src/index.ts server/test/server.test.ts
git commit -m "feat(server): room events with per-player broadcasts"
```

### Task 7: Client session, App state machine, Home with create / join / practice

**Files:**
- Create: `client/src/lib/session.ts`
- Test: `client/test/session.test.ts`
- Modify: `client/src/App.tsx` (rewrite), `client/src/screens/Home.tsx` (rewrite), `client/src/styles.css` (append)

**Interfaces:**
- Consumes: Task 6 event contract; `LobbyView`, `DraftStatePayload`, `SessionInfo`, `TIMER_OPTIONS` from `@mtg/shared`; existing `Draft` (props `{ view: SeatView }`) and `Deckbuilder` (props `{ pool, onNewDraft, notice }`).
- Produces: `parseSession(raw: string | null): SessionInfo | null`, `roomCodeFromUrl(search: string): string`, `secondsLeft(deadline: number | null, now: number): number | null`, `loadSession()`, `saveSession(s | null)`, `loadName()`, `saveName(name)`. App screens `home | lobby | draft | deck`. Placeholders for Tasks 8–9 (replaced verbatim later):
  - `if (screen.name === 'lobby') return <main className="home"><p>Lobby {screen.lobby.code} (Task 8)</p></main>;`
  - `if (screen.name === 'draft') return <Draft view={screen.state.view} />;`

- [ ] **Step 1: Write the failing tests**

`client/test/session.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseSession, roomCodeFromUrl, secondsLeft } from '../src/lib/session';

describe('parseSession', () => {
  it('accepts a well-formed session', () => {
    expect(parseSession('{"code":"KX7Q","playerId":"p","token":"t"}')).toEqual({ code: 'KX7Q', playerId: 'p', token: 't' });
  });
  it('rejects missing, malformed or incomplete data', () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession('not json')).toBeNull();
    expect(parseSession('{"code":"KX7Q"}')).toBeNull();
  });
});

describe('roomCodeFromUrl', () => {
  it('reads and uppercases ?room=', () => {
    expect(roomCodeFromUrl('?room=kx7q')).toBe('KX7Q');
    expect(roomCodeFromUrl('?x=1')).toBe('');
    expect(roomCodeFromUrl('')).toBe('');
  });
});

describe('secondsLeft', () => {
  it('rounds up and never goes below zero', () => {
    expect(secondsLeft(null, 0)).toBeNull();
    expect(secondsLeft(10_000, 0)).toBe(10);
    expect(secondsLeft(10_000, 9_001)).toBe(1);
    expect(secondsLeft(10_000, 12_000)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @mtg/client -- session` → FAIL (cannot resolve `../src/lib/session`).

- [ ] **Step 3: Implement the session helpers**

`client/src/lib/session.ts`:
```ts
import type { SessionInfo } from '@mtg/shared';

const SESSION_KEY = 'mtg.session';
const NAME_KEY = 'mtg.name';

export function parseSession(raw: string | null): SessionInfo | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SessionInfo> | null;
    if (v && typeof v.code === 'string' && typeof v.playerId === 'string' && typeof v.token === 'string') {
      return { code: v.code, playerId: v.playerId, token: v.token };
    }
  } catch {
    // fall through
  }
  return null;
}

export function roomCodeFromUrl(search: string): string {
  const code = new URLSearchParams(search).get('room');
  return code ? code.trim().toUpperCase().slice(0, 4) : '';
}

export function secondsLeft(deadline: number | null, now: number): number | null {
  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable: resume just won't work
  }
}

export const loadSession = () => parseSession(read(SESSION_KEY));
export const saveSession = (s: SessionInfo | null) => write(SESSION_KEY, s ? JSON.stringify(s) : null);
export const loadName = () => read(NAME_KEY) ?? '';
export const saveName = (name: string) => write(NAME_KEY, name);
```

Run: `npm test -w @mtg/client -- session` → PASS (5 tests).

- [ ] **Step 4: Rewrite App**

`client/src/App.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import type { Ack, Card, DraftStatePayload, LobbyView, SessionInfo } from '@mtg/shared';
import { socket } from './socket';
import { loadName, loadSession, roomCodeFromUrl, saveName, saveSession } from './lib/session';
import { Home } from './screens/Home';
import { Draft } from './screens/Draft';
import { Deckbuilder } from './screens/Deckbuilder';

type Screen =
  | { name: 'home' }
  | { name: 'lobby'; lobby: LobbyView }
  | { name: 'draft'; state: DraftStatePayload }
  | { name: 'deck'; pool: Card[] };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [session, setSession] = useState<SessionInfo | null>(() => loadSession());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const screenRef = useRef(screen);
  screenRef.current = screen;

  const remember = (s: SessionInfo | null) => {
    saveSession(s);
    setSession(s);
  };

  useEffect(() => {
    const onLobby = (lobby: LobbyView) => {
      setBusy(false);
      setError(null);
      setScreen({ name: 'lobby', lobby });
    };
    const onState = (state: DraftStatePayload) => {
      setBusy(false);
      setError(null);
      setScreen({ name: 'draft', state });
    };
    const onComplete = ({ pool }: { pool: Card[] }) => {
      setNotice(null);
      setScreen((s) => (s.name === 'deck' ? s : { name: 'deck', pool }));
    };
    const onError = ({ message }: { message: string }) => {
      saveSession(null);
      setSession(null);
      setBusy(false);
      if (screenRef.current.name === 'deck') {
        setNotice(`${message}. You can still export or download this deck, but Save is unavailable.`);
      } else {
        setError(message);
        setScreen({ name: 'home' });
      }
    };
    const onConnect = async () => {
      const s = loadSession();
      if (!s) return;
      try {
        const res = await socket.timeout(10_000).emitWithAck('room:resume', { code: s.code, token: s.token });
        if (!res.ok) onError({ message: res.message });
      } catch {
        // no answer: Socket.IO reconnects and 'connect' fires again
      }
    };

    socket.on('room:lobby', onLobby);
    socket.on('draft:state', onState);
    socket.on('draft:complete', onComplete);
    socket.on('room:error', onError);
    socket.on('connect', onConnect);
    if (socket.connected) onConnect();
    return () => {
      socket.off('room:lobby', onLobby);
      socket.off('draft:state', onState);
      socket.off('draft:complete', onComplete);
      socket.off('room:error', onError);
      socket.off('connect', onConnect);
    };
  }, []);

  const enter = async (request: Promise<Ack<SessionInfo>>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await request;
      setBusy(false);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      remember({ code: res.code, playerId: res.playerId, token: res.token });
      try {
        history.replaceState(null, '', location.pathname);
      } catch {
        // ignore
      }
    } catch {
      setBusy(false);
      setError('The draft server did not respond.');
    }
  };

  const createRoom = (name: string, setCode: string, timerSeconds: number | null, practice: boolean) => {
    saveName(name);
    enter(socket.timeout(30_000).emitWithAck('room:create', { name, setCode, timerSeconds, practice }));
  };

  const joinRoom = (name: string, code: string) => {
    saveName(name);
    enter(socket.timeout(10_000).emitWithAck('room:join', { code, name }));
  };

  const leave = () => {
    socket.emit('room:leave', {}, () => {});
    remember(null);
    setNotice(null);
    setError(null);
    setScreen({ name: 'home' });
  };

  if (screen.name === 'lobby') return <main className="home"><p>Lobby {screen.lobby.code} (Task 8)</p></main>;
  if (screen.name === 'draft') return <Draft view={screen.state.view} />;
  if (screen.name === 'deck') return <Deckbuilder pool={screen.pool} onNewDraft={leave} notice={notice} />;
  return (
    <Home
      busy={busy}
      error={error}
      initialName={loadName()}
      initialCode={roomCodeFromUrl(location.search)}
      onCreate={createRoom}
      onJoin={joinRoom}
    />
  );
}
```
(`session` is read by the Lobby in Task 8; keep the state even though this task only writes it.)

- [ ] **Step 5: Rewrite Home**

`client/src/screens/Home.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import { TIMER_OPTIONS, type SetInfo } from '@mtg/shared';
import { socket } from '../socket';

interface Props {
  busy: boolean;
  error: string | null;
  initialName: string;
  initialCode: string;
  onCreate: (name: string, setCode: string, timerSeconds: number | null, practice: boolean) => void;
  onJoin: (name: string, code: string) => void;
}

export function Home({ busy, error, initialName, initialCode, onCreate, onJoin }: Props) {
  const [sets, setSets] = useState<SetInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [setCode, setSetCode] = useState('');
  const [name, setName] = useState(initialName);
  const [timer, setTimer] = useState<number | null>(60);
  const [code, setCode] = useState(initialCode);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await socket.timeout(15_000).emitWithAck('sets:list');
      if (res.ok) {
        setSets(res.sets);
        setSetCode((c) => c || res.sets[0]?.code || '');
      } else {
        setLoadError(res.message);
      }
    } catch {
      setLoadError('The draft server did not respond. (On a free host the first visit can take a minute to wake up.)');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const nameOk = name.trim().length > 0;
  const canCreate = nameOk && !!setCode && !busy;
  const canJoin = nameOk && code.length === 4 && !busy;

  return (
    <main className="home">
      <h1>MTG Draft</h1>
      <p className="muted">Draft real Magic sets with friends, or practice against bots.</p>

      {loadError && (
        <div className="error">
          <span>{loadError}</span>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      )}
      {error && <div className="error"><span>{error}</span></div>}

      <label>
        <div className="muted label">Your name</div>
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" disabled={busy} />
      </label>

      <section className="panel">
        <h2>Join a friend</h2>
        <div className="home-row">
          <input
            className="code-input"
            value={code}
            maxLength={4}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            placeholder="CODE"
            autoFocus={initialCode.length > 0}
            disabled={busy}
          />
          <button className="btn btn-primary" onClick={() => onJoin(name.trim(), code)} disabled={!canJoin}>Join room</button>
        </div>
      </section>

      <section className="panel">
        <h2>Start a draft</h2>
        <label>
          <div className="muted label">Set</div>
          <select value={setCode} onChange={(e) => setSetCode(e.target.value)} disabled={!sets || busy}>
            {!sets && <option>Loading sets…</option>}
            {sets?.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name} ({s.code.toUpperCase()}) · {s.releasedAt.slice(0, 4)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <div className="muted label">Pick timer (rooms only)</div>
          <select
            value={timer === null ? 'off' : String(timer)}
            onChange={(e) => setTimer(e.target.value === 'off' ? null : Number(e.target.value))}
            disabled={busy}
          >
            {TIMER_OPTIONS.map((t) => (
              <option key={t} value={t}>{t} seconds</option>
            ))}
            <option value="off">Off</option>
          </select>
        </label>
        <div className="home-row">
          <button className="btn btn-primary" onClick={() => onCreate(name.trim(), setCode, timer, false)} disabled={!canCreate}>
            Create room
          </button>
          <button className="btn" onClick={() => onCreate(name.trim(), setCode, null, true)} disabled={!canCreate}>
            Practice vs bots
          </button>
        </div>
        {busy && <p className="muted">Opening packs… the first load of a set can take a few seconds.</p>}
      </section>
    </main>
  );
}
```

Append to `client/src/styles.css`:
```css
.home input { width: 100%; padding: 8px; background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; }
.home .label { margin-bottom: 6px; }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px; display: grid; gap: 12px; }
.panel h2 { font-size: 16px; }
.panel select, .panel input { background: var(--bg); }
.home-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.home-row input { flex: 1; min-width: 0; }
.code-input { text-transform: uppercase; letter-spacing: 0.3em; font-weight: 600; max-width: 140px; }
```

- [ ] **Step 6: Verify**

Run: `npm test` → all pass. Run: `npm run typecheck` → no errors (all workspaces again). Run: `npm run build -w @mtg/client` → succeeds.
Manual (if a browser is available): `npm run dev`, open http://localhost:5173 → **Practice vs bots** drafts as before; **Create room** shows the "Lobby CODE (Task 8)" placeholder; a second window joining with that code shows the same placeholder.

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/session.ts client/test/session.test.ts client/src/App.tsx client/src/screens/Home.tsx client/src/styles.css
git commit -m "feat(client): room-based app flow with create, join and practice"
```

### Task 8: Lobby screen

**Files:**
- Create: `client/src/screens/Lobby.tsx`
- Modify: `client/src/App.tsx` (replace the lobby placeholder), `client/src/styles.css` (append)

**Interfaces:**
- Consumes: `LobbyView` (Task 1); `room:start` ack (Task 6); App's `session` and `leave` (Task 7).
- Produces: `Lobby({ lobby, playerId, onLeave }: { lobby: LobbyView; playerId: string; onLeave: () => void })`.

- [ ] **Step 1: Implement the screen**

`client/src/screens/Lobby.tsx`:
```tsx
import { useState } from 'react';
import type { LobbyView } from '@mtg/shared';
import { socket } from '../socket';

interface Props {
  lobby: LobbyView;
  playerId: string;
  onLeave: () => void;
}

export function Lobby({ lobby, playerId, onLeave }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const isHost = lobby.hostPlayerId === playerId;
  const invite = `${location.origin}/?room=${lobby.code}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite);
      setStatus('Invite link copied');
    } catch {
      setStatus(`Copy failed. Share this link: ${invite}`);
    }
  };

  const start = async () => {
    setStarting(true);
    setStatus(null);
    try {
      const res = await socket.timeout(30_000).emitWithAck('room:start', {});
      if (!res.ok) setStatus(res.message);
    } catch {
      setStatus('The server did not respond.');
    } finally {
      setStarting(false);
    }
  };

  return (
    <main className="home lobby">
      <div>
        <div className="muted">Room code</div>
        <div className="room-code">{lobby.code}</div>
      </div>
      <div className="home-row">
        <button className="btn" onClick={copy}>Copy invite link</button>
        <button className="btn" onClick={onLeave}>Leave</button>
      </div>
      {status && <p className="muted" role="status">{status}</p>}

      <section className="panel">
        <h2>
          {lobby.setName} <span className="muted">({lobby.setCode.toUpperCase()})</span>
        </h2>
        <p className="muted">Pick timer: {lobby.timerSeconds ? `${lobby.timerSeconds} seconds` : 'off'}</p>
        <h2>Players {lobby.players.length} / 8</h2>
        <ul className="players">
          {lobby.players.map((p) => (
            <li key={p.playerId}>
              <span className={p.connected ? 'dot on' : 'dot'} title={p.connected ? 'Online' : 'Offline'} />
              {p.name}
              {p.playerId === playerId && <span className="muted"> (you)</span>}
              {p.playerId === lobby.hostPlayerId && <span className="badge">host</span>}
            </li>
          ))}
        </ul>
      </section>

      {isHost ? (
        <div>
          <button className="btn btn-primary" onClick={start} disabled={starting}>
            {starting ? 'Starting…' : 'Start draft'}
          </button>
          <p className="muted">Empty seats will be filled by bots.</p>
        </div>
      ) : (
        <p className="muted">Waiting for the host to start…</p>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Wire into App**

In `client/src/App.tsx` add `import { Lobby } from './screens/Lobby';` and replace:
```tsx
  if (screen.name === 'lobby') return <main className="home"><p>Lobby {screen.lobby.code} (Task 8)</p></main>;
```
with:
```tsx
  if (screen.name === 'lobby') {
    // The lobby event can arrive just before the create/join ack that stores the session.
    if (!session) return <main className="home"><p className="muted">Joining…</p></main>;
    return <Lobby lobby={screen.lobby} playerId={session.playerId} onLeave={leave} />;
  }
```

- [ ] **Step 3: Append styles**

Append to `client/src/styles.css`:
```css
.room-code { font-size: 48px; font-weight: 700; letter-spacing: 0.3em; color: var(--accent); }
.players { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.players li { display: flex; align-items: center; gap: 8px; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--border); display: inline-block; }
.dot.on { background: #5cb85c; }
.badge { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid var(--accent); color: var(--accent); border-radius: 4px; padding: 1px 6px; margin-left: 4px; }
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck`, `npm test`, `npm run build -w @mtg/client` → all pass.
Manual (if a browser is available): two windows on http://localhost:5173. Window A creates a room and sees its code, itself as host and the Start button. Window B joins with the code and appears in both lists with "(you)" in its own. B sees "Waiting for the host to start…". Leave in B removes it from A's list. Start in A moves both to the draft.

- [ ] **Step 5: Commit**

```bash
git add client/src/screens/Lobby.tsx client/src/App.tsx client/src/styles.css
git commit -m "feat(client): room lobby"
```

### Task 9: Draft countdown and table strip

**Files:**
- Create: `client/src/components/TableStrip.tsx`
- Modify: `client/src/screens/Draft.tsx`, `client/src/App.tsx` (Draft props), `client/src/styles.css` (append)

**Interfaces:**
- Consumes: `DraftStatePayload`, `TableSeat` (Task 1); `secondsLeft` (Task 7).
- Produces: `Draft({ state }: { state: DraftStatePayload })`; `TableStrip({ table }: { table: TableSeat[] })`.

- [ ] **Step 1: Table strip component**

`client/src/components/TableStrip.tsx`:
```tsx
import type { TableSeat } from '@mtg/shared';

export function TableStrip({ table }: { table: TableSeat[] }) {
  return (
    <ol className="table-strip" aria-label="Seats in passing order">
      {table.map((seat, i) => {
        const cls = ['seat', seat.isYou && 'you', seat.picked && 'picked', !seat.connected && 'offline', seat.isBot && 'bot']
          .filter(Boolean)
          .join(' ');
        return (
          <li key={i} className={cls} title={seat.connected ? undefined : 'Disconnected: picks are made automatically'}>
            {seat.name}
            {seat.picked && <span aria-label="picked"> ✓</span>}
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 2: Update the draft screen**

In `client/src/screens/Draft.tsx`:

1. Replace the imports and the component signature down to the `pick` function with:
```tsx
import { useCallback, useEffect, useState } from 'react';
import type { Card, DraftStatePayload } from '@mtg/shared';
import { CardImage } from '../components/CardImage';
import { CardPreview, hoverTargetFrom, type HoverTarget } from '../components/CardPreview';
import { TableStrip } from '../components/TableStrip';
import { GROUP_LABEL, groupByColor } from '../lib/cards';
import { secondsLeft } from '../lib/session';
import { socket } from '../socket';

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function Draft({ state }: { state: DraftStatePayload }) {
  const { view, pickDeadline, table } = state;
  const [pending, setPending] = useState(false);
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const clearHover = useCallback(() => setHover(null), []);
  const left = secondsLeft(pickDeadline, useNow(pickDeadline !== null));
  const waitingFor = table.filter((s) => !s.isBot && !s.picked).map((s) => s.name);

  useEffect(() => {
    setPending(false);
    setHover(null);
  }, [view]);
```

2. Replace the header:
```tsx
      <header className="draft-header">
        <h1>Pack {view.packNumber} · Pick {view.pickNumber}</h1>
        <span className="muted">{view.picks.length} / 45 picked</span>
      </header>
```
with:
```tsx
      <header className="draft-header">
        <h1>Pack {view.packNumber} · Pick {view.pickNumber}</h1>
        <div className="draft-header-right">
          {left !== null && view.currentPack && (
            <span className={left <= 10 ? 'countdown urgent' : 'countdown'} aria-label="Time left to pick">
              {left}s
            </span>
          )}
          <span className="muted">{view.picks.length} / 45 picked</span>
        </div>
      </header>
      <TableStrip table={table} />
```

3. Replace:
```tsx
            <p className="muted">Waiting for the next pack…</p>
```
with:
```tsx
            <p className="muted">
              {waitingFor.length > 0 ? `Waiting for: ${waitingFor.join(', ')}` : 'Waiting for the next pack…'}
            </p>
```

- [ ] **Step 3: Update App**

In `client/src/App.tsx` replace:
```tsx
  if (screen.name === 'draft') return <Draft view={screen.state.view} />;
```
with:
```tsx
  if (screen.name === 'draft') return <Draft state={screen.state} />;
```

- [ ] **Step 4: Append styles**

Append to `client/src/styles.css`:
```css
.draft-header-right { display: flex; align-items: baseline; gap: 14px; }
.countdown { font-variant-numeric: tabular-nums; font-weight: 700; font-size: 20px; }
.countdown.urgent { color: var(--danger); }
.table-strip { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.seat { border: 1px solid var(--border); background: var(--panel); border-radius: 999px; padding: 3px 10px; font-size: 13px; }
.seat.bot { color: var(--muted); }
.seat.picked { border-color: #5cb85c; }
.seat.you { border-color: var(--accent); font-weight: 600; }
.seat.offline { opacity: 0.45; text-decoration: line-through; }
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck`, `npm test`, `npm run build -w @mtg/client` → all pass.
Manual (if a browser is available): in a two-window room with a 30-second timer, the countdown ticks down and turns red at 10. After A picks, A sees "Waiting for: B" and both strips show ✓ on A. Letting the timer run out advances both windows to the next pick. In practice mode there's no countdown and the strip shows you plus 7 bots.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/TableStrip.tsx client/src/screens/Draft.tsx client/src/App.tsx client/src/styles.css
git commit -m "feat(client): pick countdown and table strip"
```

### Task 10: Production serving, Render blueprint, README

**Files:**
- Create: `server/src/http.ts`, `render.yaml`
- Test: `server/test/http.test.ts`
- Modify: `server/src/index.ts`, `package.json` (root scripts), `README.md`

**Interfaces:**
- Consumes: `createDraftServer({ ..., requestListener })` (Task 6).
- Produces: `createHttpHandler(opts: { staticDir: string | null }): http.RequestListener`. `GET /health` → `200 ok`. With a `staticDir` it serves files from it (SPA fallback to `index.html`, path traversal rejected with 403). Without one, every other path is 404. Root `npm run build` builds the client. Root `npm start` runs the server, which serves `client/dist` when `NODE_ENV=production`.

- [ ] **Step 1: Write the failing tests**

`server/test/http.test.ts`:
```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpHandler } from '../src/http';

let server: Server | null = null;

async function serve(staticDir: string | null): Promise<string> {
  server = createServer(createHttpHandler({ staticDir }));
  await new Promise<void>((r) => server!.listen(0, r));
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

function makeDist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mtg-dist-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<div id="root"></div>');
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
  return dir;
}

describe('http handler', () => {
  it('answers health checks', async () => {
    const base = await serve(null);
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('returns 404 for pages when no static dir is configured', async () => {
    const base = await serve(null);
    expect((await fetch(`${base}/`)).status).toBe(404);
  });

  it('serves index.html, assets and an SPA fallback', async () => {
    const base = await serve(makeDist());
    const index = await fetch(`${base}/`);
    expect(index.headers.get('content-type')).toContain('text/html');
    expect(await index.text()).toBe('<div id="root"></div>');
    const asset = await fetch(`${base}/assets/app.js`);
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    const deep = await fetch(`${base}/some/route?room=KX7Q`);
    expect(await deep.text()).toBe('<div id="root"></div>');
  });

  it('rejects path traversal', async () => {
    const base = await serve(makeDist());
    expect((await fetch(`${base}/%2e%2e%2fsecret.txt`)).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @mtg/server -- http` → FAIL (cannot resolve `../src/http`).

- [ ] **Step 3: Implement the handler**

`server/src/http.ts`:
```ts
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { RequestListener } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const isFile = (path: string) => existsSync(path) && statSync(path).isFile();

export function createHttpHandler(opts: { staticDir: string | null }): RequestListener {
  const root = opts.staticDir ? resolve(opts.staticDir) : null;

  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('ok');
      return;
    }
    if (!root || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.writeHead(404);
      res.end();
      return;
    }

    let file: string;
    try {
      file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!isFile(file)) file = join(root, 'index.html'); // client-side routes
    if (!isFile(file)) {
      res.writeHead(404);
      res.end();
      return;
    }

    const immutable = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  };
}
```

Run: `npm test -w @mtg/server -- http` → PASS (4 tests).

- [ ] **Step 4: Serve the client in production**

In `server/src/index.ts`:
1. Add `import { createHttpHandler } from './http';`
2. Replace
```ts
const { httpServer } = createDraftServer({ manager, listSets: () => source.listDraftableSets() });
```
with
```ts
const staticDir =
  process.env.NODE_ENV === 'production' ? fileURLToPath(new URL('../../client/dist', import.meta.url)) : null;
const { httpServer } = createDraftServer({
  manager,
  listSets: () => source.listDraftableSets(),
  requestListener: createHttpHandler({ staticDir }),
});
```

In root `package.json`, add to `"scripts"`:
```json
    "build": "npm run build -w @mtg/client",
    "start": "npm run start -w @mtg/server",
```

- [ ] **Step 5: Render blueprint**

`render.yaml`:
```yaml
services:
  - type: web
    name: mtg-draft
    runtime: node
    plan: free
    # NODE_ENV=production makes npm skip devDependencies; tsx and the client build tools are devDependencies.
    buildCommand: npm ci --include=dev && npm run build
    startCommand: npm start
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: NODE_VERSION
        value: "22"
```

- [ ] **Step 6: README**

Update `README.md`:
- Change the intro to describe both modes: drafting with friends in rooms (room code, bots fill empty seats, optional pick timer) and practice against bots.
- Under "Run locally", add: "To try multiplayer locally, open http://localhost:5173 in two browser windows: create a room in one and join with its code in the other."
- Add a section:

```markdown
## Deploy to Render (free)

1. Create an empty GitHub repository and push this project to it:
   `git remote add origin https://github.com/<you>/<repo>.git` then `git push -u origin master`.
2. On https://render.com, sign in with GitHub, choose **New → Blueprint**, and pick the repository.
   Render reads `render.yaml` and creates a free web service called `mtg-draft`.
3. Wait for the first build to finish (a few minutes), then open the `https://mtg-draft-….onrender.com` URL.
   Share that URL with friends; room invite links use it automatically.

Things to know about the free plan (check Render's current terms, they change):
- The service sleeps after about 15 minutes without visitors. The next visit takes about a minute to wake it.
- Rooms live in memory: a restart or redeploy ends any draft in progress.
- The Scryfall card cache is on temporary disk, so after a restart the first draft of each set re-downloads it.

To check a production build locally: `npm run build`, then `NODE_ENV=production PORT=4100 npm start`
(in Git Bash), and open http://localhost:4100.
```

- [ ] **Step 7: Verify**

Run: `npm test` and `npm run typecheck` → all pass. Run: `npm run build` → succeeds.
Production smoke test (Git Bash): start `NODE_ENV=production PORT=4100 npm start` in the background, then:
- `curl -s http://localhost:4100/health` → `ok`
- `curl -s http://localhost:4100/ | grep -c 'id="root"'` → `1`
- `curl -s "http://localhost:4100/socket.io/?EIO=4&transport=polling"` → starts with `0{`
Stop the server afterwards.

- [ ] **Step 8: Commit**

```bash
git add server/src/http.ts server/test/http.test.ts server/src/index.ts package.json render.yaml README.md
git commit -m "feat: serve the client in production and add Render blueprint"
```

---

## Spec coverage

| Spec requirement | Task |
|---|---|
| Room codes, names, tokens | 1 |
| Create / join / leave / resume / host handoff / cleanup / room cap | 2 |
| Host-only start, shuffled seats + bots, synchronized rounds, practice rooms, per-player decks | 3 |
| Pick timer, stale-timer safety, disconnect auto-pick with 5 s / 0 s grace | 4 |
| Per-player views, table strip data, no pack leaks | 5 |
| Event contract, per-socket broadcasts, "opened in another tab", create rate limit, defensive payloads | 6 |
| localStorage session + resume, Home with name / create / join / practice, invite link prefill | 7 |
| Lobby screen | 8 |
| Countdown, table strip, "Waiting for" | 9 |
| Health check, static serving, Render blueprint, README deploy guide | 10 |
