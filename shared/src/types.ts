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

export type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile';

export interface GameCard {
  gid: string;
  card: Card;
  owner: 0 | 1;
  tapped: boolean;
  x: number;
  y: number;
  /** A plain counter tally on a battlefield card (may be negative); purely a marker, no rules effect. */
  counters: number;
  /** Set for player-made tokens (no image); a token ceases to exist when it leaves the battlefield. */
  token?: { power: string; toughness: string };
}

export type GameAction =
  | { type: 'draw'; count: number }
  /** `bottom` applies when moving to the library: bottom instead of top. */
  | { type: 'move'; gid: string; to: Zone; x?: number; y?: number; bottom?: boolean }
  | { type: 'tap'; gid: string; tapped: boolean }
  | { type: 'untapAll' }
  | { type: 'shuffle' }
  | { type: 'mulligan' }
  | { type: 'life'; delta: number }
  | { type: 'concede' }
  /** Add (positive) or remove (negative) counters on one of your battlefield cards. */
  | { type: 'counters'; gid: string; delta: number }
  /** Create a token on your battlefield. Power/toughness are short labels such as "2", "*" or "X". */
  | { type: 'token'; name: string; power: string; toughness: string }
  /** Open your top `count` library cards (only you see them); they can then be moved like any other card. */
  | { type: 'searchTop'; count: number }
  /** Open your whole library. */
  | { type: 'searchLibrary' }
  /** Close the open library window. */
  | { type: 'closeLibrary' };

export interface GameView {
  gameId: string;
  you: 0 | 1;
  firstPlayer: 0 | 1;
  over: null | { conceded: 0 | 1 };
  log: { at: number; text: string }[];
  me: {
    name: string; life: number; hand: GameCard[]; battlefield: GameCard[]; graveyard: GameCard[]; exile: GameCard[]; libraryCount: number;
    /** The open library window: top-X cards in library order, or the whole library sorted by name. */
    peek: { mode: 'top' | 'search'; cards: GameCard[] } | null;
  };
  opp: { name: string; life: number; connected: boolean; handCount: number; battlefield: GameCard[]; graveyard: GameCard[]; exile: GameCard[]; libraryCount: number };
}

export interface RosterPlayer {
  playerId: string;
  name: string;
  deckSaved: boolean;
  inGame: boolean;
  connected: boolean;
  isYou: boolean;
}

export interface IncomingChallenge {
  fromPlayerId: string;
  fromName: string;
  expiresAt: number;
}
