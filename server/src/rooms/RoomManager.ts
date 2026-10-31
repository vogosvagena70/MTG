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
