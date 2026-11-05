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
  /** Regular counters on a battlefield card (loyalty, charge, ...), never below 0. A marker with no rules effect. */
  counters: number;
  /** Running power/toughness counter totals, e.g. +2/+0. A marker: the card's stats do not change. */
  ptCounters: { power: number; toughness: number };
  /** Set for player-made tokens (no image); a token ceases to exist when it leaves the battlefield. */
  token?: { power?: string; toughness?: string };
  /** Face down: the opponent gets a masked copy of this card, with no name, image, token details or counters. */
  faceDown?: boolean;
}

export type GameAction =
  | { type: 'draw'; count: number }
  /** `bottom` applies when moving to the library: bottom instead of top. */
  | { type: 'move'; gid: string; to: Zone; x?: number; y?: number; bottom?: boolean }
  | { type: 'tap'; gid: string; tapped: boolean }
  | { type: 'untapAll' }
  | { type: 'shuffle' }
  | { type: 'life'; delta: number }
  | { type: 'concede' }
  /** Change the regular counters on one of your battlefield cards. */
  | { type: 'counters'; gid: string; delta: number }
  /** Add to the power/toughness counter totals of one of your battlefield cards (negative subtracts). */
  | { type: 'ptCounters'; gid: string; power: number; toughness: number }
  /** Create a token on your battlefield. Power/toughness are short labels ("2", "*", "X"): both or neither. */
  | { type: 'token'; name: string; description?: string; power?: string; toughness?: string }
  /** Turn one of your cards face down or back up. */
  | { type: 'flip'; gid: string }
  /** Open your top `count` library cards (only you see them); they can then be moved like any other card. */
  | { type: 'searchTop'; count: number }
  /** Look at your top `count` cards to put each on the top or bottom (the window is labelled Scry). */
  | { type: 'scry'; count: number }
  /** Look at your top `count` cards to put each on top or into the graveyard (the window is labelled Surveil). */
  | { type: 'surveil'; count: number }
  /**
   * Reorder the cards in your open library window. `gids` lists every card in the window in its new order; they
   * swap among the library positions they already hold, so cards on top stay on top and cards on the bottom stay there.
   */
  | { type: 'arrangeLibrary'; gids: string[] }
  /** Take one of your opponent's battlefield cards onto your side. It still belongs to them. */
  | { type: 'gainControl'; gid: string }
  /** Hand one of your battlefield cards to your opponent's side (back to its owner, or a gift). */
  | { type: 'giveControl'; gid: string }
  /** Open your whole library. */
  | { type: 'searchLibrary' }
  /** Close the open library window. */
  | { type: 'closeLibrary' };

/** What the open library window is for: the top X cards, the whole library, or a scry/surveil. */
export type PeekMode = 'top' | 'search' | 'scry' | 'surveil';

export interface GameView {
  gameId: string;
  you: 0 | 1;
  firstPlayer: 0 | 1;
  over: null | { conceded: 0 | 1 };
  log: { at: number; text: string }[];
  me: {
    name: string; life: number; hand: GameCard[]; battlefield: GameCard[]; graveyard: GameCard[]; exile: GameCard[]; libraryCount: number;
    /** The open library window, in library order (first = top): the top X cards or the whole library. */
    peek: {
      mode: PeekMode;
      cards: GameCard[];
      /** How many of `cards` sit together at the very top of the library; any after them were put further down. */
      topCount: number;
    } | null;
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
