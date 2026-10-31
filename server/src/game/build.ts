import { COLORS, type Card, type Color, type DeckSavePayload, type GameCard } from '@mtg/shared';
import { mulberry32 } from '../rng';
import { GameError, appendLog, shuffleInPlace, type GameState, type PlayerState } from './state';

export interface BuildPlayer {
  playerId: string;
  name: string;
  pool: Card[];
  deck: DeckSavePayload;
}

const BASIC_NAMES: Record<Color, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
export const DECK_MIN = 40;
const HAND_SIZE = 7;

function basicFor(color: Color, basics: Card[]): Card {
  const name = BASIC_NAMES[color];
  const found = basics.find((b) => b.name === name);
  if (found) return found;
  return {
    instanceId: '', scryfallId: `basic-${name.toLowerCase()}`, name, manaCost: '', manaValue: 0, colors: [],
    typeLine: `Basic Land — ${name}`, oracleText: '', rarity: 'common', imageUrl: '',
  };
}

/** Total cards in a saved deck (main plus basic lands). */
export function deckSize(deck: DeckSavePayload): number {
  let n = deck.main.length;
  for (const color of COLORS) n += Math.max(0, Math.floor(deck.basics?.[color] ?? 0));
  return n;
}

function deckCards(p: BuildPlayer, basics: Card[]): Card[] {
  const byId = new Map(p.pool.map((c) => [c.instanceId, c]));
  const cards: Card[] = [];
  for (const id of p.deck.main) {
    const c = byId.get(id);
    if (!c) throw new GameError('Deck contains cards that are not in your pool');
    cards.push(c);
  }
  for (const color of COLORS) {
    const n = Math.max(0, Math.floor(p.deck.basics?.[color] ?? 0));
    const basic = basicFor(color, basics);
    for (let i = 0; i < n; i++) cards.push(basic);
  }
  if (cards.length < DECK_MIN) throw new GameError('Deck must have at least 40 cards');
  return cards;
}

export function buildGame(input: {
  id: string;
  roomId: string;
  seed: number;
  now: number;
  basics: Card[];
  players: [BuildPlayer, BuildPlayer];
}): GameState {
  const decks = [deckCards(input.players[0], input.basics), deckCards(input.players[1], input.basics)];
  const rng = mulberry32(input.seed);
  const cards: Record<string, GameCard> = {};
  let n = 0;
  const players = input.players.map((p, seat) => {
    const library: string[] = [];
    for (const card of decks[seat]) {
      const gid = `g${++n}`;
      cards[gid] = { gid, card, owner: seat as 0 | 1, tapped: false, x: 50, y: 50 };
      library.push(gid);
    }
    return { playerId: p.playerId, name: p.name, life: 20, zones: { library, hand: [], battlefield: [], graveyard: [] } } as PlayerState;
  }) as [PlayerState, PlayerState];

  for (const p of players) shuffleInPlace(p.zones.library, rng);
  for (const p of players) p.zones.hand = p.zones.library.splice(0, HAND_SIZE);

  const firstPlayer: 0 | 1 = rng() < 0.5 ? 0 : 1;
  const state: GameState = {
    id: input.id, roomId: input.roomId, players, cards, firstPlayer, log: [], over: null, rng,
  };
  state.log = appendLog(state, `${players[firstPlayer].name} goes first`, input.now);
  return state;
}
