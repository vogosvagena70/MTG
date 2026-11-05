import type { GameCard, PeekMode, Zone } from '@mtg/shared';
import type { Rng } from '../rng';

export interface PlayerState {
  playerId: string;
  name: string;
  life: number;
  zones: Record<Zone, string[]>; // gids; library[0] is the top
  /** Library cards this player is currently allowed to see and move; absent when no window is open. */
  peek?: { mode: PeekMode; gids: string[] };
}

export interface GameState {
  id: string;
  roomId: string;
  players: [PlayerState, PlayerState];
  cards: Record<string, GameCard>;
  firstPlayer: 0 | 1;
  log: { at: number; text: string }[];
  over: null | { conceded: 0 | 1 };
  rng: Rng;
  /** Tokens created so far, for unique token gids ("t1", "t2", …). */
  tokenCount?: number;
}

export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameError';
  }
}

export const MAX_LOG = 100;

export function appendLog(state: GameState, text: string, now: number): GameState['log'] {
  return [...state.log, { at: now, text }].slice(-MAX_LOG);
}

export function shuffleInPlace<T>(ids: T[], rng: Rng): void {
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
}
