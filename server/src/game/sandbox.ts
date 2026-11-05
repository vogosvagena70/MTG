import { COLORS, type Card, type Color, type DeckSavePayload, type GameAction, type SetCards } from '@mtg/shared';
import { generatePack } from '../packs/generatePack';
import { mulberry32, type Rng } from '../rng';
import { applyAction } from './actions';
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
  const game = buildGame({ id: input.id, roomId: '', seed: input.seed, now: input.now, basics: input.set.basics, players });
  return { ...withOpponentBoard(game, input.now), log: game.log };
}

/** Puts sample cards on the idle opponent's side, so every way a card can look is on the table. */
function withOpponentBoard(start: GameState, now: number): GameState {
  const OPP = 1;
  let g = start;
  const act = (action: GameAction) => (g = applyAction(g, OPP, action, now));
  // draw what gets played below, so the opponent still holds a full opening hand
  act({ type: 'draw', count: 7 });
  act({ type: 'draw', count: 3 });
  const take = () => g.players[OPP].zones.hand[0];
  const play = (
    x: number,
    y: number,
    state: { tapped?: boolean; faceDown?: boolean; counters?: number; pt?: [number, number] } = {},
  ) => {
    const gid = take();
    if (state.faceDown) act({ type: 'flip', gid });
    act({ type: 'move', gid, to: 'battlefield', x, y });
    if (state.tapped) act({ type: 'tap', gid, tapped: true });
    if (state.counters) act({ type: 'counters', gid, delta: state.counters });
    if (state.pt) act({ type: 'ptCounters', gid, power: state.pt[0], toughness: state.pt[1] });
  };
  play(20, 30, { counters: 3, pt: [2, 1] });
  play(40, 30);
  play(60, 30, { tapped: true });
  play(80, 30, { tapped: true });
  play(30, 70, { faceDown: true, counters: 1, pt: [-1, -1] });
  play(70, 70, { faceDown: true, tapped: true });
  for (const to of ['graveyard', 'graveyard', 'exile', 'exile'] as const) act({ type: 'move', gid: take(), to });
  return g;
}
