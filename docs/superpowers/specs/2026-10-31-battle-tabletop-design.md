# Battle Tabletop — Design Spec

Date: 2026-10-31
Status: Approved in conversation (pending written-spec review)
Builds on: `2026-10-31-practice-draft-design.md`, `2026-10-31-multiplayer-draft-design.md` (both merged to `master`)

## Context

Sub-project 3 of 3. After a multiplayer draft, players who saved a deck can challenge each other to 1-vs-1 games on a manual virtual tabletop. Players enforce the rules themselves; the server holds the authoritative game state, validates that each player only touches their own cards, keeps hidden information hidden, and logs every action.

## Goals

- Challenge any player in the same completed multiplayer room who has a saved deck; accept / decline.
- Mirrored table: opponent on top (rotated 180°), you at the bottom; hand along the bottom edge.
- Zones per player: library (hidden, ordered), hand (hidden from opponent), battlefield, graveyard.
- Actions: draw, move between zones (with battlefield position), tap/untap, untap all, shuffle, mulligan, life ±, concede.
- Game log visible to both players.
- Reconnect restores the table. Rematch = a new challenge.

## Non-goals (this version)

- Exile zone, counters, tokens, face-down cards, turn/phase tracking, attack/block markers, scry/reveal, sideboarding between games, best-of-3, spectators, rules enforcement.
- Battles from practice drafts.
- Persistence across server restarts (in memory, like rooms).

## Decisions made

| Topic | Decision |
|---|---|
| Feature level | Bare minimum: battlefield, hand, library, graveyard; drag, tap, draw, life (+ shuffle, mulligan, untap all, concede, log) |
| Match flow | Free play: challenge from the room panel; one game at a time per player; rematch by challenging again |
| Layout | Mirrored |
| Architecture | Server-authoritative pure `game/` module, per-player views (same pattern as the draft) |

## Game model (`server/src/game/`)

```ts
type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard';

interface GameCard {
  gid: string;      // unique within the game, e.g. "g12"; assigned before shuffling so ids carry no order information
  card: Card;
  owner: 0 | 1;
  tapped: boolean;
  x: number;        // battlefield position, 0–100 (% of the owner's half), clamped
  y: number;
}

interface PlayerState {
  playerId: string;
  name: string;
  life: number;     // starts at 20; may go negative
  zones: Record<Zone, string[]>; // gids; library[0] is the top
}

interface GameState {
  id: string;
  roomId: string;
  players: [PlayerState, PlayerState];
  cards: Record<string, GameCard>;
  firstPlayer: 0 | 1;          // coin flip from the game rng
  log: { at: number; text: string }[]; // newest last, capped at 100
  over: null | { conceded: 0 | 1 };
  rng: Rng;
}
```

### Building a game

- Inputs per player: `playerId`, `name`, the player's draft pool (`Card[]`), the saved deck (`DeckSavePayload`: main instanceIds + basic counts), and the room's set basics (`SetCards.basics`, one card per basic name).
- Deck cards = pool cards whose `instanceId` is in `main`, plus `basics[c]` copies of the basic for color `c` (Plains W, Island U, Swamp B, Mountain R, Forest G). If the set has no basic for a color, fall back to a card with that basic name, empty image (rendered as a text fallback).
- Reject with `GameError('Deck must have at least 40 cards')` if fewer than 40.
- Assign gids `g1…gN` across both players (player 0 first, in deck order), then shuffle each library with the game rng (seeded), then draw 7 for each player.
- `firstPlayer = rng() < 0.5 ? 0 : 1`; log: `"<name> goes first"`.

### Actions (pure: `applyAction(state, seat, action, now) → state`, throws `GameError` on rejection, never mutates input)

| `type` | payload | Validation | Effect / log |
|---|---|---|---|
| `draw` | `count` integer 1–7 | game not over | move up to `count` from library top to hand; log `"<name> drew N card(s)"` (N actual); if library empty → error `Library is empty` |
| `move` | `gid`, `to: Zone`, `x?`, `y?` | card exists, owner is `seat`, not over, `to` is a Zone | remove from current zone; to `battlefield`: set x/y (clamped 0–100, default 50/50), untapped; to `library`: put on top; to others: append. Tapped reset to false when leaving the battlefield. Log `"<name> moved <card name> to <zone>"`, except a move from the hand to the library, logged as `"<name> put a card from their hand on top of their library"` (hidden information). Library cards can't be targeted: clients never see their gids. |
| `tap` | `gid`, `tapped: boolean` | card yours and on battlefield | set tapped; log `"<name> tapped <card>"` / `"untapped"` |
| `untapAll` | — | — | untap all your battlefield cards; log `"<name> untapped all"` |
| `shuffle` | — | — | shuffle your library (game rng); log `"<name> shuffled their library"` |
| `mulligan` | — | — | hand → library, shuffle, draw 7; log `"<name> took a mulligan"` |
| `life` | `delta` integer −20…20, ≠ 0 | — | life += delta; log `"<name>'s life: <old> → <new>"` |
| `concede` | — | not over | `over = { conceded: seat }`; log `"<name> conceded"` |

Once `over` is set, every action is rejected with `Game is over` (leaving uses `game:leave`, not an action). A `move` from the battlefield to the battlefield is a reposition: it updates x/y, keeps `tapped`, and adds no log line.

### Views (`gameViewFor(state, seat, connected: [boolean, boolean])`)

```ts
interface GameView {
  gameId: string;
  you: 0 | 1;
  firstPlayer: 0 | 1;
  over: null | { conceded: 0 | 1 };
  log: { at: number; text: string }[];
  me:  { name; life; hand: GameCard[]; battlefield: GameCard[]; graveyard: GameCard[]; libraryCount: number };
  opp: { name; life; connected: boolean; handCount: number; battlefield: GameCard[]; graveyard: GameCard[]; libraryCount: number };
}
```
Never includes the opponent's hand cards, or any library card (either player).

## Challenges & game lifecycle (`server/src/rooms/battles.ts`, used by `RoomManager`)

- A room in phase `complete`, non-practice, holds `games: Map<gameId, GameState>` and `challenges: Map<toPlayerId, { from, expiresAt, timer }>`.
- `challenge(roomId, fromPlayerId, toPlayerId)`: both seated humans in that room; `from ≠ to`; both have saved decks; neither is in a live (not-left) game; no pending challenge to or from either → else `RoomError` with a clear message. Expires after 60 s (scheduler) → challenger notified `battle:declined { reason: 'expired' }`.
- `respond(roomId, toPlayerId, accept)`: decline → challenger gets `battle:declined { reason: 'declined' }`; accept → build the game (deck errors → both get the message, no game) → both players' `inGame` set.
- `gameAction(roomId, playerId, action)` → `applyAction`; touches room activity.
- `leaveGame(roomId, playerId)`: allowed when over, or concedes first if not over; the player leaves the game. When both have left, or 5 minutes after `over`, the game is deleted.
- Disconnect: nothing automatic; opponent sees `connected: false`.
- Room cleanup: the 30-minute idle TTL counts any battle action as activity.
- All timer callbacks and broadcasts wrapped in error boundaries (as in sub-project 2).

## Events

| Dir | Event | Payload / ack |
|---|---|---|
| C→S | `battle:challenge` | `{ playerId }` → ack |
| C→S | `battle:respond` | `{ accept: boolean }` → ack |
| C→S | `game:action` | `GameAction` → ack |
| C→S | `game:leave` | `{}` → ack |
| S→C | `battle:roster` | `{ players: { playerId, name, deckSaved, inGame, connected, isYou }[] }` |
| S→C | `battle:challenged` | `{ fromPlayerId, fromName, expiresAt }` |
| S→C | `battle:declined` | `{ byName, reason: 'declined' \| 'expired' }` |
| S→C | `game:state` | `GameView` |
| S→C | `game:ended` | `{}` (you left; back to the room panel) |

Roster is sent to every connected human in a completed multiplayer room on any roster change (deck saved, game start/leave, connect/disconnect). On resume in a completed room the server sends `draft:complete`, `battle:roster`, any pending `battle:challenged`, and `game:state` if in a game.

## Client

- **Deckbuilder room panel** (multiplayer rooms only): roster list with status (deck saved ✓, in game, offline); **Challenge** button for eligible players; hint "Save your deck to battle" until saved. Incoming challenge banner with Accept / Decline and a 60 s countdown.
- **Game screen** (`screens/Game.tsx`), mirrored:
  - Top: opponent name, life, hand count, library pile (count), graveyard pile (click to view), offline badge.
  - Opponent battlefield rotated 180°.
  - Your battlefield: cards at x/y; drag to reposition; double-click or `T` to tap/untap; tapped = rotated 90°.
  - Your strip: life −/+; library pile (click = draw 1); Untap all; Shuffle; Mulligan (in-page confirm); Concede (in-page confirm).
  - Hand along the bottom; drag to battlefield or graveyard pile; right-click menu: To hand / To battlefield / To graveyard / To top of library.
  - Graveyard viewer panel (either player; drag out of your own).
  - Log panel (collapsible, newest first).
  - Existing hover preview.
  - Game over overlay: "<name> conceded" + **Back to room**.
- Drag and drop: HTML5 DnD with drop zones; battlefield drop → % coordinates of your half.
- No `alert`/`confirm`/`prompt` browser dialogs.

## Testing

- Unit `game/`: build (count, basics, <40 rejection, shuffled + seeded, 7 in hand, first player); each action's effect and rejections (not yours, wrong zone, empty library, game over); mulligan; log text; repositioning silent; views never contain opponent hand or any library card ids (JSON search).
- Unit battles: challenge validation (no deck, busy, self, pending, practice room, not complete); expiry via fake clock; accept/decline; leave/cleanup (both left, 5 min after over); room activity refresh.
- Integration (Socket.IO): two clients draft, save decks, challenge, accept, play draw/move/tap/life, verify opponent sees battlefield + counts but not hand; concede, leave, rematch; reconnect mid-game restores `game:state`.
- Manual: two browser windows.
