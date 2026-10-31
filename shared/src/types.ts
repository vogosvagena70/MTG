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
