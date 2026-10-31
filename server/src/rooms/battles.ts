import { randomUUID } from 'node:crypto';
import type { IncomingChallenge } from '@mtg/shared';
import { applyAction, parseAction } from '../game/actions';
import { buildGame } from '../game/build';
import type { GameState } from '../game/state';
import { RoomError, seatIndexOf, type Room, type RoomManager } from './manager';
import { realScheduler, type Scheduler } from './scheduler';

export const CHALLENGE_TTL_MS = 60_000;
export const ENDED_GAME_TTL_MS = 5 * 60_000;

export interface LiveGame {
  state: GameState;
  roomId: string;
  left: [boolean, boolean];
}

interface Challenge {
  roomId: string;
  fromPlayerId: string;
  toPlayerId: string;
  expiresAt: number;
  timer: unknown;
}

export interface BattlesDeps {
  manager: RoomManager;
  now?: () => number;
  scheduler?: Scheduler;
  seed?: () => number;
  onChange: (room: Room) => void;
  onDeclined: (room: Room, challengerId: string, byName: string, reason: 'declined' | 'expired') => void;
  onGameEnded: (playerIds: string[]) => void;
}

export class Battles {
  private now: () => number;
  private scheduler: Scheduler;
  private seed: () => number;
  private games = new Map<string, LiveGame>(); // by game id
  private gameByPlayer = new Map<string, LiveGame>(); // only players who have not left
  private endTimers = new Map<string, unknown>(); // game id -> handle
  private challengeByTo = new Map<string, Challenge>();
  private challengeByFrom = new Map<string, Challenge>();

  constructor(private deps: BattlesDeps) {
    this.now = deps.now ?? Date.now;
    this.scheduler = deps.scheduler ?? realScheduler;
    this.seed = deps.seed ?? (() => Math.floor(Math.random() * 2 ** 32));
  }

  challenge(roomId: string, fromPlayerId: string, toPlayerId: string): void {
    const room = this.deps.manager.get(roomId);
    if (room.practice || room.phase !== 'complete') {
      throw new RoomError('Battles are only available after a multiplayer draft');
    }
    if (fromPlayerId === toPlayerId) throw new RoomError("You can't challenge yourself");
    const from = room.players.find((p) => p.playerId === fromPlayerId);
    if (!from) throw new RoomError('You are not seated in this draft');
    const to = room.players.find((p) => p.playerId === toPlayerId);
    if (!to) throw new RoomError('Player not found');
    if (!room.decks.has(fromPlayerId)) throw new RoomError('Save your deck first');
    if (!room.decks.has(toPlayerId)) throw new RoomError(`${to.name} hasn't saved a deck yet`);
    if (this.isBusy(toPlayerId)) throw new RoomError(`${to.name} is busy`);
    if (this.isBusy(fromPlayerId)) throw new RoomError('You are already in a game or challenge');

    const ch: Challenge = {
      roomId,
      fromPlayerId,
      toPlayerId,
      expiresAt: this.now() + CHALLENGE_TTL_MS,
      timer: null,
    };
    ch.timer = this.scheduler.setTimeout(() => this.safely('challenge expiry', () => this.expire(ch)), CHALLENGE_TTL_MS);
    this.challengeByTo.set(toPlayerId, ch);
    this.challengeByFrom.set(fromPlayerId, ch);
  }

  respond(roomId: string, playerId: string, accept: boolean): void {
    const ch = this.challengeByTo.get(playerId);
    if (!ch || ch.roomId !== roomId) throw new RoomError('No pending challenge');
    this.clearChallenge(ch);
    const room = this.deps.manager.get(roomId);
    const me = room.players.find((p) => p.playerId === playerId);
    const from = room.players.find((p) => p.playerId === ch.fromPlayerId);
    if (!me || !from) throw new RoomError('Player not found');
    if (!accept) {
      this.deps.onDeclined(room, ch.fromPlayerId, me.name, 'declined');
      return;
    }
    let state: GameState;
    try {
      state = this.build(room, from.playerId, me.playerId);
    } catch (err) {
      this.deps.onDeclined(room, ch.fromPlayerId, me.name, 'declined');
      throw err;
    }
    const game: LiveGame = { state, roomId, left: [false, false] };
    this.games.set(state.id, game);
    this.gameByPlayer.set(from.playerId, game);
    this.gameByPlayer.set(me.playerId, game);
    this.deps.onChange(room);
  }

  act(roomId: string, playerId: string, raw: unknown): void {
    const room = this.deps.manager.get(roomId);
    const game = this.gameByPlayer.get(playerId);
    if (!game || game.roomId !== roomId) throw new RoomError('You are not in a game');
    const seat = this.seatOf(game, playerId);
    game.state = applyAction(game.state, seat, parseAction(raw), this.now());
    this.afterChange(game);
    this.deps.onChange(room);
  }

  leaveGame(roomId: string, playerId: string): void {
    const room = this.deps.manager.get(roomId);
    const game = this.gameByPlayer.get(playerId);
    if (!game || game.roomId !== roomId) throw new RoomError('You are not in a game');
    const seat = this.seatOf(game, playerId);
    if (!game.state.over) {
      game.state = applyAction(game.state, seat, { type: 'concede' }, this.now());
      this.afterChange(game);
    }
    game.left[seat] = true;
    this.gameByPlayer.delete(playerId);
    if (game.left[0] && game.left[1]) this.deleteGame(game);
    this.deps.onGameEnded([playerId]);
    this.deps.onChange(room);
  }

  gameFor(playerId: string): LiveGame | undefined {
    return this.gameByPlayer.get(playerId);
  }

  incomingFor(playerId: string): IncomingChallenge | null {
    const ch = this.challengeByTo.get(playerId);
    if (!ch) return null;
    const from = this.deps.manager.peek(ch.roomId)?.players.find((p) => p.playerId === ch.fromPlayerId);
    if (!from) return null;
    return { fromPlayerId: from.playerId, fromName: from.name, expiresAt: ch.expiresAt };
  }

  sweep(): void {
    for (const ch of [...this.challengeByTo.values()]) {
      if (!this.deps.manager.peek(ch.roomId)) this.clearChallenge(ch);
    }
    for (const game of [...this.games.values()]) {
      if (!this.deps.manager.peek(game.roomId)) this.deleteGame(game);
    }
  }

  // ---- internals ----

  private isBusy(playerId: string): boolean {
    return (
      this.gameByPlayer.has(playerId) || this.challengeByTo.has(playerId) || this.challengeByFrom.has(playerId)
    );
  }

  private seatOf(game: LiveGame, playerId: string): 0 | 1 {
    return game.state.players[0].playerId === playerId ? 0 : 1;
  }

  private build(room: Room, aId: string, bId: string): GameState {
    const player = (id: string) => {
      const p = room.players.find((x) => x.playerId === id)!;
      const deck = room.decks.get(id);
      if (!deck) throw new RoomError(`${p.name} hasn't saved a deck yet`);
      return { playerId: id, name: p.name, pool: room.state!.picks[seatIndexOf(room, id)], deck };
    };
    return buildGame({
      id: randomUUID(),
      roomId: room.id,
      seed: this.seed(),
      now: this.now(),
      basics: room.set.basics,
      players: [player(aId), player(bId)],
    });
  }

  /** Starts the post-game cleanup timer the first time a game is over. */
  private afterChange(game: LiveGame): void {
    if (!game.state.over || this.endTimers.has(game.state.id)) return;
    const handle = this.scheduler.setTimeout(
      () => this.safely('ended game cleanup', () => this.expireGame(game)),
      ENDED_GAME_TTL_MS,
    );
    this.endTimers.set(game.state.id, handle);
  }

  private expireGame(game: LiveGame): void {
    if (this.games.get(game.state.id) !== game) return;
    this.endTimers.delete(game.state.id);
    const stillIn = game.state.players.filter((_, i) => !game.left[i]).map((p) => p.playerId);
    this.deleteGame(game);
    if (stillIn.length) this.deps.onGameEnded(stillIn);
  }

  private deleteGame(game: LiveGame): void {
    const timer = this.endTimers.get(game.state.id);
    if (timer !== undefined) this.scheduler.clearTimeout(timer);
    this.endTimers.delete(game.state.id);
    this.games.delete(game.state.id);
    for (const p of game.state.players) {
      if (this.gameByPlayer.get(p.playerId) === game) this.gameByPlayer.delete(p.playerId);
    }
  }

  private expire(ch: Challenge): void {
    if (this.challengeByTo.get(ch.toPlayerId) !== ch) return;
    this.clearChallenge(ch);
    const room = this.deps.manager.peek(ch.roomId);
    const to = room?.players.find((p) => p.playerId === ch.toPlayerId);
    if (room && to) this.deps.onDeclined(room, ch.fromPlayerId, to.name, 'expired');
  }

  private clearChallenge(ch: Challenge): void {
    this.scheduler.clearTimeout(ch.timer);
    if (this.challengeByTo.get(ch.toPlayerId) === ch) this.challengeByTo.delete(ch.toPlayerId);
    if (this.challengeByFrom.get(ch.fromPlayerId) === ch) this.challengeByFrom.delete(ch.fromPlayerId);
  }

  private safely(label: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error(`[battles] ${label} failed`, err);
    }
  }
}
