# Battle Tabletop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a multiplayer draft, players with saved decks challenge each other to 1-vs-1 games on a manual, server-authoritative tabletop (library, hand, battlefield, graveyard; draw, move, tap, life, shuffle, mulligan, concede, log).

**Architecture:** A pure `server/src/game/` module (build, actions, per-seat view) like the draft engine. A `Battles` class (`server/src/rooms/battles.ts`) owns challenges and live games per room, uses the room manager for room/deck/pool lookups, and reports changes through the same `onChange(room)` path the draft uses; `server.ts` sends each connected human their roster, pending challenge and game view. The client adds a room panel to the deckbuilder and a mirrored game screen.

**Tech Stack:** TypeScript strict ESM, Node + Socket.IO 4.8, React 18 + Vite 5, Vitest 2; HTML5 drag and drop.

**Spec:** `docs/superpowers/specs/2026-10-31-battle-tabletop-design.md`

## Global Constraints

- Only completed, non-practice multiplayer rooms can battle. One live game and at most one pending challenge (sent or received) per player.
- Challenge expires after 60 s. A finished game is deleted once both players left it or 5 minutes after it ended.
- Deck = saved main cards (from that player's pool) + basic counts (Plains W, Island U, Swamp B, Mountain R, Forest G) using `room.set.basics`; fewer than 40 cards → `Deck must have at least 40 cards`.
- Start: life 20, library shuffled with the game rng (seeded), 7 cards drawn, `firstPlayer = rng() < 0.5 ? 0 : 1`, log `"<name> goes first"`.
- Action payload limits: `draw.count` integer 1–7; `life.delta` integer −20…20 and ≠ 0; battlefield `x`/`y` clamped to 0–100 (default 50/50).
- After `over` is set every action fails with `Game is over`. Battlefield→battlefield `move` repositions silently and keeps `tapped`. Leaving the battlefield untaps. Moving to the library puts the card on top.
- Log text exactly as in the spec's action table; log capped at 100 entries.
- A view never contains the opponent's hand cards or any library card (either player); library cards are never targetable.
- No `alert`/`confirm`/`prompt`; confirms are in-page. All timer callbacks and broadcasts are wrapped in error boundaries (reuse the existing `safely` pattern / per-socket try-catch).
- Deck errors at accept (spec: "both get the message"): the responder gets the message in their ack; the challenger is notified via `battle:declined` and the roster.
- Existing conventions: defensive `field()` payload reads, guarded acks `{ ok:true,… } | { ok:false, message }`, no UTF-8 BOM, stage files by path, never commit `.superpowers/`, `server/.cache/`, `client/dist/`.

## Review Focus

- **Leaving an unfinished game:** `game:leave` before `over` concedes first; the opponent's view shows `over.conceded` = the leaver and they can still leave normally. (Test: Task 4.)
- **Stale challenge answers:** accepting after the 60 s expiry, or after the challenger started another game, fails with a clear message and creates no game. (Test: Task 4.)
- **Re-saving a deck mid-game:** the running game is a snapshot and is unchanged; a new challenge uses the new deck. (Test: Task 4.)
- **Rejected actions surface in the UI:** e.g. Draw with an empty library shows the ack message near the controls instead of failing silently. (Test: Task 7 helper `actionErrorText`, plus manual check.)
- **Reload mid-game / with a pending challenge:** resume restores `game:state` and the challenge banner, not just the deckbuilder. (Test: Task 5 integration.)

## File Structure

```
shared/src/types.ts               + Zone, GameCard, GameView, GameAction, RosterPlayer, IncomingChallenge
shared/src/events.ts              + battle:* and game:* events
server/src/game/state.ts          GameState, PlayerState, GameError, createLog helpers
server/src/game/build.ts          buildGame
server/src/game/actions.ts        parseAction, applyAction
server/src/game/view.ts           gameViewFor
server/src/rooms/battles.ts       Battles (challenges, live games, cleanup)
server/src/rooms/battleViews.ts   rosterFor
server/src/server.ts, index.ts    wiring
client/src/lib/battle.ts          dropPosition, actionErrorText
client/src/components/RoomPanel.tsx
client/src/components/game/*.tsx  Battlefield, HandRow, ZonePile, CardMenu, GraveyardViewer, GameLog
client/src/screens/Game.tsx
client/src/App.tsx, screens/Deckbuilder.tsx
server/test/game.test.ts, battles.test.ts, server.test.ts (extend); client/test/battle.test.ts
```

---

### Task 1: Shared battle types and building a game

**Files:**
- Modify: `shared/src/types.ts`
- Create: `server/src/game/state.ts`, `server/src/game/build.ts`
- Test: `server/test/game.test.ts`

**Interfaces:**
- Consumes: `Card`, `Color`, `COLORS`, `DeckSavePayload`, `SetCards` (shared); `mulberry32`, `Rng`; `makeCard`, `makeSet` helpers.
- Produces (shared): `type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard'`; `interface GameCard { gid: string; card: Card; owner: 0 | 1; tapped: boolean; x: number; y: number }`; `type GameAction = { type: 'draw'; count: number } | { type: 'move'; gid: string; to: Zone; x?: number; y?: number } | { type: 'tap'; gid: string; tapped: boolean } | { type: 'untapAll' } | { type: 'shuffle' } | { type: 'mulligan' } | { type: 'life'; delta: number } | { type: 'concede' }`; `interface GameView` exactly as in the spec; `interface RosterPlayer { playerId: string; name: string; deckSaved: boolean; inGame: boolean; connected: boolean; isYou: boolean }`; `interface IncomingChallenge { fromPlayerId: string; fromName: string; expiresAt: number }`.
- Produces (server `state.ts`): `PlayerState`, `GameState` (spec shape; `rng: Rng`), `class GameError extends Error`, `MAX_LOG = 100`, `appendLog(state, text, now): GameState['log']`, `shuffleInPlace(ids: string[], rng: Rng): void` (Fisher–Yates).
- Produces (`build.ts`): `buildGame(input: { id: string; roomId: string; seed: number; now: number; basics: Card[]; players: [BuildPlayer, BuildPlayer] }): GameState` where `BuildPlayer = { playerId: string; name: string; pool: Card[]; deck: DeckSavePayload }`.

- [ ] **Step 1: Write failing tests** in `server/test/game.test.ts` (`describe('buildGame')`), using a 45-card pool from `makeSet().cards` with instanceIds `p0-0…`, `p1-0…`:
  - `builds 40-card decks with basics`: deck main = 23 instanceIds, basics `{W:0,U:0,B:0,R:8,G:9}` → each player owns 40 cards total; 8 cards named `Mountain` and 9 `Forest` in player 0's cards; hand length 7, library length 33; life 20.
  - `rejects decks under 40`: main 23 + basics 16 → throws `Deck must have at least 40 cards`.
  - `assigns gids before shuffling and shuffles with the seed`: two builds with the same seed produce identical `zones.library`; different seeds produce different orders; every gid matches `/^g\d+$/` and they are unique.
  - `flips for first player and logs it`: `firstPlayer` ∈ {0,1}; `log[0].text` = `"<name of firstPlayer> goes first"`.
  - `falls back to a text-only basic when the set lacks one`: basics list without Forest → player 0's Forest cards have `card.name === 'Forest'` and `card.imageUrl === ''`.
  - `rejects main ids not in the pool`: a main id not in the pool → throws `GameError('Deck contains cards that are not in your pool')`.
- [ ] **Step 2:** `npm test -w @mtg/server -- game` → FAIL (module missing).
- [ ] **Step 3:** Add the shared types; implement `state.ts` and `buildGame` per the spec's "Building a game" (gids `g1…gN`, player 0 first in deck order then basics in W U B R G order; then shuffle each library with `mulberry32(seed)`; draw 7 each; empty log then `goes first` entry).
- [ ] **Step 4:** `npm test -w @mtg/server -- game` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5:** Commit `feat(server): build battle games from saved decks`.

### Task 2: Game actions

**Files:**
- Create: `server/src/game/actions.ts`
- Test: `server/test/game.test.ts` (append `describe('applyAction')`)

**Interfaces:**
- Consumes: Task 1 (`GameState`, `GameError`, `appendLog`, `shuffleInPlace`, `GameAction`, `Zone`).
- Produces: `parseAction(raw: unknown): GameAction` (throws `GameError('Invalid action')` for unknown type / wrong field types / out-of-range `count` or `delta`; clamps nothing — clamping x/y happens in apply); `applyAction(state: GameState, seat: 0 | 1, action: GameAction, now: number): GameState` (returns a new state object with copied `players`, `zones`, `cards` entries it touches; never mutates input arrays/objects; the `rng` closure is shared and advances).

- [ ] **Step 1: Write failing tests** (seeded game from a Task 1 helper `newGame()` in the test file; names `Ann` seat 0, `Bob` seat 1):
  - `draw moves from library top to hand and logs`: draw 2 → hand 9, library 31, moved gids are the old `library[0..1]`; last log `Ann drew 2 cards`. Draw 1 logs `Ann drew 1 card`.
  - `draw with an empty library fails`: empty Ann's library first (move via repeated draws in a loop of 7s) → `draw` throws `Library is empty`.
  - `move hand→battlefield sets position, untapped, logs name`: x 120, y −5 → clamped to 100 / 0; log `Ann moved <name> to battlefield`.
  - `reposition on battlefield is silent and keeps tapped`: tap, then move to battlefield at new x/y → `tapped` true, log length unchanged.
  - `leaving the battlefield untaps; to library goes on top`: tapped card → graveyard → `tapped` false; hand card → library → it is `library[0]`, log `Ann put a card from their hand on top of their library`.
  - `cannot touch the opponent's cards or library cards`: Ann `move` Bob's hand gid → throws `GameError`; Ann `move` her own `library[0]` gid → throws `GameError` (`Card is not available`).
  - `tap requires a battlefield card`: tap a hand card → throws.
  - `untapAll`, `shuffle` (library same multiset, log `Ann shuffled their library`), `mulligan` (hand 7, library 33, log `Ann took a mulligan`), `life` (+3 then −25 → log `Ann's life: 20 → 23`, then life −2 allowed), `concede` (`over = { conceded: 0 }`, log `Ann conceded`; any further action throws `Game is over`).
  - `log is capped at 100`: 120 `life` actions → `log.length === 100`, last entry is the newest.
  - `applyAction does not mutate its input`: `JSON.stringify` of the input state (minus rng) equal before/after a move.
  - `parseAction rejects bad payloads`: `null`, `{type:'draw',count:0}`, `{type:'draw',count:8}`, `{type:'life',delta:0}`, `{type:'life',delta:21}`, `{type:'move',gid:'g1',to:'exile'}`, `{type:'tap',gid:1,tapped:true}` → all throw `Invalid action`; valid ones round-trip.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement per the spec's action table. Zone lookup: find which of the seat's own zones contains the gid; library is never a valid source.
- [ ] **Step 4:** run → PASS; typecheck clean.
- [ ] **Step 5:** Commit `feat(server): battle game actions`.

### Task 3: Per-seat game view

**Files:**
- Create: `server/src/game/view.ts`
- Test: `server/test/game.test.ts` (append `describe('gameViewFor')`)

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `gameViewFor(state: GameState, seat: 0 | 1, connected: [boolean, boolean]): GameView` (shape in the spec; `opp.connected = connected[1 - seat]`; battlefield/graveyard as `GameCard[]` in zone order; counts for hand/library).

- [ ] **Step 1: Write failing tests:** after a few actions, `gameViewFor(state, 0, [true,false])`: `me.hand` has 7 GameCards, `opp.handCount` 7, `opp.connected` false, `libraryCount`s correct; `JSON.stringify(view)` contains no gid from Bob's hand and no gid from either library; Bob's battlefield card moved there is present in `opp.battlefield`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS; typecheck.
- [ ] **Step 5:** Commit `feat(server): per-seat game views`.

### Task 4: Battles — challenges, live games, cleanup

**Files:**
- Create: `server/src/rooms/battles.ts`, `server/src/rooms/battleViews.ts`
- Modify: `server/src/rooms/manager.ts` (only if needed to expose a read-only room lookup that does not throw: `peek(roomId): Room | undefined`)
- Test: `server/test/battles.test.ts`

**Interfaces:**
- Consumes: `RoomManager` (`get`, `seatIndexOf`, `RoomError`, `Room.decks`, `Room.state.picks`, `Room.set.basics`, `Room.players`, `Room.practice`, `Room.phase`), Tasks 1–3, `Scheduler`, `FakeClock`.
- Produces:
  - `CHALLENGE_TTL_MS = 60_000`, `ENDED_GAME_TTL_MS = 5 * 60_000`.
  - `interface LiveGame { state: GameState; roomId: string; left: [boolean, boolean] }`.
  - `class Battles` with `constructor(deps: { manager: RoomManager; now?: () => number; scheduler?: Scheduler; seed?: () => number; onChange: (room: Room) => void; onDeclined: (room: Room, challengerId: string, byName: string, reason: 'declined' | 'expired') => void; onGameEnded: (playerIds: string[]) => void })`.
  - Methods: `challenge(roomId, fromPlayerId, toPlayerId): void`; `respond(roomId, playerId, accept: boolean): void`; `act(roomId, playerId, raw: unknown): void` (parseAction + applyAction; touches room activity via `manager.get`); `leaveGame(roomId, playerId): void`; `gameFor(playerId): LiveGame | undefined` (only games the player hasn't left); `incomingFor(playerId): IncomingChallenge | null`; `sweep(): void` (drops challenges/games whose room no longer exists).
  - `battleViews.ts`: `rosterFor(room: Room, battles: Battles, playerId: string): RosterPlayer[]` (all room players in join order).
- Errors (`RoomError`, exact messages): `Battles are only available after a multiplayer draft`, `You can't challenge yourself`, `Save your deck first`, `<name> hasn't saved a deck yet`, `<name> is busy`, `You are already in a game or challenge`, `No pending challenge`, `You are not in a game`. Deck build errors propagate as their `GameError` message.

- [ ] **Step 1: Write failing tests** (helper builds a completed 2–3 player non-practice room by drafting through `RoomManager` with `FakeClock`, saving 23 + 17 basic decks):
  - `challenge validation`: practice room, room not complete, self, no saved deck (either side), target already in a game, target with a pending challenge → each throws its message; no state change.
  - `accept starts a game for both`: `respond(accept=true)` → `gameFor(ann)` and `gameFor(bob)` are the same game; roster shows both `inGame`; `onChange` called with the room.
  - `decline notifies the challenger`: `onDeclined(room, annId, 'Bob', 'declined')`; challenge cleared.
  - `challenge expires after 60 s`: advance 60_000 → `onDeclined(..., 'expired')`; a later `respond(accept)` throws `No pending challenge`. (Review Focus.)
  - `stale accept`: (a) Ann challenges Bob, then Ann re-saves a 39-card deck → Bob's accept throws `Deck must have at least 40 cards`, no game is created, the challenge is cleared, and `onDeclined(room, annId, 'Bob', 'declined')` fires so Ann's pending state clears; (b) Ann challenges Bob, the room is deleted (`manager.sweep` after TTL) → `respond` throws `Room not found or expired`. (Review Focus.)
  - `re-saving a deck mid-game does not change the game`: start game, `manager.saveDeck` a different deck for Ann → Ann's game cards unchanged; after both leave, a new challenge uses the new deck. (Review Focus.)
  - `act applies to the caller's seat and refreshes room activity`: Ann draws → her hand 8; advance 29 min then act, advance 2 min → `manager.sweep()` keeps the room.
  - `leaving before the end concedes`: Bob `leaveGame` → game `over.conceded` = Bob's seat; `gameFor(bob)` undefined; `gameFor(ann)` still returns the over game; `onGameEnded([bobId])`. (Review Focus.)
  - `game deleted when both left or 5 min after it ended`: Ann leaves too → game gone, `onGameEnded([annId])`. Separately: concede, advance 5 min → both `onGameEnded` and `gameFor` undefined for both.
  - `sweep drops battles of deleted rooms`.
  - `timer callbacks are error-guarded`: an `onDeclined` that throws during expiry does not throw out of `clock.advance` (spy `console.error`).
- [ ] **Step 2:** run `npm test -w @mtg/server -- battles` → FAIL.
- [ ] **Step 3:** Implement. Index games and challenges by playerId for O(1) busy checks. Game id via `randomUUID()`; game seed from `deps.seed`. Build input from the room: pool = `room.state.picks[seatIndexOf(room, id)]`, deck = `room.decks.get(id)`, basics = `room.set.basics`. Call `deps.onChange(room)` after every successful state change.
- [ ] **Step 4:** run → PASS (twice); full `npm test`; typecheck.
- [ ] **Step 5:** Commit `feat(server): battle challenges and live games`.

### Task 5: Socket events and wiring

**Files:**
- Modify: `shared/src/events.ts`, `server/src/server.ts`, `server/src/index.ts`
- Test: `server/test/server.test.ts` (append `describe('battles')`)

**Interfaces:**
- Consumes: Task 4 (`Battles`, `rosterFor`), Task 3 (`gameViewFor`).
- Produces events (spec table): C→S `battle:challenge {playerId}` → ack, `battle:respond {accept}` → ack, `game:action GameAction` → ack, `game:leave {}` → ack; S→C `battle:roster { players: RosterPlayer[] }`, `battle:challenged IncomingChallenge`, `battle:declined { byName, reason }`, `game:state GameView`, `game:ended {}`.
- `createDraftServer` deps gain `battles?: Battles` (constructed in `index.ts` with the same manager; when absent in tests, create one internally with the manager's clock/scheduler — tests pass it explicitly).
- On every `onChange(room)` for a `complete` non-practice room, each connected human additionally gets `battle:roster`, their `battle:challenged` if pending, and `game:state` if `battles.gameFor(id)` exists (connected flags from `room.players[].socketId`). Wrap per-socket sends in try/catch (existing pattern). `index.ts` calls `battles.sweep()` in the existing 60 s interval after `manager.sweep()`.

- [ ] **Step 1: Write failing integration tests** (reuse existing helpers; draft to completion with `autoDraft`, then `deck:save` 23 + 17):
  - `challenge, accept, play, hidden info`: Ann challenges Bob → Bob receives `battle:challenged` with `fromName 'Ann'`; Bob accepts → both receive `game:state`; Ann `game:action {type:'draw',count:1}` → ack ok, Bob's next state has `opp.handCount === 8` and contains none of Ann's hand gids; Ann moves a hand card to battlefield → Bob sees it in `opp.battlefield`.
  - `rejected actions return a message`: `game:action {type:'draw',count:9}` → `{ ok:false, message:'Invalid action' }`.
  - `concede, leave, rematch`: Ann concedes → Bob's state `over.conceded === Ann's seat`; both `game:leave` → each gets `game:ended`; roster shows `inGame:false`; a second challenge + accept starts a new game id.
  - `reload restores the table and a pending challenge` (Review Focus): mid-game Bob reconnects on a new socket with `room:resume` → receives `draft:complete`, `battle:roster`, `game:state`. Separately, with a pending challenge, the challenged player's resume also receives `battle:challenged`.
  - `malformed battle payloads don't crash`: `battle:challenge null`, `game:action null`, `battle:respond {accept:'yes'}` → ok:false acks; server still answers `sets:list`.
- [ ] **Step 2:** run `npm test -w @mtg/server -- server` → FAIL.
- [ ] **Step 3:** Add events and handlers (read fields with `field()`, map `RoomError`/`GameError` to ack messages, require the socket to be bound via existing `current()`).
- [ ] **Step 4:** server suite 3× PASS; `npm run typecheck -w @mtg/shared -w @mtg/server`.
- [ ] **Step 5:** Commit `feat(server): battle events and per-player game broadcasts`.

### Task 6: Client — room panel and challenges

**Files:**
- Create: `client/src/components/RoomPanel.tsx`, `client/src/lib/battle.ts`
- Modify: `client/src/App.tsx`, `client/src/screens/Deckbuilder.tsx`, `client/src/styles.css`
- Test: `client/test/battle.test.ts`

**Interfaces:**
- Consumes: Task 5 events; `RosterPlayer`, `IncomingChallenge`, `GameView`.
- Produces: `RoomPanel({ roster, incoming, onChallenge(playerId), onRespond(accept), status })`; `Deckbuilder` gains optional `roomPanel?: ReactNode` rendered above the pool; App screen union gains `{ name: 'game'; view: GameView }`; App keeps the last pool in a ref so leaving a game returns to the deckbuilder; `lib/battle.ts`: `canChallenge(me: RosterPlayer | undefined, target: RosterPlayer): boolean` (target not you, target `deckSaved && !inGame && connected`, me `deckSaved && !inGame`), `secondsUntil(expiresAt: number, now: number): number` (ceil, ≥ 0).

- [ ] **Step 1: Write failing tests** for `canChallenge` (each disqualifying flag) and `secondsUntil`.
- [ ] **Step 2:** `npm test -w @mtg/client -- battle` → FAIL.
- [ ] **Step 3:** Implement. App listens to `battle:roster`, `battle:challenged`, `battle:declined` (status line `"<byName> declined"` / `"Challenge to … expired"` — use `byName`), `game:state` (→ game screen), `game:ended` (→ deckbuilder with remembered pool). If a roster arrives showing you `inGame:false` while on the game screen, return to the deckbuilder. Panel only renders for multiplayer rooms (roster received). Banner: "<fromName> challenges you" + Accept / Decline + countdown from `secondsUntil`. Hint "Save your deck to battle" until your roster entry has `deckSaved`. Ack errors from challenge/respond show in the panel status line.
- [ ] **Step 4:** `npm test`, `npm run typecheck`, `npm run build -w @mtg/client` → pass. (Game screen arrives in Task 7; until then render `<p>Game in progress (Task 7)</p>` for the game screen — replaced verbatim in Task 7.)
- [ ] **Step 5:** Commit `feat(client): room panel with challenges`.

### Task 7: Client — game table

**Files:**
- Create: `client/src/screens/Game.tsx`, `client/src/components/game/{Battlefield,HandRow,ZonePile,CardMenu,GraveyardViewer,GameLog}.tsx`
- Modify: `client/src/App.tsx` (replace the Task 6 placeholder), `client/src/lib/battle.ts`, `client/src/styles.css`, `README.md`
- Test: `client/test/battle.test.ts` (append)

**Interfaces:**
- Consumes: `GameView`, `GameCard`, `GameAction`, `Zone`; existing `CardImage`, `CardPreview`/`hoverTargetFrom`.
- Produces: `Game({ view, onLeave })`; `lib/battle.ts` additions: `dropPosition(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): { x: number; y: number }` (percent of rect, clamped 0–100, rounded to 1 decimal); `actionErrorText(res: { ok: boolean; message?: string }): string | null` (null when ok, otherwise the message or `'Action failed'`).

- [ ] **Step 1: Write failing tests:** `dropPosition` centre → 50/50, outside → clamped to 0 / 100; `actionErrorText({ok:true})` → null, `{ok:false,message:'Library is empty'}` → `'Library is empty'`, `{ok:false}` → `'Action failed'` (Review Focus).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement the mirrored table per the spec's Client section:
  - `send(action)` = `socket.timeout(5000).emitWithAck('game:action', action)`; show `actionErrorText` in a status line next to your controls (cleared on the next success).
  - Opponent strip + battlefield (CSS `transform: rotate(180deg)` on the opponent half); your battlefield cards absolutely positioned at `x%`/`y%`, tapped = `rotate(90deg)`; drag (HTML5 DnD, `dataTransfer` carries the gid) onto your battlefield uses `dropPosition`; double-click or `T` while hovering toggles tap.
  - Your strip: life −/+ (`life` ±1), library pile click = `draw 1`, Untap all, Shuffle, Mulligan and Concede each with an in-page confirm (two-click "Are you sure?" button state).
  - Hand row along the bottom; drop targets: battlefield, graveyard pile, hand. Right-click any of your cards → `CardMenu` (To hand / To battlefield / To graveyard / To top of library), closes on outside click or Escape.
  - Graveyard viewer panel for either player (your cards draggable out); collapsible log panel, newest first.
  - Hover preview with the existing `CardPreview`; text fallback for cards with empty `imageUrl`.
  - Game over overlay `"<name> conceded"` + **Back to room** (emits `game:leave`, then `onLeave`).
  - README: a "Battles" section — after a multiplayer draft, save your deck, challenge someone from the room panel; table controls (drag, double-click/T to tap, right-click menu, Draw by clicking your library); players enforce the rules.
- [ ] **Step 4:** `npm test`, `npm run typecheck`, `npm run build` → pass. Manual (if a browser is available): two windows play draw / move / tap / life / concede and a rematch.
- [ ] **Step 5:** Commit `feat(client): battle game table`.

---

## Spec coverage

| Spec requirement | Task |
|---|---|
| Game model, building from saved decks, basics, 40-card minimum, seeded shuffle, first player | 1 |
| Actions table, validation, log text, over handling, reposition rule | 2 |
| Per-seat view, hidden information | 3 |
| Challenges (eligibility, 60 s expiry, accept/decline), one game per player, leave/concede, 5-min cleanup, room activity | 4 |
| Events, roster broadcasts, resume restores game + challenge, error boundaries | 5 |
| Deckbuilder room panel, challenge banner, "save your deck" hint | 6 |
| Mirrored table, controls, DnD, right-click menu, graveyard viewer, log, game over, README | 7 |
