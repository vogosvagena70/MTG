# Multiplayer Draft Rooms — Design Spec

Date: 2026-10-31
Status: Approved in conversation (pending written-spec review)
Builds on: `docs/superpowers/specs/2026-10-31-practice-draft-design.md` (sub-project 1, merged to `master`)

## Context

Sub-project 2 of 3 (practice draft → **multiplayer draft** → battle tabletop). Friends open a public URL, pick a nickname, create or join a room by code, and draft together; bots fill empty seats. The app is deployed to Render's free web service. Practice mode keeps working, reimplemented as a one-human room.

## Goals

- Create a room (set + pick timer), share a 4-letter code / invite link, up to 8 humans join a lobby, host starts.
- Empty seats filled with bots; seating shuffled.
- Synchronized picking (every seat picks, then all packs pass), with an optional per-pick timer and auto-pick on timeout or disconnect.
- Each player sees only their own pack; everyone sees a table strip of who has picked.
- Reload / reconnect restores your seat.
- Each player builds and saves their own deck after the draft.
- Single deployable service on Render serving both the web page and Socket.IO.

## Non-goals

- Accounts, passwords, persistence across server restarts (rooms are in memory; a restart ends live drafts).
- Joining after start, kicking players, spectators, chat.
- Queue-based (asynchronous) passing.
- Battles of any kind.

## Decisions made

| Topic | Decision |
|---|---|
| Passing | Synchronized rounds (existing engine unchanged) + optional timer |
| Hosting | Render free web service, deployed from a GitHub repo |
| Identity | Nickname + per-seat secret token in localStorage |
| Persistence | In-memory only |
| Room setup | Host picks set + timer (30/45/60/90/off), ≤8 humans, host starts, bots fill seats, no join after start |

## Room model (server)

```ts
interface HumanSeat {
  kind: 'human';
  playerId: string;        // random UUID, safe to share with other clients
  name: string;            // trimmed, 1–20 chars, unique within room ("Sam (2)" on collision)
  token: string;           // 128-bit random hex; secret; the only credential
  socketId: string | null; // null = disconnected
}
type Seat = HumanSeat | { kind: 'bot' };

interface Room {
  id: string;                    // internal UUID
  code: string;                  // 4 chars from the room code alphabet (below)
  setCode: string;
  timerSeconds: number | null;   // one of 30, 45, 60, 90, or null
  practice: boolean;
  hostPlayerId: string;
  phase: 'lobby' | 'drafting' | 'complete';
  lobby: HumanSeat[];            // join order; max 8
  seats: Seat[];                 // set at start: length 8
  state: DraftState | null;      // existing engine state
  round: number;                 // increments each time packs pass; tags timers
  pickDeadline: number | null;   // epoch ms for current round, null when no timer
  rng: Rng;
  decks: Map<string, DeckSavePayload>; // by playerId
  lastActivity: number;
}
```

Room code alphabet: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32 chars; excludes I, O, 0, 1). 4 characters → ~1M codes. Codes are case-insensitive on input and unique among live rooms (regenerate on collision).

### Lifecycle

1. **Create** — `room:create { name, setCode, timerSeconds, practice? }`. Validate name and timer value; load set cards first (a bad set fails here with its message). Create room in `lobby`, creator is host. Ack `{ code, playerId, token }`.
   - `practice: true` → `timerSeconds` forced to `null`, room starts immediately (step 3) with one human.
2. **Join** — `room:join { code, name }`. Only in `lobby` and with < 8 humans; otherwise ack error ("Room not found", "Draft already started", "Room is full"). Ack `{ code, playerId, token }`.
3. **Start** — `room:start` from the host only, phase `lobby`. Shuffle humans (room rng) into a random subset of the 8 seat indices; remaining seats are bots. Generate 3 packs per seat, `createDraft(8, packs)`, phase `drafting`, begin round (see Timer).
4. **Pick** — `draft:pick { instanceId }` from a human seat. `applyPick` for that seat (invalid → re-send that player's state unchanged). If every human seat has picked this round: each bot seat `botPick` + `applyPick`, then `advanceIfReady`, `round++`, begin next round or complete.
5. **Complete** — phase `complete`; every human receives `draft:complete { code, pool }` (their own picks). `deck:save` validates against that player's pool and stores under their `playerId`.
6. **Leave** — `room:leave`: in `lobby`, removes the player (if the host leaves, host passes to the earliest remaining player; an empty lobby is deleted). During `drafting`/`complete`, marks the seat disconnected (the seat stays; auto-picks apply).

### Identity & reconnect

- Client stores `{ code, playerId, token }` in localStorage (key `mtg.session`), name in `mtg.name`. All storage access wrapped in try/catch.
- `room:resume { code, token }` → attaches the socket to the matching seat (lobby or seats), acks `{ code, playerId }`, then sends the current view (`room:lobby`, `draft:state`, or `draft:complete`). Unknown code/token → ack error; the client clears its session and shows Home.
- One live socket per seat: a newer socket replaces the older (the old socket is told `room:error { message: 'Opened in another tab' }` and detached).
- On socket disconnect: seat `socketId = null`, broadcast updated lobby/table.

### Cleanup

- Room deleted 30 minutes after `lastActivity` (as today; any event in the room refreshes it).
- A lobby with zero connected humans is deleted after 5 minutes.
- Timers for a room are cleared on completion and deletion.

## Pick timer & auto-pick

- **Begin round**: if `timerSeconds`, set `pickDeadline = now + timerSeconds*1000` and schedule a timeout tagged with `round`. Then schedule disconnect auto-picks (below). Broadcast state.
- **Timeout fires**: if `room.round` ≠ the tagged round, ignore. Otherwise every human seat that hasn't picked gets an **auto-pick**: `botPick(currentPack, picks, rng)`. Then continue as in Lifecycle step 4.
- **Disconnected humans**: when a round begins (or a seat disconnects mid-round) and the seat has no socket, auto-pick it after a grace period: 5 s if the room has a timer, 0 s (immediately) if not. A reconnect before the grace expires cancels it.
- Deadline is sent as an epoch-ms timestamp; the server's clock is authoritative.
- `RoomManager` receives a `Scheduler { setTimeout(fn, ms): unknown; clearTimeout(handle): void }` dependency (default: global timers) so tests drive time with a fake.

## Server structure

- `server/src/rooms/RoomManager.ts` — rewritten around the model above; pure of sockets. Constructor deps: `{ getSetCards, seed?, now?, scheduler?, onChange?(room) }`. Public methods: `createRoom`, `joinRoom`, `resume`, `startRoom`, `pick`, `leave`, `disconnect(socketId)`, `saveDeck`, `get`, `sweep`, `size`. Calls `onChange(room)` after every mutation.
- `server/src/rooms/codes.ts` — `generateCode(rng, isTaken)`.
- `server/src/rooms/views.ts` — pure builders: `lobbyView(room)`, `draftStateFor(room, playerId)`, `tableView(room)`.
- `server/src/server.ts` — socket wiring only: maps socket ↔ (roomId, playerId); on `onChange`, sends each human socket its own view; joins sockets to a Socket.IO room per room id for lobby broadcasts. Keeps the existing defensive payload/ack handling. Removes the old `practice:start` event.
- `server/src/http.ts` — in production serves `client/dist` (static files, SPA fallback to `index.html`) and `GET /health` → `200 ok`.
- Draft engine, bots, packs, cards: unchanged.

### Events (`shared/src/events.ts`)

Acks are `{ ok: true, ... } | { ok: false, message: string }`.

| Dir | Event | Payload / ack |
|---|---|---|
| C→S | `sets:list` | ack `{ sets }` (unchanged) |
| C→S | `room:create` | `{ name, setCode, timerSeconds: number \| null, practice?: boolean }` → ack `{ code, playerId, token }` |
| C→S | `room:join` | `{ code, name }` → ack `{ code, playerId, token }` |
| C→S | `room:resume` | `{ code, token }` → ack `{ code, playerId }` |
| C→S | `room:start` | `{}` → ack |
| C→S | `room:leave` | `{}` → ack |
| C→S | `draft:pick` | `{ instanceId }` |
| C→S | `deck:save` | `{ main, basics }` → ack `{ ok, message? }` |
| S→C | `room:lobby` | `{ code, setCode, setName, timerSeconds, hostPlayerId, players: { playerId, name, connected }[] }` |
| S→C | `draft:state` | `{ code, view: SeatView, pickDeadline: number \| null, table: { name, isBot, picked, connected, isYou }[] }` |
| S→C | `draft:complete` | `{ code, pool: Card[] }` |
| S→C | `room:error` | `{ message }` |

`table` is the 8 seats in passing order; bots are named "Bot 1"…"Bot 7" in seat order. `picked` = seat has picked this round.

### Limits

- `room:create`: max 2 per socket per rolling minute; max 200 live rooms (error "Server is busy, try again later").
- Names 1–20 chars after trimming; control characters stripped.
- All payload fields validated defensively; malformed input → ack error or ignored, never a crash.

## Client

- **Home**: name field (remembered); three actions:
  - *Practice draft*: set picker → start (as today).
  - *Create room*: set picker + timer select (30/45/60/90/Off, default 60) → create → Lobby.
  - *Join room*: 4-char code input (auto-uppercase) → join → Lobby. Visiting `/?room=KX7Q` pre-fills the code and focuses Join.
- **Lobby**: big room code, "Copy invite link" (`<origin>/?room=CODE`), set name, timer, player list (host badge, online dot, "(you)"); host sees **Start draft** ("Empty seats will be filled by bots"); others see "Waiting for the host to start…"; everyone sees **Leave**.
- **Draft**: existing screen + header countdown (seconds remaining from `pickDeadline`, red at ≤10 s; hidden when no timer) + table strip (8 chips in passing order: name, ✓ when picked, dimmed when disconnected, highlighted "you"). After picking: "Waiting for: <names of humans who haven't picked>".
- **Deckbuilder**: unchanged; saves per player.
- On load: if a stored session exists, `room:resume`; failure clears it and shows Home with the message.
- In production the client connects to the same origin (no proxy needed).

## Deployment

- Root `npm run build` builds the client (`client/dist`). `npm start` runs the server with `NODE_ENV=production`, serving `client/dist` and Socket.IO on `process.env.PORT`.
- `render.yaml` (Blueprint): one free `web` service, runtime node, build `npm ci && npm run build`, start `npm start`, health check `/health`, env `NODE_ENV=production`.
- README section "Deploy to Render": create GitHub repo → push → Render "New Blueprint" from repo → open the `onrender.com` URL. Notes: free instance sleeps after ~15 min idle (first visit waits ~1 min); restarts end live drafts and clear the card cache. Confirm Render's current free-tier terms at deploy time.
- Local dev unchanged (`npm run dev`, Vite proxy).

## Testing

- Unit (`RoomManager`, fake scheduler + fixed seed + fake clock):
  - create/join/leave in lobby; host handoff; empty lobby deletion; 8-player cap; duplicate names; join after start rejected
  - host-only start; seat shuffle places all humans; 8 seats total with bots
  - round advances only after all humans pick; bots pick once per round
  - timer: auto-picks un-picked humans at deadline; stale timer (old round) ignored; no timer → no deadline
  - disconnected human auto-picked (0 s without timer, 5 s with timer); reconnect within grace cancels
  - resume by token (lobby and drafting); wrong token rejected; newer socket replaces older
  - per-player deck save validation; cleanup sweeps; create rate limit and room cap
  - practice room: one human, starts immediately, no timer, full 45 picks
- Unit: `generateCode` alphabet/length/uniqueness; view builders never include other seats' packs.
- Integration (Socket.IO, fixture set): two clients create/join/start and draft 45 picks to `draft:complete` (each receives only its own pack; table `picked` flags update); timeout auto-pick with a short timer; token reconnect restores seat mid-draft; practice flow end to end; malformed payloads don't crash.
- HTTP: `/health` returns 200; static serving returns `index.html` for `/` and unknown paths in production mode.
- Manual: two browser windows locally; one real session on Render after deploy.
