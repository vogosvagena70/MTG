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
