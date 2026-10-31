# Practice Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser app where one human drafts a Scryfall set against 7 bots (3×15-card packs) and builds a 40+ card deck.

**Architecture:** npm-workspaces monorepo (`shared`, `server`, `client`). The server runs every draft: pure modules (`packs`, `draft`, `bots`) are combined only by `rooms`, exposed over Socket.IO. The React client renders the human seat's view and never sees other seats' packs.

**Tech Stack:** TypeScript 5, Node 23 (global `fetch`), Socket.IO 4, React 18 + Vite 5, Vitest 2, tsx, concurrently.

**Spec:** `docs/superpowers/specs/2026-10-31-practice-draft-design.md`

## Global Constraints

- TypeScript `strict`, ESM (`"type": "module"`), `moduleResolution: "Bundler"`, no build step for `shared` (consumed as TS source).
- 8 seats: seat 0 human, seats 1–7 bots. 3 packs × 15 cards. Pass left (i → i+1) in packs 1 and 3, right (i → i−1) in pack 2.
- Pack layout: 1 rare/mythic (mythic with probability 1/8 if set has mythics), 3 uncommons, 10 commons, 1 basic. No duplicate names in a pack; short pools fall back rare → uncommon → common.
- Scryfall: `User-Agent: MTGDraftSim/0.1`, `Accept: application/json`, ≥100 ms between requests; cache at `server/.cache/<code>.json`.
- Rooms are discarded 30 minutes after last activity.
- Tests never hit the network.
- Server port 3001; Vite dev server proxies `/socket.io` to it.

## File Structure

```
package.json                 root workspaces + scripts
tsconfig.base.json           shared compiler options
.gitignore
shared/src/types.ts          Card, SetCards, SetInfo, SeatView, DeckSavePayload, Color, Rarity
shared/src/events.ts         typed Socket.IO event maps
shared/src/index.ts          re-exports
server/src/rng.ts            mulberry32 seedable RNG
server/src/cards/scryfall.ts Scryfall response types + mapScryfallCard
server/src/cards/client.ts   HTTP client: paging, rate limit, errors
server/src/cards/source.ts   getSetCards (cache, basics fallback), listDraftableSets
server/src/packs/generatePack.ts
server/src/draft/engine.ts   createDraft, applyPick, advanceIfReady, seatView, InvalidPickError
server/src/bots/botPick.ts   baseScore, committedColors, botPick
server/src/rooms/RoomManager.ts
server/src/server.ts         createDraftServer (Socket.IO wiring)
server/src/index.ts          real entrypoint
server/test/helpers.ts       makeCard, makeSet
server/test/fixtures/scryfall.ts  Scryfall-shaped sample objects
server/test/*.test.ts
client/index.html, vite.config.ts
client/src/main.tsx, App.tsx, socket.ts, styles.css
client/src/lib/cards.ts      groupByColor, manaCurve, buildDecklist
client/src/components/CardImage.tsx
client/src/screens/Home.tsx, Draft.tsx, Deckbuilder.tsx
client/test/cards.test.ts
```

---

### Task 1: Monorepo scaffold, shared types, seedable RNG

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/src/types.ts`, `shared/src/events.ts`, `shared/src/index.ts`
- Create: `server/package.json`, `server/tsconfig.json`, `server/src/rng.ts`
- Test: `server/test/rng.test.ts`

**Interfaces:**
- Produces: all types in `@mtg/shared` (below); `Rng = () => number`, `mulberry32(seed: number): Rng`.

- [ ] **Step 1: Root files**

`package.json`:
```json
{
  "name": "mtg-draft",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "server", "client"],
  "scripts": {
    "dev": "concurrently -n server,client \"npm run dev -w @mtg/server\" \"npm run dev -w @mtg/client\"",
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
server/.cache/
```

- [ ] **Step 2: Shared package**

`shared/package.json`:
```json
{
  "name": "@mtg/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "typecheck": "tsc -p ." }
}
```

`shared/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "include": ["src"] }
```

`shared/src/types.ts`:
```ts
export type Rarity = 'common' | 'uncommon' | 'rare' | 'mythic';
export type Color = 'W' | 'U' | 'B' | 'R' | 'G';
export const COLORS: Color[] = ['W', 'U', 'B', 'R', 'G'];

export interface Card {
  instanceId: string; // unique within a draft; '' in the set cache
  scryfallId: string;
  name: string;
  manaCost: string;
  manaValue: number;
  colors: Color[];
  typeLine: string;
  oracleText: string;
  rarity: Rarity;
  imageUrl: string;
}

export interface SetCards {
  cards: Card[]; // booster cards, basics excluded
  basics: Card[]; // one per basic land name
}

export interface SetInfo {
  code: string;
  name: string;
  releasedAt: string;
  iconSvgUri: string;
}

export interface SeatView {
  packNumber: number; // 1–3
  pickNumber: number; // 1–15
  currentPack: Card[] | null; // null when waiting or complete
  picks: Card[];
  complete: boolean;
}

export interface DeckSavePayload {
  main: string[]; // instanceIds from the pool
  basics: Record<Color, number>;
}
```

`shared/src/events.ts`:
```ts
import type { Card, DeckSavePayload, SeatView, SetInfo } from './types';

export type SetsListResult = { ok: true; sets: SetInfo[] } | { ok: false; message: string };

export interface ClientToServerEvents {
  'sets:list': (ack: (res: SetsListResult) => void) => void;
  'practice:start': (p: { setCode: string }) => void;
  'draft:pick': (p: { instanceId: string }) => void;
  'deck:save': (p: DeckSavePayload, ack: (res: { ok: boolean }) => void) => void;
  'room:resume': (p: { roomId: string }) => void;
}

export interface ServerToClientEvents {
  'draft:state': (p: { roomId: string; view: SeatView }) => void;
  'draft:complete': (p: { roomId: string; pool: Card[] }) => void;
  'practice:error': (p: { message: string }) => void;
}
```

`shared/src/index.ts`:
```ts
export * from './types';
export * from './events';
```

- [ ] **Step 3: Server package**

`server/package.json`:
```json
{
  "name": "@mtg/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc -p ."
  },
  "dependencies": { "@mtg/shared": "*" }
}
```

`server/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test"]
}
```

Install:
```bash
npm install -D typescript@5.6.3 concurrently@9.1.0
npm install -w @mtg/server socket.io@4.8.1
npm install -w @mtg/server -D tsx@4.19.2 vitest@2.1.8 @types/node@22.10.1 socket.io-client@4.8.1
```

- [ ] **Step 4: Write the failing RNG test**

`server/test/rng.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/rng';

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, a);
    const seqB = Array.from({ length: 5 }, b);
    expect(seqA).toEqual(seqB);
  });

  it('returns values in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs between seeds', () => {
    expect(mulberry32(1)()).not.toEqual(mulberry32(2)());
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `npm test -w @mtg/server`
Expected: FAIL — cannot resolve `../src/rng`.

- [ ] **Step 6: Implement**

`server/src/rng.ts`:
```ts
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 7: Verify**

Run: `npm test -w @mtg/server` → PASS (3 tests). Run: `npm run typecheck` → no errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo, shared types, seedable rng"
```

### Task 2: Scryfall card data (mapping, client, cached source)

**Files:**
- Create: `server/src/cards/scryfall.ts`, `server/src/cards/client.ts`, `server/src/cards/source.ts`
- Create: `server/test/fixtures/scryfall.ts`
- Test: `server/test/cards.test.ts`

**Interfaces:**
- Consumes: `Card`, `Color`, `Rarity`, `SetCards`, `SetInfo`, `COLORS` from `@mtg/shared`.
- Produces:
  - `mapScryfallCard(c: ScryfallCard): Card`
  - `createScryfallClient(opts?: { fetchFn?: FetchFn; delayMs?: number }): ScryfallClient` where `ScryfallClient = { searchAll(q: string): Promise<ScryfallCard[]>; listSets(): Promise<ScryfallSet[]> }`
  - `class ScryfallError extends Error`
  - `interface CardSource { getSetCards(code: string): Promise<SetCards>; listDraftableSets(): Promise<SetInfo[]> }`
  - `createCardSource(opts: { client: ScryfallClient; cacheDir: string; now?: () => number; today?: () => string }): CardSource`

- [ ] **Step 1: Fixtures (Scryfall-shaped sample objects)**

`server/test/fixtures/scryfall.ts`:
```ts
import type { ScryfallCard, ScryfallSet } from '../../src/cards/scryfall';

export const bolt: ScryfallCard = {
  id: 'id-bolt', name: 'Lightning Bolt', mana_cost: '{R}', cmc: 1, colors: ['R'],
  type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.',
  rarity: 'common', image_uris: { normal: 'https://img/bolt.jpg' },
};

export const dfc: ScryfallCard = {
  id: 'id-dfc', name: 'Front Face // Back Face', cmc: 2,
  type_line: 'Creature — Human // Creature — Werewolf', rarity: 'uncommon',
  card_faces: [
    { name: 'Front Face', mana_cost: '{1}{G}', colors: ['G'], oracle_text: 'Front text.', image_uris: { normal: 'https://img/front.jpg' } },
    { name: 'Back Face', mana_cost: '', colors: ['G'], oracle_text: 'Back text.', image_uris: { normal: 'https://img/back.jpg' } },
  ],
};

export const specialRarity: ScryfallCard = {
  id: 'id-special', name: 'Odd Card', mana_cost: '{3}', cmc: 3, colors: [],
  type_line: 'Artifact', oracle_text: '', rarity: 'special', image_uris: { normal: 'https://img/odd.jpg' },
};

export function basic(name: string): ScryfallCard {
  return {
    id: `id-${name}`, name, cmc: 0, colors: [], type_line: `Basic Land — ${name}`,
    oracle_text: '', rarity: 'common', image_uris: { normal: `https://img/${name}.jpg` },
  };
}

export const sets: ScryfallSet[] = [
  { code: 'old', name: 'Old Set', set_type: 'expansion', released_at: '2020-01-01', digital: false, icon_svg_uri: 'i/old.svg' },
  { code: 'new', name: 'New Set', set_type: 'expansion', released_at: '2026-09-01', digital: false, icon_svg_uri: 'i/new.svg' },
  { code: 'cor', name: 'Core Set', set_type: 'core', released_at: '2025-06-01', digital: false, icon_svg_uri: 'i/cor.svg' },
  { code: 'fut', name: 'Future Set', set_type: 'expansion', released_at: '2027-02-01', digital: false, icon_svg_uri: 'i/fut.svg' },
  { code: 'dig', name: 'Digital Set', set_type: 'expansion', released_at: '2024-01-01', digital: true, icon_svg_uri: 'i/dig.svg' },
  { code: 'pro', name: 'Promo Set', set_type: 'promo', released_at: '2024-01-01', digital: false, icon_svg_uri: 'i/pro.svg' },
];
```

- [ ] **Step 2: Write the failing tests**

`server/test/cards.test.ts`:
```ts
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { mapScryfallCard, type ScryfallCard } from '../src/cards/scryfall';
import { createScryfallClient, ScryfallError } from '../src/cards/client';
import { createCardSource } from '../src/cards/source';
import { basic, bolt, dfc, sets, specialRarity } from './fixtures/scryfall';

describe('mapScryfallCard', () => {
  it('maps a single-faced card', () => {
    expect(mapScryfallCard(bolt)).toEqual({
      instanceId: '', scryfallId: 'id-bolt', name: 'Lightning Bolt', manaCost: '{R}', manaValue: 1,
      colors: ['R'], typeLine: 'Instant', oracleText: 'Lightning Bolt deals 3 damage to any target.',
      rarity: 'common', imageUrl: 'https://img/bolt.jpg',
    });
  });

  it('uses the front face of a double-faced card', () => {
    const c = mapScryfallCard(dfc);
    expect(c.name).toBe('Front Face // Back Face');
    expect(c.manaCost).toBe('{1}{G}');
    expect(c.colors).toEqual(['G']);
    expect(c.imageUrl).toBe('https://img/front.jpg');
    expect(c.oracleText).toBe('Front text.\n//\nBack text.');
  });

  it('maps unknown rarities to rare', () => {
    expect(mapScryfallCard(specialRarity).rarity).toBe('rare');
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('createScryfallClient', () => {
  it('follows next_page and sends required headers', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [bolt], has_more: true, next_page: 'https://api.scryfall.com/page2' }))
      .mockResolvedValueOnce(jsonResponse({ data: [dfc], has_more: false }));
    const client = createScryfallClient({ fetchFn, delayMs: 0 });
    const cards = await client.searchAll('set:abc is:booster');
    expect(cards.map((c) => c.id)).toEqual(['id-bolt', 'id-dfc']);
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.scryfall.com/cards/search?q=set%3Aabc%20is%3Abooster&unique=cards');
    expect(fetchFn.mock.calls[1][0]).toBe('https://api.scryfall.com/page2');
    expect(fetchFn.mock.calls[0][1].headers).toEqual({ 'User-Agent': 'MTGDraftSim/0.1', Accept: 'application/json' });
  });

  it('returns [] on 404 (no search results)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ object: 'error' }, 404));
    expect(await createScryfallClient({ fetchFn, delayMs: 0 }).searchAll('set:zzz')).toEqual([]);
  });

  it('throws ScryfallError on other failures', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    await expect(createScryfallClient({ fetchFn, delayMs: 0 }).searchAll('set:abc')).rejects.toBeInstanceOf(ScryfallError);
  });
});

function fakeClient(byQuery: Record<string, ScryfallCard[]>) {
  return {
    searchAll: vi.fn(async (q: string) => byQuery[q] ?? []),
    listSets: vi.fn(async () => sets),
  };
}

const allBasics = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].map(basic);
const tmp = () => mkdtempSync(join(tmpdir(), 'mtg-cache-'));

describe('createCardSource.getSetCards', () => {
  it('splits booster cards from basics and caches to disk', async () => {
    const cacheDir = tmp();
    const client = fakeClient({
      'set:abc is:booster': [bolt, dfc, basic('Plains')],
      'set:abc type:basic': [...allBasics, basic('Snow-Covered Island')],
    });
    const result = await createCardSource({ client, cacheDir }).getSetCards('ABC');
    expect(result.cards.map((c) => c.name)).toEqual(['Lightning Bolt', 'Front Face // Back Face']);
    expect(result.basics.map((c) => c.name)).toEqual(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']);
    expect(existsSync(join(cacheDir, 'abc.json'))).toBe(true);

    await createCardSource({ client, cacheDir }).getSetCards('abc');
    expect(client.searchAll).toHaveBeenCalledTimes(2); // second source served from disk
  });

  it('falls back to fdn basics when the set has none', async () => {
    const client = fakeClient({ 'set:abc is:booster': [bolt], 'set:fdn type:basic': allBasics });
    const result = await createCardSource({ client, cacheDir: tmp() }).getSetCards('abc');
    expect(result.basics).toHaveLength(5);
  });

  it('throws for a set with no booster cards', async () => {
    const source = createCardSource({ client: fakeClient({}), cacheDir: tmp() });
    await expect(source.getSetCards('zzz')).rejects.toThrow('No booster cards found for set "zzz"');
  });

  it('rejects malformed set codes without calling Scryfall', async () => {
    const client = fakeClient({});
    await expect(createCardSource({ client, cacheDir: tmp() }).getSetCards('../etc')).rejects.toBeInstanceOf(ScryfallError);
    expect(client.searchAll).not.toHaveBeenCalled();
  });
});

describe('createCardSource.listDraftableSets', () => {
  it('keeps released paper expansion/core sets, newest first, cached 24h', async () => {
    const client = fakeClient({});
    let now = 0;
    const source = createCardSource({ client, cacheDir: tmp(), now: () => now, today: () => '2026-10-31' });
    const result = await source.listDraftableSets();
    expect(result.map((s) => s.code)).toEqual(['new', 'cor', 'old']);
    expect(result[0]).toEqual({ code: 'new', name: 'New Set', releasedAt: '2026-09-01', iconSvgUri: 'i/new.svg' });
    now = 23 * 3600 * 1000;
    await source.listDraftableSets();
    expect(client.listSets).toHaveBeenCalledTimes(1);
    now = 25 * 3600 * 1000;
    await source.listDraftableSets();
    expect(client.listSets).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w @mtg/server`
Expected: FAIL — cannot resolve `../src/cards/scryfall`.

- [ ] **Step 4: Implement mapping**

`server/src/cards/scryfall.ts`:
```ts
import { COLORS, type Card, type Color, type Rarity } from '@mtg/shared';

export interface ScryfallFace {
  name: string;
  mana_cost?: string;
  colors?: string[];
  oracle_text?: string;
  image_uris?: { normal: string };
}

export interface ScryfallCard {
  id: string;
  name: string;
  mana_cost?: string;
  cmc: number;
  colors?: string[];
  type_line: string;
  oracle_text?: string;
  rarity: string;
  image_uris?: { normal: string };
  card_faces?: ScryfallFace[];
}

export interface ScryfallList<T> {
  data: T[];
  has_more: boolean;
  next_page?: string;
}

export interface ScryfallSet {
  code: string;
  name: string;
  set_type: string;
  released_at?: string;
  digital: boolean;
  icon_svg_uri: string;
}

const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'mythic'];

function toColors(raw: string[] | undefined): Color[] {
  return (raw ?? []).filter((c): c is Color => (COLORS as string[]).includes(c));
}

export function mapScryfallCard(c: ScryfallCard): Card {
  const face = c.card_faces?.[0];
  const oracleText =
    c.oracle_text ?? (c.card_faces ? c.card_faces.map((f) => f.oracle_text ?? '').join('\n//\n') : '');
  return {
    instanceId: '',
    scryfallId: c.id,
    name: c.name,
    manaCost: c.mana_cost ?? face?.mana_cost ?? '',
    manaValue: c.cmc,
    colors: toColors(c.colors ?? face?.colors),
    typeLine: c.type_line,
    oracleText,
    rarity: (RARITIES as string[]).includes(c.rarity) ? (c.rarity as Rarity) : 'rare',
    imageUrl: c.image_uris?.normal ?? face?.image_uris?.normal ?? '',
  };
}
```

- [ ] **Step 5: Implement HTTP client**

`server/src/cards/client.ts`:
```ts
import type { ScryfallCard, ScryfallList, ScryfallSet } from './scryfall';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface ScryfallClient {
  searchAll(q: string): Promise<ScryfallCard[]>;
  listSets(): Promise<ScryfallSet[]>;
}

export class ScryfallError extends Error {}

const API = 'https://api.scryfall.com';
const HEADERS = { 'User-Agent': 'MTGDraftSim/0.1', Accept: 'application/json' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createScryfallClient(opts: { fetchFn?: FetchFn; delayMs?: number } = {}): ScryfallClient {
  const fetchFn = opts.fetchFn ?? fetch;
  const delayMs = opts.delayMs ?? 100;
  let last = 0;

  async function getJson<T>(url: string): Promise<T | null> {
    const wait = last + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    let res: Response;
    try {
      res = await fetchFn(url, { headers: HEADERS });
    } catch {
      throw new ScryfallError('Could not reach Scryfall. Check your connection and retry.');
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new ScryfallError(`Scryfall request failed (${res.status})`);
    return (await res.json()) as T;
  }

  return {
    async searchAll(q) {
      const out: ScryfallCard[] = [];
      let url: string | undefined = `${API}/cards/search?q=${encodeURIComponent(q)}&unique=cards`;
      while (url) {
        const page: ScryfallList<ScryfallCard> | null = await getJson(url);
        if (!page) break;
        out.push(...page.data);
        url = page.has_more ? page.next_page : undefined;
      }
      return out;
    },
    async listSets() {
      const res = await getJson<ScryfallList<ScryfallSet>>(`${API}/sets`);
      return res?.data ?? [];
    },
  };
}
```

- [ ] **Step 6: Implement cached source**

`server/src/cards/source.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SetCards, SetInfo } from '@mtg/shared';
import { ScryfallError, type ScryfallClient } from './client';
import { mapScryfallCard, type ScryfallCard } from './scryfall';

export interface CardSource {
  getSetCards(code: string): Promise<SetCards>;
  listDraftableSets(): Promise<SetInfo[]>;
}

export const FALLBACK_BASICS_SET = 'fdn'; // Foundations: most recent core-style set
const BASIC_NAMES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
const DRAFTABLE_TYPES = ['expansion', 'core', 'draft_innovation'];
const DAY_MS = 24 * 3600 * 1000;

function pickBasics(raw: ScryfallCard[]) {
  return BASIC_NAMES.map((name) => raw.find((c) => c.name === name))
    .filter((c): c is ScryfallCard => !!c)
    .map(mapScryfallCard);
}

export function createCardSource(opts: {
  client: ScryfallClient;
  cacheDir: string;
  now?: () => number;
  today?: () => string;
}): CardSource {
  const { client, cacheDir } = opts;
  const now = opts.now ?? Date.now;
  const today = opts.today ?? (() => new Date().toISOString().slice(0, 10));
  let setsCache: { at: number; sets: SetInfo[] } | null = null;

  return {
    async getSetCards(rawCode) {
      const code = rawCode.toLowerCase();
      if (!/^[a-z0-9]{2,6}$/.test(code)) throw new ScryfallError(`Unknown set "${rawCode}"`);
      const file = join(cacheDir, `${code}.json`);
      if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as SetCards;

      const booster = await client.searchAll(`set:${code} is:booster`);
      const cards = booster.filter((c) => !c.type_line.includes('Basic Land')).map(mapScryfallCard);
      if (cards.length === 0) throw new ScryfallError(`No booster cards found for set "${code}"`);
      let basics = pickBasics(await client.searchAll(`set:${code} type:basic`));
      if (basics.length === 0) basics = pickBasics(await client.searchAll(`set:${FALLBACK_BASICS_SET} type:basic`));

      const result: SetCards = { cards, basics };
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(file, JSON.stringify(result));
      return result;
    },

    async listDraftableSets() {
      if (setsCache && now() - setsCache.at < DAY_MS) return setsCache.sets;
      const t = today();
      const sets = (await client.listSets())
        .filter((s) => DRAFTABLE_TYPES.includes(s.set_type) && !s.digital && !!s.released_at && s.released_at <= t)
        .sort((a, b) => (b.released_at! > a.released_at! ? 1 : -1))
        .map((s) => ({ code: s.code, name: s.name, releasedAt: s.released_at!, iconSvgUri: s.icon_svg_uri }));
      setsCache = { at: now(), sets };
      return sets;
    },
  };
}
```

- [ ] **Step 7: Verify**

Run: `npm test -w @mtg/server` → PASS. Run: `npm run typecheck` → no errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(server): scryfall card data with disk cache"
```

### Task 3: Test helpers + booster pack generator

**Files:**
- Create: `server/test/helpers.ts`, `server/src/packs/generatePack.ts`
- Test: `server/test/packs.test.ts`

**Interfaces:**
- Consumes: `Rng` (Task 1), `Card`, `SetCards`, `COLORS` from `@mtg/shared`.
- Produces:
  - `generatePack(set: SetCards, rng: Rng): Card[]` — 15 cards in slot order `[rare/mythic, unc×3, common×10, basic]`, each a fresh object copy with `instanceId: ''`. Throws `Error('Not enough cards in set to build a pack')`.
  - Test helpers: `makeCard(over?: Partial<Card>): Card`, `makeSet(sizes?: { common: number; uncommon: number; rare: number; mythic: number }): SetCards` (default sizes 60/30/15/5).

- [ ] **Step 1: Test helpers**

`server/test/helpers.ts`:
```ts
import { COLORS, type Card, type Rarity, type SetCards } from '@mtg/shared';

let counter = 0;

export function makeCard(over: Partial<Card> = {}): Card {
  counter++;
  return {
    instanceId: '', scryfallId: `sf-${counter}`, name: `Card ${counter}`, manaCost: '{1}', manaValue: 1,
    colors: [], typeLine: 'Artifact', oracleText: '', rarity: 'common', imageUrl: '',
    ...over,
  };
}

export function makeSet(sizes = { common: 60, uncommon: 30, rare: 15, mythic: 5 }): SetCards {
  const cards: Card[] = [];
  for (const rarity of ['common', 'uncommon', 'rare', 'mythic'] as Rarity[]) {
    for (let i = 0; i < sizes[rarity]; i++) {
      cards.push(makeCard({
        name: `${rarity}-${i}`, rarity, colors: [COLORS[i % 5]],
        typeLine: i % 2 ? 'Creature — Test' : 'Instant',
      }));
    }
  }
  const basics = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].map((name) =>
    makeCard({ name, typeLine: `Basic Land — ${name}`, colors: [] }),
  );
  return { cards, basics };
}
```

- [ ] **Step 2: Write the failing tests**

`server/test/packs.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { generatePack } from '../src/packs/generatePack';
import { mulberry32 } from '../src/rng';
import { makeSet } from './helpers';

describe('generatePack', () => {
  const set = makeSet();

  it('has 15 cards in the correct slot rarities', () => {
    const pack = generatePack(set, mulberry32(1));
    expect(pack).toHaveLength(15);
    expect(['rare', 'mythic']).toContain(pack[0].rarity);
    expect(pack.slice(1, 4).every((c) => c.rarity === 'uncommon')).toBe(true);
    expect(pack.slice(4, 14).every((c) => c.rarity === 'common')).toBe(true);
    expect(pack[14].typeLine).toContain('Basic Land');
  });

  it('never repeats a name within a pack', () => {
    for (let seed = 0; seed < 300; seed++) {
      const names = generatePack(set, mulberry32(seed)).map((c) => c.name);
      expect(new Set(names).size).toBe(15);
    }
  });

  it('returns copies, not the set objects', () => {
    const pack = generatePack(set, mulberry32(3));
    expect(set.cards).not.toContain(pack[1]);
  });

  it('opens a mythic about 1 in 8 packs', () => {
    const rng = mulberry32(99);
    let mythics = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) if (generatePack(set, rng)[0].rarity === 'mythic') mythics++;
    expect(mythics / n).toBeGreaterThan(0.09);
    expect(mythics / n).toBeLessThan(0.16);
  });

  it('always opens a rare when the set has no mythics', () => {
    const noMythic = makeSet({ common: 30, uncommon: 10, rare: 5, mythic: 0 });
    for (let seed = 0; seed < 50; seed++) expect(generatePack(noMythic, mulberry32(seed))[0].rarity).toBe('rare');
  });

  it('falls back to lower rarities when a pool is too small', () => {
    const tiny = makeSet({ common: 20, uncommon: 2, rare: 0, mythic: 0 });
    const pack = generatePack(tiny, mulberry32(5));
    expect(pack).toHaveLength(15);
    expect(pack.filter((c) => c.rarity === 'uncommon')).toHaveLength(2);
    expect(pack.filter((c) => c.rarity === 'common')).toHaveLength(12);
  });

  it('uses a common for the basic slot when the set has no basics', () => {
    const noBasics = { ...makeSet(), basics: [] };
    const pack = generatePack(noBasics, mulberry32(8));
    expect(pack).toHaveLength(15);
    expect(pack[14].rarity).toBe('common');
  });

  it('throws when there are not enough cards', () => {
    expect(() => generatePack(makeSet({ common: 5, uncommon: 0, rare: 0, mythic: 0 }), mulberry32(1)))
      .toThrow('Not enough cards in set to build a pack');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w @mtg/server -- packs`
Expected: FAIL — cannot resolve `../src/packs/generatePack`.

- [ ] **Step 4: Implement**

`server/src/packs/generatePack.ts`:
```ts
import type { Card, Rarity, SetCards } from '@mtg/shared';
import type { Rng } from '../rng';

export function generatePack(set: SetCards, rng: Rng): Card[] {
  const by: Record<Rarity, Card[]> = { common: [], uncommon: [], rare: [], mythic: [] };
  for (const c of set.cards) by[c.rarity].push(c);

  const used = new Set<string>();
  const pack: Card[] = [];
  const take = (pools: Card[][]) => {
    for (const pool of pools) {
      const avail = pool.filter((c) => !used.has(c.name));
      if (avail.length > 0) {
        const c = avail[Math.floor(rng() * avail.length)];
        used.add(c.name);
        pack.push({ ...c });
        return;
      }
    }
    throw new Error('Not enough cards in set to build a pack');
  };

  const mythicSlot = by.mythic.length > 0 && rng() < 1 / 8;
  take(mythicSlot ? [by.mythic, by.rare, by.uncommon, by.common] : [by.rare, by.mythic, by.uncommon, by.common]);
  for (let i = 0; i < 3; i++) take([by.uncommon, by.common]);
  for (let i = 0; i < 10; i++) take([by.common]);
  if (set.basics.length > 0) pack.push({ ...set.basics[Math.floor(rng() * set.basics.length)] });
  else take([by.common]);
  return pack;
}
```

- [ ] **Step 5: Verify**

Run: `npm test -w @mtg/server -- packs` → PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(server): booster pack generator"
```

### Task 4: Draft engine

**Files:**
- Create: `server/src/draft/engine.ts`
- Test: `server/test/draft.test.ts`

**Interfaces:**
- Consumes: `Card`, `SeatView` from `@mtg/shared`; `makeCard` test helper (Task 3).
- Produces:
  - `ROUNDS = 3`
  - `class InvalidPickError extends Error`
  - `interface DraftState { seatCount: number; round: number /*0-based*/; pickInRound: number /*0-based*/; unopened: Card[][][] /*[seat][round]*/; current: Card[][] /*[seat]*/; picks: Card[][] /*[seat]*/; pickedThisTurn: boolean[]; complete: boolean }`
  - `createDraft(seatCount: number, packsPerSeat: Card[][][] /*[seat][round]*/): DraftState` — assigns `instanceId = "r{round}s{seat}c{index}"`.
  - `applyPick(state: DraftState, seat: number, instanceId: string): DraftState` — pure; throws `InvalidPickError`.
  - `advanceIfReady(state: DraftState): DraftState` — pure; returns the same object if not every seat has picked.
  - `seatView(state: DraftState, seat: number): SeatView`

- [ ] **Step 1: Write the failing tests**

`server/test/draft.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/shared';
import { advanceIfReady, applyPick, createDraft, InvalidPickError, seatView, type DraftState } from '../src/draft/engine';
import { makeCard } from './helpers';

// packs[seat][round] with names "s{seat}r{round}c{i}" so we can see where a pack came from
function packs(seats: number, size = 15): Card[][][] {
  return Array.from({ length: seats }, (_, s) =>
    Array.from({ length: 3 }, (_, r) => Array.from({ length: size }, (_, i) => makeCard({ name: `s${s}r${r}c${i}` }))),
  );
}

function everyonePicksFirst(state: DraftState): DraftState {
  let s = state;
  for (let seat = 0; seat < s.seatCount; seat++) s = applyPick(s, seat, s.current[seat][0].instanceId);
  return advanceIfReady(s);
}

const origin = (pack: Card[]) => pack[0].name.slice(0, 4); // e.g. "s0r0"

describe('draft engine', () => {
  it('creates unique instance ids and opens round 1 packs', () => {
    const st = createDraft(8, packs(8));
    const ids = st.unopened.flat(2).map((c) => c.instanceId);
    expect(new Set(ids).size).toBe(8 * 3 * 15);
    expect(st.current[3][0].instanceId).toBe('r0s3c0');
    expect(seatView(st, 0)).toMatchObject({ packNumber: 1, pickNumber: 1, complete: false });
  });

  it('rejects mismatched pack input', () => {
    expect(() => createDraft(8, packs(7))).toThrow();
  });

  it('passes left in pack 1', () => {
    const st = everyonePicksFirst(createDraft(8, packs(8)));
    expect(origin(st.current[1])).toBe('s0r0');
    expect(origin(st.current[0])).toBe('s7r0');
    expect(st.current[1]).toHaveLength(14);
    expect(seatView(st, 0).pickNumber).toBe(2);
  });

  it('passes right in pack 2 and left in pack 3', () => {
    let st = createDraft(8, packs(8));
    for (let i = 0; i < 15; i++) st = everyonePicksFirst(st);
    expect(st.round).toBe(1);
    expect(seatView(st, 0)).toMatchObject({ packNumber: 2, pickNumber: 1 });
    st = everyonePicksFirst(st);
    expect(origin(st.current[0])).toBe('s1r1');
    for (let i = 0; i < 14; i++) st = everyonePicksFirst(st);
    expect(st.round).toBe(2);
    st = everyonePicksFirst(st);
    expect(origin(st.current[1])).toBe('s0r2');
  });

  it('completes after 45 picks per seat', () => {
    let st = createDraft(8, packs(8));
    for (let i = 0; i < 45; i++) st = everyonePicksFirst(st);
    expect(st.complete).toBe(true);
    expect(st.picks.every((p) => p.length === 45)).toBe(true);
    expect(seatView(st, 0)).toMatchObject({ complete: true, currentPack: null });
    expect(() => applyPick(st, 0, 'r0s0c0')).toThrow(InvalidPickError);
  });

  it('rejects a card that is not in the current pack', () => {
    const st = createDraft(8, packs(8));
    expect(() => applyPick(st, 0, 'r0s1c0')).toThrow(InvalidPickError);
  });

  it('rejects a second pick in the same turn', () => {
    let st = createDraft(8, packs(8));
    st = applyPick(st, 0, 'r0s0c0');
    expect(() => applyPick(st, 0, 'r0s0c1')).toThrow(InvalidPickError);
  });

  it('does not advance until every seat has picked, and hides the pack meanwhile', () => {
    let st = createDraft(8, packs(8));
    st = applyPick(st, 0, 'r0s0c0');
    expect(advanceIfReady(st)).toBe(st);
    expect(seatView(st, 0).currentPack).toBeNull();
    expect(seatView(st, 0).picks.map((c) => c.instanceId)).toEqual(['r0s0c0']);
  });

  it('is pure (does not mutate the input state)', () => {
    const st = createDraft(8, packs(8));
    const before = JSON.stringify(st);
    applyPick(st, 0, 'r0s0c0');
    expect(JSON.stringify(st)).toBe(before);
  });

  it('seat views expose only that seat', () => {
    const view = seatView(createDraft(8, packs(8)), 2);
    expect(Object.keys(view).sort()).toEqual(['complete', 'currentPack', 'packNumber', 'pickNumber', 'picks']);
    expect(view.currentPack!.every((c) => c.name.startsWith('s2r0'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @mtg/server -- draft`
Expected: FAIL — cannot resolve `../src/draft/engine`.

- [ ] **Step 3: Implement**

`server/src/draft/engine.ts`:
```ts
import type { Card, SeatView } from '@mtg/shared';

export const ROUNDS = 3;

export class InvalidPickError extends Error {}

export interface DraftState {
  seatCount: number;
  round: number; // 0-based
  pickInRound: number; // 0-based
  unopened: Card[][][]; // [seat][round]
  current: Card[][]; // pack in front of each seat
  picks: Card[][];
  pickedThisTurn: boolean[];
  complete: boolean;
}

export function createDraft(seatCount: number, packsPerSeat: Card[][][]): DraftState {
  if (packsPerSeat.length !== seatCount) throw new Error(`Expected packs for ${seatCount} seats`);
  const unopened = packsPerSeat.map((rounds, seat) => {
    if (rounds.length !== ROUNDS) throw new Error(`Seat ${seat} needs ${ROUNDS} packs`);
    return rounds.map((pack, round) => pack.map((card, i) => ({ ...card, instanceId: `r${round}s${seat}c${i}` })));
  });
  return {
    seatCount,
    round: 0,
    pickInRound: 0,
    unopened,
    current: unopened.map((r) => r[0]),
    picks: unopened.map(() => []),
    pickedThisTurn: unopened.map(() => false),
    complete: false,
  };
}

export function applyPick(state: DraftState, seat: number, instanceId: string): DraftState {
  if (state.complete) throw new InvalidPickError('Draft is complete');
  if (seat < 0 || seat >= state.seatCount) throw new InvalidPickError('No such seat');
  if (state.pickedThisTurn[seat]) throw new InvalidPickError('Seat already picked this turn');
  const pack = state.current[seat];
  const card = pack.find((c) => c.instanceId === instanceId);
  if (!card) throw new InvalidPickError('Card is not in the current pack');

  const current = state.current.slice();
  current[seat] = pack.filter((c) => c !== card);
  const picks = state.picks.slice();
  picks[seat] = [...picks[seat], card];
  const pickedThisTurn = state.pickedThisTurn.slice();
  pickedThisTurn[seat] = true;
  return { ...state, current, picks, pickedThisTurn };
}

function passDirection(round: number): 1 | -1 {
  return round === 1 ? -1 : 1; // left, right, left
}

export function advanceIfReady(state: DraftState): DraftState {
  if (state.complete || !state.pickedThisTurn.every(Boolean)) return state;
  const n = state.seatCount;
  const dir = passDirection(state.round);
  const passed: Card[][] = new Array(n);
  for (let i = 0; i < n; i++) passed[(i + dir + n) % n] = state.current[i];
  const reset = state.pickedThisTurn.map(() => false);

  if (passed[0].length > 0) {
    return { ...state, current: passed, pickedThisTurn: reset, pickInRound: state.pickInRound + 1 };
  }
  if (state.round === ROUNDS - 1) {
    return { ...state, current: passed, pickedThisTurn: reset, complete: true };
  }
  const round = state.round + 1;
  return { ...state, round, pickInRound: 0, current: state.unopened.map((r) => r[round]), pickedThisTurn: reset };
}

export function seatView(state: DraftState, seat: number): SeatView {
  return {
    packNumber: state.round + 1,
    pickNumber: state.pickInRound + 1,
    currentPack: state.complete || state.pickedThisTurn[seat] ? null : state.current[seat],
    picks: state.picks[seat],
    complete: state.complete,
  };
}
```

- [ ] **Step 4: Verify**

Run: `npm test -w @mtg/server -- draft` → PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): pure draft engine"
```

### Task 5: Bot picker

**Files:**
- Create: `server/src/bots/botPick.ts`
- Test: `server/test/bots.test.ts`

**Interfaces:**
- Consumes: `Rng` (Task 1), `Card`, `Color`, `COLORS` from `@mtg/shared`; `makeCard` helper (Task 3).
- Produces:
  - `baseScore(card: Card): number`
  - `committedColors(picks: Card[]): Color[]` — up to 2 colors, highest weight first, ties in WUBRG order.
  - `botPick(pack: Card[], picks: Card[], rng: Rng): string` — returns an `instanceId` from `pack`; throws on empty pack.

- [ ] **Step 1: Write the failing tests**

`server/test/bots.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { baseScore, botPick, committedColors } from '../src/bots/botPick';
import { mulberry32 } from '../src/rng';
import { makeCard } from './helpers';

const card = (id: string, over: Parameters<typeof makeCard>[0] = {}) => makeCard({ instanceId: id, ...over });

describe('baseScore', () => {
  it('uses rarity base', () => {
    expect(baseScore(card('a', { rarity: 'mythic' }))).toBe(4);
    expect(baseScore(card('a', { rarity: 'rare' }))).toBe(3.5);
    expect(baseScore(card('a', { rarity: 'uncommon' }))).toBe(2);
    expect(baseScore(card('a', { rarity: 'common' }))).toBe(1);
  });

  it('adds creature and removal bonuses', () => {
    expect(baseScore(card('a', { typeLine: 'Creature — Elf' }))).toBe(1.5);
    expect(baseScore(card('a', { typeLine: 'Instant', oracleText: 'Destroy target creature.' }))).toBe(1.75);
    expect(baseScore(card('a', { oracleText: 'Shock deals 2 damage to any target.' }))).toBe(1.75);
    expect(baseScore(card('a', { oracleText: 'Target creature you control fights target creature.' }))).toBe(1.75);
  });

  it('penalizes basics and utility lands but not dual lands', () => {
    expect(baseScore(card('a', { typeLine: 'Basic Land — Forest' }))).toBe(-2);
    expect(baseScore(card('a', { typeLine: 'Land', oracleText: '{T}: Add {C}.' }))).toBe(0);
    expect(baseScore(card('a', { typeLine: 'Land', oracleText: '{T}: Add {R} or {G}.' }))).toBe(1);
  });
});

describe('committedColors', () => {
  it('returns the two heaviest colors', () => {
    const picks = [
      card('1', { colors: ['R'], rarity: 'rare' }),
      card('2', { colors: ['G'] }),
      card('3', { colors: ['G'] }),
      card('4', { colors: ['U'] }),
    ];
    expect(committedColors(picks)).toEqual(['R', 'G']);
  });

  it('ignores colors with no weight', () => {
    expect(committedColors([card('1', { colors: ['B'] }), card('2', { colors: [] })])).toEqual(['B']);
  });
});

describe('botPick', () => {
  it('returns an id from the pack', () => {
    const pack = [card('x'), card('y'), card('z')];
    expect(['x', 'y', 'z']).toContain(botPick(pack, [], mulberry32(1)));
  });

  it('takes the strongest card early', () => {
    const pack = [card('common'), card('rare', { rarity: 'rare' }), card('common2')];
    for (let seed = 0; seed < 20; seed++) expect(botPick(pack, [], mulberry32(seed))).toBe('rare');
  });

  it('prefers on-color cards once committed (pick 6+)', () => {
    const picks = Array.from({ length: 5 }, (_, i) => card(`p${i}`, { colors: ['R'] }));
    const pack = [card('blueRare', { rarity: 'rare', colors: ['U'] }), card('redUnc', { rarity: 'uncommon', colors: ['R'] })];
    for (let seed = 0; seed < 20; seed++) expect(botPick(pack, picks, mulberry32(seed))).toBe('redUnc');
  });

  it('treats colorless cards as on-color', () => {
    const picks = Array.from({ length: 5 }, (_, i) => card(`p${i}`, { colors: ['R'] }));
    const pack = [card('blueRare', { rarity: 'rare', colors: ['U'] }), card('artifact', { rarity: 'uncommon', colors: [] })];
    // colorless uncommon 2*1.5 = 3 beats off-color rare 3.5*0.5 = 1.75 (jitter is only ±0.3)
    for (let seed = 0; seed < 20; seed++) expect(botPick(pack, picks, mulberry32(seed))).toBe('artifact');
  });

  it('is deterministic with a fixed seed', () => {
    const pack = Array.from({ length: 10 }, (_, i) => card(`c${i}`));
    expect(botPick(pack, [], mulberry32(5))).toBe(botPick(pack, [], mulberry32(5)));
  });

  it('throws on an empty pack', () => {
    expect(() => botPick([], [], mulberry32(1))).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @mtg/server -- bots`
Expected: FAIL — cannot resolve `../src/bots/botPick`.

- [ ] **Step 3: Implement**

`server/src/bots/botPick.ts`:
```ts
import { COLORS, type Card, type Color, type Rarity } from '@mtg/shared';
import type { Rng } from '../rng';

const RARITY_BASE: Record<Rarity, number> = { mythic: 4, rare: 3.5, uncommon: 2, common: 1 };
const REMOVAL = /destroy target|exile target|deals \d+ damage to (any target|target creature)|fights/i;
const COMMIT_AFTER = 5; // picks 6+ use color commitment
const JITTER = 0.3;

function isDualLand(card: Card): boolean {
  const symbols = new Set<string>();
  for (const line of card.oracleText.split('\n')) {
    if (!/\badd\b/i.test(line)) continue;
    for (const m of line.matchAll(/\{([WUBRG])\}/g)) symbols.add(m[1]);
  }
  return symbols.size >= 2;
}

export function baseScore(card: Card): number {
  let s = RARITY_BASE[card.rarity];
  if (card.typeLine.includes('Basic Land')) return s - 3;
  if (card.typeLine.includes('Creature')) s += 0.5;
  if (REMOVAL.test(card.oracleText)) s += 0.75;
  if (/\bLand\b/.test(card.typeLine) && !isDualLand(card)) s -= 1;
  return s;
}

export function committedColors(picks: Card[]): Color[] {
  const weight = Object.fromEntries(COLORS.map((c) => [c, 0])) as Record<Color, number>;
  for (const p of picks) for (const c of p.colors) weight[c] += RARITY_BASE[p.rarity];
  return [...COLORS]
    .sort((a, b) => weight[b] - weight[a]) // stable: ties keep WUBRG order
    .filter((c) => weight[c] > 0)
    .slice(0, 2);
}

export function botPick(pack: Card[], picks: Card[], rng: Rng): string {
  if (pack.length === 0) throw new Error('Cannot pick from an empty pack');
  const committed = picks.length >= COMMIT_AFTER ? committedColors(picks) : null;
  let best = pack[0];
  let bestScore = -Infinity;
  for (const card of pack) {
    let s = baseScore(card);
    if (committed) {
      const onColor = card.colors.length === 0 || card.colors.every((c) => committed.includes(c));
      s *= onColor ? 1.5 : 0.5;
    }
    s += rng() * 2 * JITTER - JITTER;
    if (s > bestScore) {
      bestScore = s;
      best = card;
    }
  }
  return best.instanceId;
}
```

- [ ] **Step 4: Verify**

Run: `npm test -w @mtg/server -- bots` → PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): heuristic bot picker"
```

### Task 6: Room manager

**Files:**
- Create: `server/src/rooms/RoomManager.ts`
- Test: `server/test/rooms.test.ts`

**Interfaces:**
- Consumes: `generatePack` (Task 3), `createDraft`/`applyPick`/`advanceIfReady`/`seatView`/`InvalidPickError`/`ROUNDS`/`DraftState` (Task 4), `botPick` (Task 5), `mulberry32`/`Rng` (Task 1), `SetCards`/`DeckSavePayload`/`COLORS` from `@mtg/shared`.
- Produces:
  - `SEATS = 8`, `HUMAN_SEAT = 0`, `ROOM_TTL_MS = 30 * 60 * 1000`
  - `interface Room { id: string; setCode: string; state: DraftState; rng: Rng; lastActivity: number; deck: DeckSavePayload | null }`
  - `class RoomNotFoundError extends Error`, `class DeckError extends Error`
  - `class RoomManager` with `constructor(deps: { getSetCards(code: string): Promise<SetCards>; seed?: () => number; now?: () => number })`, `createPracticeRoom(setCode: string): Promise<Room>`, `get(id: string): Room` (refreshes `lastActivity`), `pick(id: string, instanceId: string): Room`, `saveDeck(id: string, deck: DeckSavePayload): void`, `sweep(): number` (rooms removed), `readonly size: number`.

- [ ] **Step 1: Write the failing tests**

`server/test/rooms.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { InvalidPickError, seatView } from '../src/draft/engine';
import { DeckError, HUMAN_SEAT, RoomManager, RoomNotFoundError, ROOM_TTL_MS, type Room } from '../src/rooms/RoomManager';
import { makeSet } from './helpers';

const noBasics = { W: 0, U: 0, B: 0, R: 0, G: 0 };

function setup() {
  let now = 1_000;
  const manager = new RoomManager({ getSetCards: async () => makeSet(), seed: () => 42, now: () => now });
  return { manager, advance: (ms: number) => (now += ms) };
}

function draftToEnd(manager: RoomManager, room: Room) {
  for (let i = 0; i < 45; i++) manager.pick(room.id, room.state.current[HUMAN_SEAT][0].instanceId);
}

describe('RoomManager', () => {
  it('creates an 8-seat practice draft', async () => {
    const { manager } = setup();
    const room = await manager.createPracticeRoom('tst');
    expect(room.state.seatCount).toBe(8);
    expect(seatView(room.state, HUMAN_SEAT).currentPack).toHaveLength(15);
    expect(manager.get(room.id)).toBe(room);
  });

  it('runs bot picks and passes after a human pick', async () => {
    const { manager } = setup();
    const room = await manager.createPracticeRoom('tst');
    manager.pick(room.id, room.state.current[HUMAN_SEAT][0].instanceId);
    expect(room.state.picks.every((p) => p.length === 1)).toBe(true);
    expect(seatView(room.state, HUMAN_SEAT)).toMatchObject({ pickNumber: 2 });
    expect(room.state.current[HUMAN_SEAT]).toHaveLength(14);
  });

  it('throws InvalidPickError and leaves state unchanged on a bad pick', async () => {
    const { manager } = setup();
    const room = await manager.createPracticeRoom('tst');
    const before = room.state;
    expect(() => manager.pick(room.id, 'nope')).toThrow(InvalidPickError);
    expect(room.state).toBe(before);
  });

  it('completes a full draft with 45 picks for the human', async () => {
    const { manager } = setup();
    const room = await manager.createPracticeRoom('tst');
    draftToEnd(manager, room);
    expect(room.state.complete).toBe(true);
    expect(room.state.picks[HUMAN_SEAT]).toHaveLength(45);
  });

  it('saves a valid deck only after completion', async () => {
    const { manager } = setup();
    const room = await manager.createPracticeRoom('tst');
    expect(() => manager.saveDeck(room.id, { main: [], basics: noBasics })).toThrow(DeckError);
    draftToEnd(manager, room);
    const main = room.state.picks[HUMAN_SEAT].slice(0, 23).map((c) => c.instanceId);
    manager.saveDeck(room.id, { main, basics: { ...noBasics, R: 8, G: 9 } });
    expect(room.deck?.main).toHaveLength(23);
    expect(() => manager.saveDeck(room.id, { main: ['not-in-pool'], basics: noBasics })).toThrow(DeckError);
    expect(() => manager.saveDeck(room.id, { main, basics: { ...noBasics, R: -1 } })).toThrow(DeckError);
  });

  it('throws RoomNotFoundError for unknown rooms', () => {
    const { manager } = setup();
    expect(() => manager.get('missing')).toThrow(RoomNotFoundError);
  });

  it('sweeps rooms idle for more than 30 minutes', async () => {
    const { manager, advance } = setup();
    const idle = await manager.createPracticeRoom('tst');
    const active = await manager.createPracticeRoom('tst');
    advance(ROOM_TTL_MS - 1);
    manager.get(active.id);
    advance(2);
    expect(manager.sweep()).toBe(1);
    expect(() => manager.get(idle.id)).toThrow(RoomNotFoundError);
    expect(manager.get(active.id)).toBe(active);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @mtg/server -- rooms`
Expected: FAIL — cannot resolve `../src/rooms/RoomManager`.

- [ ] **Step 3: Implement**

`server/src/rooms/RoomManager.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { COLORS, type DeckSavePayload, type SetCards } from '@mtg/shared';
import { botPick } from '../bots/botPick';
import { advanceIfReady, applyPick, createDraft, ROUNDS, type DraftState } from '../draft/engine';
import { generatePack } from '../packs/generatePack';
import { mulberry32, type Rng } from '../rng';

export const SEATS = 8;
export const HUMAN_SEAT = 0;
export const ROOM_TTL_MS = 30 * 60 * 1000;

export interface Room {
  id: string;
  setCode: string;
  state: DraftState;
  rng: Rng;
  lastActivity: number;
  deck: DeckSavePayload | null;
}

export class RoomNotFoundError extends Error {}
export class DeckError extends Error {}

export interface RoomManagerDeps {
  getSetCards(code: string): Promise<SetCards>;
  seed?: () => number;
  now?: () => number;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private seed: () => number;
  private now: () => number;

  constructor(private deps: RoomManagerDeps) {
    this.seed = deps.seed ?? (() => Math.floor(Math.random() * 2 ** 32));
    this.now = deps.now ?? Date.now;
  }

  get size(): number {
    return this.rooms.size;
  }

  async createPracticeRoom(setCode: string): Promise<Room> {
    const set = await this.deps.getSetCards(setCode);
    const rng = mulberry32(this.seed());
    const packs = Array.from({ length: SEATS }, () => Array.from({ length: ROUNDS }, () => generatePack(set, rng)));
    const room: Room = {
      id: randomUUID(),
      setCode,
      state: createDraft(SEATS, packs),
      rng,
      lastActivity: this.now(),
      deck: null,
    };
    this.rooms.set(room.id, room);
    return room;
  }

  get(id: string): Room {
    const room = this.rooms.get(id);
    if (!room) throw new RoomNotFoundError('Draft not found or expired');
    room.lastActivity = this.now();
    return room;
  }

  pick(id: string, instanceId: string): Room {
    const room = this.get(id);
    let st = applyPick(room.state, HUMAN_SEAT, instanceId); // throws InvalidPickError before any mutation
    for (let seat = 0; seat < SEATS; seat++) {
      if (seat === HUMAN_SEAT) continue;
      st = applyPick(st, seat, botPick(st.current[seat], st.picks[seat], room.rng));
    }
    room.state = advanceIfReady(st);
    return room;
  }

  saveDeck(id: string, deck: DeckSavePayload): void {
    const room = this.get(id);
    if (!room.state.complete) throw new DeckError('Draft is not complete');
    const pool = new Set(room.state.picks[HUMAN_SEAT].map((c) => c.instanceId));
    if (!Array.isArray(deck.main) || !deck.main.every((cid) => pool.has(cid)) || new Set(deck.main).size !== deck.main.length) {
      throw new DeckError('Deck contains cards that are not in your pool');
    }
    for (const c of COLORS) {
      const n = deck.basics?.[c] as number;
      if (!Number.isInteger(n) || n < 0) throw new DeckError('Invalid basic land counts');
    }
    room.deck = { main: [...deck.main], basics: { ...deck.basics } };
  }

  sweep(): number {
    const cutoff = this.now() - ROOM_TTL_MS;
    let removed = 0;
    for (const [id, room] of this.rooms) {
      if (room.lastActivity < cutoff) {
        this.rooms.delete(id);
        removed++;
      }
    }
    return removed;
  }
}
```

- [ ] **Step 4: Verify**

Run: `npm test -w @mtg/server -- rooms` → PASS (7 tests). Run `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): practice room manager"
```

### Task 7: Socket.IO server, entrypoint, integration test

**Files:**
- Create: `server/src/server.ts`, `server/src/index.ts`
- Test: `server/test/server.test.ts`

**Interfaces:**
- Consumes: `RoomManager`, `HUMAN_SEAT`, `Room` (Task 6); `seatView`, `InvalidPickError` (Task 4); `createScryfallClient` (Task 2); `createCardSource` (Task 2); event maps from `@mtg/shared` (Task 1).
- Produces: `createDraftServer(deps: { manager: RoomManager; listSets: () => Promise<SetInfo[]> }): { httpServer: http.Server; io: Server }`. Runtime server on `PORT` (default 3001). Event contract exactly as `ClientToServerEvents` / `ServerToClientEvents`:
  - `practice:start` → `draft:state` (or `practice:error`)
  - `draft:pick` → `draft:state` / `draft:complete`; an invalid pick re-emits the unchanged state
  - `room:resume` → current `draft:state` / `draft:complete`, or `practice:error` if the room is gone
  - `deck:save` → ack `{ ok }`
  - `sets:list` → ack `SetsListResult`

- [ ] **Step 1: Write the failing integration test**

`server/test/server.test.ts`:
```ts
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import type { Card, ClientToServerEvents, ServerToClientEvents } from '@mtg/shared';
import { RoomManager } from '../src/rooms/RoomManager';
import { createDraftServer } from '../src/server';
import { makeSet } from './helpers';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let url = '';
let close: () => Promise<void>;
const clients: ClientSocket[] = [];

function connect(): ClientSocket {
  const c: ClientSocket = ioc(url, { transports: ['websocket'], forceNew: true });
  clients.push(c);
  return c;
}

async function start(getSetCards = async () => makeSet()) {
  const manager = new RoomManager({ getSetCards, seed: () => 1 });
  const { httpServer, io } = createDraftServer({
    manager,
    listSets: async () => [{ code: 'tst', name: 'Test Set', releasedAt: '2026-01-01', iconSvgUri: '' }],
  });
  await new Promise<void>((r) => httpServer.listen(0, r));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
  close = () => new Promise((r) => io.close(() => r()));
}

beforeEach(() => start());
afterEach(async () => {
  clients.splice(0).forEach((c) => c.close());
  await close();
});

describe('draft server', () => {
  it('lists sets', async () => {
    const res = await connect().emitWithAck('sets:list');
    expect(res).toEqual({ ok: true, sets: [expect.objectContaining({ code: 'tst' })] });
  });

  it('runs a full practice draft to completion', async () => {
    const client = connect();
    const pool = await new Promise<Card[]>((resolve) => {
      client.on('draft:state', ({ view }) => client.emit('draft:pick', { instanceId: view.currentPack![0].instanceId }));
      client.on('draft:complete', ({ pool }) => resolve(pool));
      client.emit('practice:start', { setCode: 'tst' });
    });
    expect(pool).toHaveLength(45);
    const res = await client.emitWithAck('deck:save', {
      main: pool.slice(0, 23).map((c) => c.instanceId),
      basics: { W: 0, U: 0, B: 0, R: 8, G: 9 },
    });
    expect(res).toEqual({ ok: true });
  });

  it('re-emits unchanged state on an invalid pick', async () => {
    const client = connect();
    const first = await new Promise<{ roomId: string }>((r) => {
      client.once('draft:state', r);
      client.emit('practice:start', { setCode: 'tst' });
    });
    const again = await new Promise<{ roomId: string; view: { pickNumber: number } }>((r) => {
      client.once('draft:state', r);
      client.emit('draft:pick', { instanceId: 'bogus' });
    });
    expect(again.roomId).toBe(first.roomId);
    expect(again.view.pickNumber).toBe(1);
  });

  it('resumes a draft from another connection', async () => {
    const a = connect();
    const { roomId } = await new Promise<{ roomId: string }>((r) => {
      a.once('draft:state', r);
      a.emit('practice:start', { setCode: 'tst' });
    });
    const b = connect();
    const resumed = await new Promise<{ roomId: string; view: { currentPack: Card[] | null } }>((r) => {
      b.once('draft:state', r);
      b.emit('room:resume', { roomId });
    });
    expect(resumed.roomId).toBe(roomId);
    expect(resumed.view.currentPack).toHaveLength(15);
  });

  it('reports errors for unknown rooms and failed set loads', async () => {
    const client = connect();
    const missing = await new Promise<{ message: string }>((r) => {
      client.once('practice:error', r);
      client.emit('room:resume', { roomId: 'nope' });
    });
    expect(missing.message).toBe('Draft not found or expired');

    await close();
    await start(async () => {
      throw new Error('No booster cards found for set "zzz"');
    });
    const c2 = connect();
    const failed = await new Promise<{ message: string }>((r) => {
      c2.once('practice:error', r);
      c2.emit('practice:start', { setCode: 'zzz' });
    });
    expect(failed.message).toBe('No booster cards found for set "zzz"');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @mtg/server -- server`
Expected: FAIL — cannot resolve `../src/server`.

- [ ] **Step 3: Implement the server**

`server/src/server.ts`:
```ts
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
```

- [ ] **Step 4: Implement the entrypoint**

`server/src/index.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { createScryfallClient } from './cards/client';
import { createCardSource } from './cards/source';
import { RoomManager } from './rooms/RoomManager';
import { createDraftServer } from './server';

const cacheDir = fileURLToPath(new URL('../.cache', import.meta.url));
const source = createCardSource({ client: createScryfallClient(), cacheDir });
const manager = new RoomManager({ getSetCards: (code) => source.getSetCards(code) });
const { httpServer } = createDraftServer({ manager, listSets: () => source.listDraftableSets() });

setInterval(() => manager.sweep(), 60_000).unref();

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, () => console.log(`Draft server listening on http://localhost:${port}`));
```

- [ ] **Step 5: Verify**

Run: `npm test -w @mtg/server` → all server tests PASS. Run `npm run typecheck` → no errors.

Smoke test against real Scryfall (network required): `npm start -w @mtg/server` → logs `Draft server listening on http://localhost:3001`. Stop with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(server): socket.io draft server and entrypoint"
```

### Task 8: Client scaffold, card helpers, socket, App shell, Home screen

**Files:**
- Create: `client/package.json`, `client/tsconfig.json`, `client/vite.config.ts`, `client/index.html`
- Create: `client/src/main.tsx`, `client/src/App.tsx`, `client/src/socket.ts`, `client/src/styles.css`
- Create: `client/src/lib/cards.ts`, `client/src/components/CardImage.tsx`, `client/src/screens/Home.tsx`
- Test: `client/test/cards.test.ts`

**Interfaces:**
- Consumes: `Card`, `Color`, `COLORS`, `SeatView`, `SetInfo`, event maps from `@mtg/shared`; server events from Task 7.
- Produces:
  - `lib/cards.ts`: `type ColorGroup = Color | 'multi' | 'colorless'`, `GROUP_LABEL: Record<ColorGroup, string>`, `colorGroup(card): ColorGroup`, `groupByColor(cards): { group: ColorGroup; cards: Card[] }[]` (non-empty groups, order W U B R G multi colorless), `isLand(card): boolean`, `manaCurve(cards): number[]` (7 buckets: 0,1,2,3,4,5,6+; nonland only), `BASIC_NAMES: Record<Color, string>`, `deckSize(main, basics): number`, `buildDecklist(main, sideboard, basics): string`.
  - `socket.ts`: `socket: AppSocket`.
  - `components/CardImage.tsx`: `CardImage({ card, onClick?, disabled?, onHover? })`.
  - `App.tsx` screens: `home` → `draft` (`Draft` component, Task 9) → `deck` (`Deckbuilder`, Task 10). Until Tasks 9–10 exist, App renders placeholders for those screens.

- [ ] **Step 1: Package and config**

`client/package.json`:
```json
{
  "name": "@mtg/client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p . && vite build",
    "test": "vitest run",
    "typecheck": "tsc -p ."
  },
  "dependencies": { "@mtg/shared": "*" }
}
```

Install:
```bash
npm install -w @mtg/client react@18.3.1 react-dom@18.3.1 socket.io-client@4.8.1
npm install -w @mtg/client -D vite@5.4.11 @vitejs/plugin-react@4.3.4 @types/react@18.3.12 @types/react-dom@18.3.1 vitest@2.1.8
```

`client/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

`client/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/socket.io': { target: 'http://localhost:3001', ws: true } },
  },
});
```

`client/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MTG Practice Draft</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the failing helper tests**

`client/test/cards.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/shared';
import { buildDecklist, colorGroup, deckSize, groupByColor, manaCurve } from '../src/lib/cards';

let n = 0;
const card = (over: Partial<Card> = {}): Card => ({
  instanceId: `i${++n}`, scryfallId: `s${n}`, name: `Card ${n}`, manaCost: '', manaValue: 2, colors: [],
  typeLine: 'Creature — Test', oracleText: '', rarity: 'common', imageUrl: '', ...over,
});
const noBasics = { W: 0, U: 0, B: 0, R: 0, G: 0 };

describe('colorGroup / groupByColor', () => {
  it('classifies mono, multi and colorless', () => {
    expect(colorGroup(card({ colors: ['R'] }))).toBe('R');
    expect(colorGroup(card({ colors: ['R', 'G'] }))).toBe('multi');
    expect(colorGroup(card())).toBe('colorless');
  });

  it('returns non-empty groups in WUBRG, multi, colorless order', () => {
    const groups = groupByColor([card(), card({ colors: ['G'] }), card({ colors: ['W', 'U'] }), card({ colors: ['W'] })]);
    expect(groups.map((g) => g.group)).toEqual(['W', 'G', 'multi', 'colorless']);
  });
});

describe('manaCurve', () => {
  it('buckets nonland cards 0..6+', () => {
    const curve = manaCurve([
      card({ manaValue: 0 }), card({ manaValue: 2 }), card({ manaValue: 2 }), card({ manaValue: 9 }),
      card({ manaValue: 0, typeLine: 'Land' }),
    ]);
    expect(curve).toEqual([1, 0, 2, 0, 0, 0, 1]);
  });
});

describe('deckSize / buildDecklist', () => {
  it('counts main cards plus basics', () => {
    expect(deckSize([card(), card()], { ...noBasics, R: 3 })).toBe(5);
  });

  it('formats main deck, basics merged by name, then sideboard', () => {
    const bolt = card({ name: 'Lightning Bolt' });
    const bolt2 = card({ name: 'Lightning Bolt' });
    const drafted = card({ name: 'Mountain', typeLine: 'Basic Land — Mountain' });
    const side = card({ name: 'Giant Growth' });
    const text = buildDecklist([bolt, bolt2, drafted], [side], { ...noBasics, R: 7, G: 1 });
    expect(text).toBe(['2 Lightning Bolt', '8 Mountain', '1 Forest', '', 'Sideboard', '1 Giant Growth'].join('\n'));
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w @mtg/client`
Expected: FAIL — cannot resolve `../src/lib/cards`.

- [ ] **Step 4: Implement helpers**

`client/src/lib/cards.ts`:
```ts
import { COLORS, type Card, type Color } from '@mtg/shared';

export type ColorGroup = Color | 'multi' | 'colorless';

const GROUP_ORDER: ColorGroup[] = ['W', 'U', 'B', 'R', 'G', 'multi', 'colorless'];

export const GROUP_LABEL: Record<ColorGroup, string> = {
  W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', multi: 'Multicolor', colorless: 'Colorless',
};

export const BASIC_NAMES: Record<Color, string> = {
  W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest',
};

export function colorGroup(card: Card): ColorGroup {
  if (card.colors.length === 0) return 'colorless';
  if (card.colors.length > 1) return 'multi';
  return card.colors[0];
}

export function groupByColor(cards: Card[]): { group: ColorGroup; cards: Card[] }[] {
  return GROUP_ORDER.map((group) => ({ group, cards: cards.filter((c) => colorGroup(c) === group) })).filter(
    (g) => g.cards.length > 0,
  );
}

export const isLand = (card: Card) => /\bLand\b/.test(card.typeLine);

export function manaCurve(cards: Card[]): number[] {
  const curve = [0, 0, 0, 0, 0, 0, 0];
  for (const c of cards) if (!isLand(c)) curve[Math.min(6, Math.floor(c.manaValue))]++;
  return curve;
}

export function deckSize(main: Card[], basics: Record<Color, number>): number {
  return main.length + COLORS.reduce((sum, c) => sum + basics[c], 0);
}

function countLines(counts: Map<string, number>): string[] {
  return [...counts].map(([name, k]) => `${k} ${name}`);
}

export function buildDecklist(main: Card[], sideboard: Card[], basics: Record<Color, number>): string {
  const mainCounts = new Map<string, number>();
  for (const c of main) mainCounts.set(c.name, (mainCounts.get(c.name) ?? 0) + 1);
  for (const color of COLORS) {
    if (basics[color] > 0) {
      const name = BASIC_NAMES[color];
      mainCounts.set(name, (mainCounts.get(name) ?? 0) + basics[color]);
    }
  }
  const sideCounts = new Map<string, number>();
  for (const c of sideboard) sideCounts.set(c.name, (sideCounts.get(c.name) ?? 0) + 1);
  return [...countLines(mainCounts), '', 'Sideboard', ...countLines(sideCounts)].join('\n');
}
```

- [ ] **Step 5: Verify helpers**

Run: `npm test -w @mtg/client` → PASS (6 tests).

- [ ] **Step 6: Socket, card component, styles**

`client/src/socket.ts`:
```ts
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@mtg/shared';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Same origin; Vite proxies /socket.io to the server in development.
export const socket: AppSocket = io();
```

`client/src/components/CardImage.tsx`:
```tsx
import type { Card } from '@mtg/shared';

interface Props {
  card: Card;
  onClick?: () => void;
  disabled?: boolean;
  onHover?: (card: Card | null) => void;
}

export function CardImage({ card, onClick, disabled, onHover }: Props) {
  return (
    <button
      type="button"
      className="card"
      onClick={onClick}
      disabled={disabled}
      title={card.name}
      onMouseEnter={() => onHover?.(card)}
      onMouseLeave={() => onHover?.(null)}
    >
      {card.imageUrl ? (
        <img src={card.imageUrl} alt={card.name} loading="lazy" />
      ) : (
        <span className="card-fallback">{card.name}</span>
      )}
    </button>
  );
}
```

`client/src/styles.css`:
```css
:root {
  --bg: #14171c;
  --felt: #1b2a24;
  --panel: #20252d;
  --border: #323a45;
  --text: #e8e6e1;
  --muted: #9aa3ad;
  --accent: #d9a441;
  --danger: #e0645c;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: var(--text);
  background: var(--bg);
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); min-height: 100vh; }
h1, h2, h3 { margin: 0; font-weight: 600; }
button { font: inherit; color: inherit; cursor: pointer; }
button:disabled { cursor: default; opacity: 0.6; }

.btn { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 8px 14px; }
.btn:hover:not(:disabled) { border-color: var(--accent); }
.btn-primary { background: var(--accent); color: #1a1408; border-color: var(--accent); font-weight: 600; }
.error { background: rgba(224, 100, 92, 0.12); border: 1px solid var(--danger); border-radius: 6px; padding: 10px 14px; display: flex; gap: 12px; align-items: center; justify-content: space-between; }
.muted { color: var(--muted); }

.home { max-width: 520px; margin: 12vh auto 0; padding: 0 16px; display: grid; gap: 18px; }
.home select { width: 100%; padding: 8px; background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 6px; }

.card { padding: 0; border: 2px solid transparent; border-radius: 10px; background: none; display: block; width: 100%; aspect-ratio: 488 / 680; overflow: hidden; }
.card:hover:not(:disabled) { border-color: var(--accent); transform: translateY(-2px); }
.card img { width: 100%; height: 100%; display: block; object-fit: cover; }
.card-fallback { display: flex; height: 100%; align-items: center; justify-content: center; padding: 8px; background: var(--panel); text-align: center; }

.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.card-grid.small { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 6px; }

.preview { position: fixed; right: 16px; bottom: 16px; width: 300px; pointer-events: none; z-index: 10; filter: drop-shadow(0 8px 24px rgba(0, 0, 0, 0.6)); }
.preview img { width: 100%; border-radius: 14px; display: block; }
```

(Draft and Deckbuilder styles are appended in Tasks 9–10.)

- [ ] **Step 7: Home screen**

`client/src/screens/Home.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import type { SetInfo } from '@mtg/shared';
import { socket } from '../socket';

interface Props {
  onStart: (setCode: string) => void;
  starting: boolean;
  error: string | null;
}

export function Home({ onStart, starting, error }: Props) {
  const [sets, setSets] = useState<SetInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await socket.timeout(15_000).emitWithAck('sets:list');
      if (res.ok) {
        setSets(res.sets);
        setCode((c) => c || res.sets[0]?.code || '');
      } else {
        setLoadError(res.message);
      }
    } catch {
      setLoadError('The draft server did not respond.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="home">
      <h1>MTG Practice Draft</h1>
      <p className="muted">Draft a real set against 7 bots, then build a deck from your picks.</p>

      {loadError && (
        <div className="error">
          <span>{loadError}</span>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      )}
      {error && (
        <div className="error">
          <span>{error}</span>
          <button className="btn" onClick={() => onStart(code)} disabled={!code || starting}>Retry</button>
        </div>
      )}

      <label>
        <div className="muted" style={{ marginBottom: 6 }}>Set</div>
        <select value={code} onChange={(e) => setCode(e.target.value)} disabled={!sets || starting}>
          {!sets && <option>Loading sets…</option>}
          {sets?.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name} ({s.code.toUpperCase()}) · {s.releasedAt.slice(0, 4)}
            </option>
          ))}
        </select>
      </label>

      <button className="btn btn-primary" onClick={() => onStart(code)} disabled={!code || starting}>
        {starting ? 'Opening packs… (first load of a set can take a few seconds)' : 'Start practice draft'}
      </button>
    </main>
  );
}
```

- [ ] **Step 8: App shell and entry**

`client/src/App.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { Card, SeatView } from '@mtg/shared';
import { socket } from './socket';
import { Home } from './screens/Home';

type Screen = { name: 'home' } | { name: 'draft'; view: SeatView } | { name: 'deck'; pool: Card[] };

const ROOM_KEY = 'mtg.practice.roomId';

function storeRoom(id: string | null) {
  try {
    if (id) sessionStorage.setItem(ROOM_KEY, id);
    else sessionStorage.removeItem(ROOM_KEY);
  } catch {
    /* storage unavailable: resume just won't work */
  }
}

function loadRoom(): string | null {
  try {
    return sessionStorage.getItem(ROOM_KEY);
  } catch {
    return null;
  }
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onState = ({ roomId, view }: { roomId: string; view: SeatView }) => {
      storeRoom(roomId);
      setStarting(false);
      setError(null);
      setScreen({ name: 'draft', view });
    };
    const onComplete = ({ roomId, pool }: { roomId: string; pool: Card[] }) => {
      storeRoom(roomId);
      setScreen((s) => (s.name === 'deck' ? s : { name: 'deck', pool }));
    };
    const onError = ({ message }: { message: string }) => {
      storeRoom(null);
      setStarting(false);
      setError(message);
      setScreen({ name: 'home' });
    };
    const onConnect = () => {
      const roomId = loadRoom();
      if (roomId) socket.emit('room:resume', { roomId });
    };

    socket.on('draft:state', onState);
    socket.on('draft:complete', onComplete);
    socket.on('practice:error', onError);
    socket.on('connect', onConnect);
    if (socket.connected) onConnect();
    return () => {
      socket.off('draft:state', onState);
      socket.off('draft:complete', onComplete);
      socket.off('practice:error', onError);
      socket.off('connect', onConnect);
    };
  }, []);

  const start = (setCode: string) => {
    setStarting(true);
    setError(null);
    socket.emit('practice:start', { setCode });
  };

  const newDraft = () => {
    storeRoom(null);
    setScreen({ name: 'home' });
  };

  if (screen.name === 'draft') return <p className="muted">Draft screen (Task 9) — pick {screen.view.pickNumber}</p>;
  if (screen.name === 'deck') return <button className="btn" onClick={newDraft}>Deckbuilder (Task 10) — new draft</button>;
  return <Home onStart={start} starting={starting} error={error} />;
}
```

`client/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 9: Verify**

Run: `npm run typecheck` → no errors. Run: `npm test` → server and client tests PASS.
Manual: `npm run dev`, open `http://localhost:5173`. Expected: set dropdown fills with real sets (newest first); clicking **Start practice draft** shows "Draft screen (Task 9) — pick 1". Stop the server process and reload: the error banner with Retry appears.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(client): scaffold, card helpers, home screen"
```

### Task 9: Draft screen

**Files:**
- Create: `client/src/screens/Draft.tsx`
- Modify: `client/src/App.tsx` (replace the draft placeholder), `client/src/styles.css` (append)

**Interfaces:**
- Consumes: `SeatView`, `Card`; `socket` (Task 8); `CardImage`, `groupByColor`, `GROUP_LABEL` (Task 8).
- Produces: `Draft({ view }: { view: SeatView })`. Emits `draft:pick { instanceId }`; ignores further clicks until the next `view` arrives.

- [ ] **Step 1: Implement the screen**

`client/src/screens/Draft.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { Card, SeatView } from '@mtg/shared';
import { CardImage } from '../components/CardImage';
import { GROUP_LABEL, groupByColor } from '../lib/cards';
import { socket } from '../socket';

export function Draft({ view }: { view: SeatView }) {
  const [pending, setPending] = useState(false);
  const [hover, setHover] = useState<Card | null>(null);

  useEffect(() => {
    setPending(false);
    setHover(null);
  }, [view]);

  const pick = (card: Card) => {
    if (pending) return;
    setPending(true);
    socket.emit('draft:pick', { instanceId: card.instanceId });
  };

  return (
    <div className="draft">
      <header className="draft-header">
        <h1>Pack {view.packNumber} · Pick {view.pickNumber}</h1>
        <span className="muted">{view.picks.length} / 45 picked</span>
      </header>
      <div className="draft-body">
        <section>
          {view.currentPack ? (
            <div className="card-grid">
              {view.currentPack.map((c) => (
                <CardImage key={c.instanceId} card={c} onClick={() => pick(c)} disabled={pending} onHover={setHover} />
              ))}
            </div>
          ) : (
            <p className="muted">Waiting for the next pack…</p>
          )}
        </section>
        <aside className="picks">
          <h2>Your picks</h2>
          {view.picks.length === 0 && <p className="muted">Nothing yet. Click a card to pick it.</p>}
          {groupByColor(view.picks).map(({ group, cards }) => (
            <div key={group} className="pick-group">
              <h3>
                {GROUP_LABEL[group]} <span className="muted">{cards.length}</span>
              </h3>
              <ul>
                {cards.map((c) => (
                  <li key={c.instanceId} onMouseEnter={() => setHover(c)} onMouseLeave={() => setHover(null)}>
                    {c.name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>
      </div>
      {hover?.imageUrl && (
        <div className="preview">
          <img src={hover.imageUrl} alt={hover.name} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire into App**

In `client/src/App.tsx`, add the import:
```tsx
import { Draft } from './screens/Draft';
```
and replace:
```tsx
  if (screen.name === 'draft') return <p className="muted">Draft screen (Task 9) — pick {screen.view.pickNumber}</p>;
```
with:
```tsx
  if (screen.name === 'draft') return <Draft view={screen.view} />;
```

- [ ] **Step 3: Append styles**

Append to `client/src/styles.css`:
```css
.draft { padding: 16px; display: grid; gap: 14px; background: var(--felt); min-height: 100vh; }
.draft-header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.draft-body { display: grid; grid-template-columns: 1fr 260px; gap: 16px; align-items: start; }
.picks { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px; position: sticky; top: 16px; max-height: calc(100vh - 32px); overflow: auto; display: grid; gap: 10px; }
.pick-group h3 { font-size: 14px; margin-bottom: 4px; }
.pick-group ul { list-style: none; margin: 0; padding: 0; font-size: 13px; }
.pick-group li { padding: 2px 0; cursor: default; }
.pick-group li:hover { color: var(--accent); }
@media (max-width: 760px) {
  .draft-body { grid-template-columns: 1fr; }
  .picks { position: static; max-height: none; }
  .card-grid { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); }
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck` → no errors.
Manual (`npm run dev`, `http://localhost:5173`): start a draft. Expected:
- 15 card images, header "Pack 1 · Pick 1".
- Clicking a card shows the next pack with 14 cards, header "Pick 2", and the card appears in "Your picks" under its color.
- Hovering a card shows the enlarged preview.
- Reloading the page mid-draft resumes at the same pick.
- After pick 15 the header reads "Pack 2 · Pick 1" with 15 cards.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): draft screen"
```

### Task 10: Deckbuilder screen + end-to-end check

**Files:**
- Create: `client/src/screens/Deckbuilder.tsx`
- Modify: `client/src/App.tsx` (replace the deck placeholder), `client/src/styles.css` (append)

**Interfaces:**
- Consumes: `Card`, `Color`, `COLORS`; `socket` (Task 8); `CardImage`, `BASIC_NAMES`, `buildDecklist`, `deckSize`, `manaCurve` (Task 8). Server `deck:save` (Task 7).
- Produces: `Deckbuilder({ pool, onNewDraft }: { pool: Card[]; onNewDraft: () => void })`.

- [ ] **Step 1: Implement the screen**

`client/src/screens/Deckbuilder.tsx`:
```tsx
import { useState } from 'react';
import { COLORS, type Card, type Color } from '@mtg/shared';
import { CardImage } from '../components/CardImage';
import { BASIC_NAMES, buildDecklist, deckSize, manaCurve } from '../lib/cards';
import { socket } from '../socket';

const MIN_DECK = 40;
const byCurve = (a: Card, b: Card) => a.manaValue - b.manaValue || a.name.localeCompare(b.name);

interface Props {
  pool: Card[];
  onNewDraft: () => void;
}

export function Deckbuilder({ pool, onNewDraft }: Props) {
  const [mainIds, setMainIds] = useState<Set<string>>(() => new Set());
  const [basics, setBasics] = useState<Record<Color, number>>({ W: 0, U: 0, B: 0, R: 0, G: 0 });
  const [hover, setHover] = useState<Card | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const main = pool.filter((c) => mainIds.has(c.instanceId)).sort(byCurve);
  const side = pool.filter((c) => !mainIds.has(c.instanceId)).sort(byCurve);
  const total = deckSize(main, basics);
  const curve = manaCurve(main);
  const curveMax = Math.max(1, ...curve);
  const decklist = buildDecklist(main, side, basics);

  const toggle = (card: Card) => {
    setStatus(null);
    setMainIds((prev) => {
      const next = new Set(prev);
      if (next.has(card.instanceId)) next.delete(card.instanceId);
      else next.add(card.instanceId);
      return next;
    });
  };

  const adjust = (color: Color, delta: number) => {
    setStatus(null);
    setBasics((b) => ({ ...b, [color]: Math.max(0, b[color] + delta) }));
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(decklist);
      setStatus('Decklist copied to clipboard');
    } catch {
      setStatus('Copy failed. Use Download instead.');
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([decklist], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'practice-deck.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const save = async () => {
    try {
      const res = await socket.timeout(5_000).emitWithAck('deck:save', { main: [...mainIds], basics });
      setStatus(res.ok ? 'Deck saved' : 'Save failed');
    } catch {
      setStatus('Save failed: server did not respond');
    }
  };

  return (
    <div className="deck">
      <header className="deck-header">
        <div>
          <h1>Deckbuilder</h1>
          <span className={total < MIN_DECK ? 'warn' : 'muted'}>
            {total} cards{total < MIN_DECK ? ` (minimum ${MIN_DECK})` : ''}
          </span>
        </div>
        <div className="deck-actions">
          <button className="btn" onClick={copy}>Export</button>
          <button className="btn" onClick={download}>Download</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
          <button className="btn" onClick={onNewDraft}>New draft</button>
        </div>
      </header>
      {status && <p className="muted">{status}</p>}

      <div className="deck-tools">
        <div className="basics">
          {COLORS.map((c) => (
            <div key={c} className="basic">
              <span>{BASIC_NAMES[c]}</span>
              <button className="btn" onClick={() => adjust(c, -1)} aria-label={`Remove ${BASIC_NAMES[c]}`}>−</button>
              <span className="basic-count">{basics[c]}</span>
              <button className="btn" onClick={() => adjust(c, 1)} aria-label={`Add ${BASIC_NAMES[c]}`}>+</button>
            </div>
          ))}
        </div>
        <div className="curve" aria-label="Mana curve">
          {curve.map((n, i) => (
            <div key={i} className="curve-col">
              <span className="curve-n">{n}</span>
              <div className="curve-bar" style={{ height: `${(n / curveMax) * 80}px` }} />
              <span className="muted">{i === 6 ? '6+' : i}</span>
            </div>
          ))}
        </div>
      </div>

      <section>
        <h2>Main deck <span className="muted">{main.length} + {total - main.length} basics</span></h2>
        {main.length === 0 && <p className="muted">Click cards in your pool to add them.</p>}
        <div className="card-grid small">
          {main.map((c) => <CardImage key={c.instanceId} card={c} onClick={() => toggle(c)} onHover={setHover} />)}
        </div>
      </section>

      <section>
        <h2>Pool <span className="muted">{side.length}</span></h2>
        <div className="card-grid small">
          {side.map((c) => <CardImage key={c.instanceId} card={c} onClick={() => toggle(c)} onHover={setHover} />)}
        </div>
      </section>

      {hover?.imageUrl && (
        <div className="preview">
          <img src={hover.imageUrl} alt={hover.name} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire into App**

In `client/src/App.tsx`, add the import:
```tsx
import { Deckbuilder } from './screens/Deckbuilder';
```
and replace:
```tsx
  if (screen.name === 'deck') return <button className="btn" onClick={newDraft}>Deckbuilder (Task 10) — new draft</button>;
```
with:
```tsx
  if (screen.name === 'deck') return <Deckbuilder pool={screen.pool} onNewDraft={newDraft} />;
```

- [ ] **Step 3: Append styles**

Append to `client/src/styles.css`:
```css
.deck { padding: 16px; display: grid; gap: 16px; background: var(--felt); min-height: 100vh; }
.deck-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.deck-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.deck section h2 { font-size: 16px; margin-bottom: 8px; }
.warn { color: var(--danger); }
.deck-tools { display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-end; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
.basics { display: grid; gap: 6px; }
.basic { display: grid; grid-template-columns: 80px 32px 28px 32px; align-items: center; gap: 6px; }
.basic .btn { padding: 2px 0; }
.basic-count { text-align: center; }
.curve { display: flex; gap: 10px; align-items: flex-end; height: 120px; }
.curve-col { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 12px; }
.curve-bar { width: 22px; background: var(--accent); border-radius: 3px 3px 0 0; min-height: 2px; }
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck` and `npm test` → all pass.
Manual end-to-end (`npm run dev`, `http://localhost:5173`):
1. Pick a recent set and start. Draft all 45 picks. The Deckbuilder opens with 45 cards in Pool.
2. Click 23 cards → they move to Main deck, and the curve updates. Add 17 basics with +. The count reads "40 cards" with no warning; at 39 the warning shows.
3. **Export**: paste the clipboard text somewhere. It should list the main deck with counts and basics, a blank line, `Sideboard`, then 22 cards.
4. **Download** saves `practice-deck.txt` with the same text. **Save** shows "Deck saved".
5. Reload the page. You come back to the Deckbuilder (your deck selection resets, which is acceptable for practice mode).
6. **New draft** returns to Home.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): deckbuilder with curve, basics and export"
```

---

## Spec coverage

| Spec requirement | Task |
|---|---|
| Scryfall set list (filter, newest first, 24h cache) | 2 |
| Booster cards + basics + fallback, disk cache, headers, rate limit | 2 |
| Double-faced cards use front face | 2 |
| Pack layout, mythic 1/8, no duplicates, rarity fallback | 3 |
| 3×15 draft, pass L/R/L, unique instance ids, invalid picks rejected | 4 |
| Bot scoring + color commitment + seedable jitter | 5 |
| 8 seats (1 human), 30-minute room expiry, deck save validation | 6 |
| Socket events, invalid pick re-emit, resume, errors | 7 |
| Home with set picker + error/Retry | 8 |
| Draft screen (grid, preview, picks by color, pending lock) | 9 |
| Deckbuilder (move cards, basics, 40-card warning, curve, export/download/save) | 10 |
| Unit + integration tests, no network | 1–8 |
