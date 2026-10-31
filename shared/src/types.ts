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

export type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard';

export interface GameCard {
  gid: string;
  card: Card;
  owner: 0 | 1;
  tapped: boolean;
  x: number;
  y: number;
}

export type GameAction =
  | { type: 'draw'; count: number }
  | { type: 'move'; gid: string; to: Zone; x?: number; y?: number }
  | { type: 'tap'; gid: string; tapped: boolean }
  | { type: 'untapAll' }
  | { type: 'shuffle' }
  | { type: 'mulligan' }
  | { type: 'life'; delta: number }
  | { type: 'concede' };

export interface GameView {
  gameId: string;
  you: 0 | 1;
  firstPlayer: 0 | 1;
  over: null | { conceded: 0 | 1 };
  log: { at: number; text: string }[];
  me: { name: string; life: number; hand: GameCard[]; battlefield: GameCard[]; graveyard: GameCard[]; libraryCount: number };
  opp: { name: string; life: number; connected: boolean; handCount: number; battlefield: GameCard[]; graveyard: GameCard[]; libraryCount: number };
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
