import { COLORS, type Card, type Color, type DeckSavePayload, type SetCards } from '@mtg/shared';
import { generatePack } from '../packs/generatePack';
import { mulberry32, type Rng } from '../rng';
import { buildGame, type BuildPlayer } from './build';
import type { GameState } from './state';

const SPELLS = 23;
const LANDS = 17;
const PACKS = 3;

/** A quick random 40-card deck: 3 packs, the two most common colors, 23 spells + 17 basics. */
function randomDeck(set: SetCards, rng: Rng, prefix: string): { pool: Card[]; deck: DeckSavePayload } {
  const pool: Card[] = [];
  for (let p = 0; p < PACKS; p++) {
    for (const c of generatePack(set, rng)) {
      if (c.typeLine.includes('Basic Land')) continue;
      pool.push({ ...c, instanceId: `${prefix}${pool.length + 1}` });
    }
  }
  const counts = new Map<Color, number>(COLORS.map((c) => [c, 0]));
  for (const c of pool) for (const col of c.colors) counts.set(col, (counts.get(col) ?? 0) + 1);
  const [a, b] = [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([c]) => c);
  const fits = (c: Card) => c.colors.every((col) => col === a || col === b);
  const ordered = [...pool.filter(fits), ...pool.filter((c) => !fits(c))];
  const main = ordered.slice(0, SPELLS).map((c) => c.instanceId);
  const basics: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const lands = LANDS + Math.max(0, SPELLS - main.length); // tiny sets: top up with lands
  basics[a] = Math.ceil(lands / 2);
  basics[b] = lands - basics[a];
  return { pool, deck: { main, basics } };
}

/** A solo test game: you (seat 0) against an opponent who never acts. */
export function buildSandboxGame(input: { set: SetCards; seed: number; now: number; name: string; id: string }): GameState {
  const rng = mulberry32(input.seed);
  const me = randomDeck(input.set, rng, 'a');
  const opp = randomDeck(input.set, rng, 'b');
  const players: [BuildPlayer, BuildPlayer] = [
    { playerId: 'sandbox-you', name: input.name, ...me },
    { playerId: 'sandbox-opp', name: 'Test opponent', ...opp },
  ];
  return buildGame({ id: input.id, roomId: '', seed: input.seed, now: input.now, basics: input.set.basics, players });
}
