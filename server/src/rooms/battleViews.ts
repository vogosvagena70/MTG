import type { RosterPlayer } from '@mtg/shared';
import type { Battles } from './battles';
import type { Room } from './manager';

export function rosterFor(room: Room, battles: Battles, playerId: string): RosterPlayer[] {
  return room.players.map((p) => ({
    playerId: p.playerId,
    name: p.name,
    deckSaved: room.decks.has(p.playerId),
    inGame: battles.gameFor(p.playerId) !== undefined,
    connected: p.socketId !== null,
    isYou: p.playerId === playerId,
  }));
}
