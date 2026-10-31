# Practice Draft — Design Spec

Date: 2026-10-31
Status: Approved (pending written-spec review)

## Context & roadmap

The overall product: friends draft MTG sets together online, build decks, then battle each other on a virtual tabletop (players enforce rules manually, like a real table).

It is decomposed into sub-projects, each with its own spec → plan → implementation:

1. **Practice draft (this spec)** — one human + 7 bots, Scryfall set boosters, deckbuilder. Practice decks are not used for battles.
2. **Multiplayer draft** — join codes, multiple human seats, bots fill empty seats, pick timer.
3. **Battle tabletop** — manual virtual tabletop; free-play challenges between players in a room using their drafted decks.

This spec covers only sub-project 1, but the architecture must let 2 and 3 be added without rewriting the draft engine.

## Goals

- Pick any draftable Scryfall set and draft it against 7 bots.
- Standard draft structure: 3 packs × 15 cards, pass left / right / left, 45 picks.
- Build a 40+ card deck from the pool plus unlimited basics; export a text decklist.

## Non-goals (this sub-project)

- Multiple humans, room codes, pick timers.
- Battles of any kind.
- Accounts, databases, persistence beyond process memory and the card cache.
- Exact per-set real-world collation (foils, special slots, showcase variants).
- Mobile-optimized layout (must be usable, not polished).

## Architecture

Monorepo with npm workspaces, TypeScript everywhere.

```
MTG/
├─ shared/     types used by both sides (Card, Pack, SeatView, socket event names/payloads)
├─ server/     Node + TypeScript + Socket.IO
│  ├─ cards/       Scryfall client + on-disk cache per set
│  ├─ packs/       booster generator
│  ├─ draft/       pure draft engine
│  ├─ bots/        bot picker
│  └─ rooms/       room lifecycle; wires sockets ↔ engine ↔ bots
└─ client/     React + Vite
   ├─ Home
   ├─ Draft
   └─ Deckbuilder
```

All drafts — even solo — run on the server, so multiplayer later is a change to `rooms/` only.

### Module boundaries

- **`cards/`** — `getSetCards(setCode): Promise<SetCards>` where `SetCards = { cards: Card[]; basics: Card[] }`. `listDraftableSets(): Promise<SetInfo[]>`. Only module that talks to Scryfall.
- **`packs/`** — `generatePack(setCards, rng): Card[]` (pure). Layout: 1 rare-or-mythic slot (mythic with probability 1/8 when the set has mythics, otherwise rare), 3 uncommons, 10 commons, 1 basic land = 15 cards. No duplicate card names within a pack. If a rarity pool is too small to fill its slots without duplicates, fill remaining slots from the next lower rarity (rare → uncommon → common).
- **`draft/`** — pure state machine, no I/O, no randomness.
  - `createDraft(seatCount, packsPerSeat: Card[][][]): DraftState`
  - `applyPick(state, seatIndex, cardInstanceId): DraftState` — throws `InvalidPickError` if the card isn't in that seat's current pack or the seat already picked this turn.
  - `advanceIfReady(state): DraftState` — when every seat has picked, pass packs (left = seat i → i+1 for packs 1 and 3, right = i → i−1 for pack 2, modulo seat count); when packs are empty, open the next round; after round 3 set `complete`.
  - `seatView(state, seatIndex): SeatView` — `{ packNumber (1–3), pickNumber (1–15), currentPack: Card[] | null, picks: Card[], complete }`.
  - Each card in a draft gets a unique `instanceId` (duplicates across packs are possible) — picks reference `instanceId`, not Scryfall id.
- **`bots/`** — `botPick(pack: Card[], picks: Card[], rng): instanceId` (pure).
- **`rooms/`** — owns in-memory `Map<roomId, Room>`; on human pick: `applyPick` → for each bot seat `botPick` + `applyPick` → `advanceIfReady` → emit `draft:state` to the human socket. Only place that combines the other modules.

### Card model (shared)

```ts
type Rarity = 'common' | 'uncommon' | 'rare' | 'mythic';
interface Card {
  instanceId: string;      // unique within a draft ('' in set cache)
  scryfallId: string;
  name: string;
  manaCost: string;        // e.g. "{2}{W}{W}"; "" if none
  manaValue: number;
  colors: string[];        // subset of W U B R G; [] = colorless
  typeLine: string;
  oracleText: string;
  rarity: Rarity;
  imageUrl: string;        // Scryfall "normal" image; front face for double-faced cards
}
```

## Card data (Scryfall)

- Set list: `GET https://api.scryfall.com/sets`, keep `set_type` ∈ {`expansion`, `core`, `draft_innovation`}, not digital-only, released on or before today, sorted newest first. Cached in memory for 24h.
- Set cards: `GET https://api.scryfall.com/cards/search?q=set:<code> is:booster&unique=cards`, following `has_more`/`next_page`. Basics: `q=set:<code> type:basic unique:cards` (fallback: basics from the most recent core set if the set has none).
- Respect Scryfall etiquette: `User-Agent` and `Accept` headers, ≥100 ms between requests.
- Cache: `server/.cache/<code>.json`; reused indefinitely (delete to refresh).
- Double-faced cards: use `card_faces[0]` for image, name/type taken from the top-level card fields.
- Errors: network failure or unknown/empty set → `practice:error { message }`; client shows it on Home with Retry.

## Draft flow & socket events

| Direction | Event | Payload |
|---|---|---|
| C→S | `sets:list` (ack) | → `SetInfo[]` (`{ code, name, releasedAt, iconSvgUri }`) |
| C→S | `practice:start` | `{ setCode }` |
| S→C | `draft:state` | `SeatView` |
| C→S | `draft:pick` | `{ instanceId }` |
| S→C | `draft:complete` | `{ pool: Card[] }` |
| C→S | `deck:save` | `{ main: string[] /*instanceIds*/, basics: Record<'W'\|'U'\|'B'\|'R'\|'G', number> }` |
| S→C | `practice:error` | `{ message }` |
| C→S | `room:resume` | `{ roomId }` |

1. `practice:start` → server loads set cards, creates 8 seats (seat 0 human, 1–7 bots), generates 24 packs, emits `draft:state` with the room id stored client-side (sessionStorage).
2. `draft:pick` → rooms flow above. Invalid picks are ignored (state re-emitted, no change).
3. After pick 45 → `draft:complete`, client routes to Deckbuilder.
4. Reconnect: client sends `room:resume { roomId }`; server re-emits current state (or `draft:complete` with pool). Rooms are discarded 30 minutes after their last activity.

## Bots

Score per card:
- Rarity base: mythic 4, rare 3.5, uncommon 2, common 1.
- +0.5 if creature; +0.75 if oracle text matches removal pattern (`destroy target`, `exile target`, `deals \d+ damage to (any target|target creature)`, `fights`); −1 if land without "add" of two different colors (i.e. non-dual non-basic utility land); basic lands −3.
- Picks 1–5: score + jitter (uniform ±0.3).
- Pick 6+: compute color weights = sum of rarity base of picked cards per color; top two colors are "committed". Multiply score by 1.5 if card is colorless or all its colors are committed, 0.5 otherwise. Then add jitter.
- Highest final score wins. RNG is seedable (`mulberry32`) for deterministic tests.

## Client UI

- **Home**: set dropdown (newest first, with set icon), "Start practice draft" button, error banner with Retry.
- **Draft**: header "Pack N · Pick M"; current pack as a responsive grid of card images; click to pick (disabled until next state arrives); hover shows enlarged preview; side panel lists picks grouped by color (W, U, B, R, G, multicolor, colorless) with counts.
- **Deckbuilder**: Pool and Main Deck areas (click card to move); basic land +/- counters for each color; total count with warning below 40; mana curve bar chart (0–6+ for nonland cards); "Export" copies decklist text, "Download" saves `.txt`; "Save" sends `deck:save`. Decklist format: `<count> <name>` lines, main deck, blank line, `Sideboard`, then remaining pool.
- Styling: dark tabletop theme, desktop-first.

## Testing

- Vitest unit tests:
  - `packs/`: 15 cards, slot rarities correct, no duplicate names, fallback when a rarity pool is small, mythic rate roughly 1/8 over many seeds.
  - `draft/`: pass direction for each pack, 45 picks per seat, round transitions, `complete` after round 3, invalid picks throw, seat views never expose other seats' packs.
  - `bots/`: always returns an id in the pack; with a committed-color pool, prefers on-color over a slightly higher-rarity off-color card; deterministic with a fixed seed.
  - `cards/`: maps a recorded Scryfall fixture (checked into `server/test/fixtures/`) to `Card[]` correctly, including a double-faced card. No live network calls in tests.
- One integration test: start server in-process with the fixture set, connect a Socket.IO client, run 45 picks, receive `draft:complete` with 45 cards.
- UI verified manually in the browser.
