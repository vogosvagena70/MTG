import type { Card, DraftStatePayload, LobbyView, TableSeat } from '@mtg/shared';
import { seatView } from '../draft/engine';
import { seatIndexOf, type Room } from './manager';

export function lobbyView(room: Room): LobbyView {
  return {
    code: room.code,
    setCode: room.setCode,
    setName: room.setName,
    timerSeconds: room.timerSeconds,
    hostPlayerId: room.hostPlayerId,
    players: room.players.map((p) => ({ playerId: p.playerId, name: p.name, connected: p.socketId !== null })),
  };
}

export function tableView(room: Room, playerId: string): TableSeat[] {
  let bots = 0;
  return room.seats.map((seat, i) => {
    const picked = room.state?.pickedThisTurn[i] ?? false;
    if (seat.kind === 'bot') {
      bots++;
      return { name: `Bot ${bots}`, isBot: true, picked, connected: true, isYou: false };
    }
    return { name: seat.name, isBot: false, picked, connected: seat.socketId !== null, isYou: seat.playerId === playerId };
  });
}

export function draftStateFor(room: Room, playerId: string): DraftStatePayload {
  const seat = seatIndexOf(room, playerId);
  return {
    code: room.code,
    view: seatView(room.state!, seat),
    pickDeadline: room.pickDeadline,
    table: tableView(room, playerId),
  };
}

export function completeFor(room: Room, playerId: string): { code: string; pool: Card[] } {
  const seat = seatIndexOf(room, playerId);
  return { code: room.code, pool: room.state!.picks[seat] };
}
