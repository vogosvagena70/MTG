import type { RosterPlayer } from '@mtg/shared';

export function canChallenge(me: RosterPlayer | undefined, target: RosterPlayer): boolean {
  if (!me || target.isYou || target.playerId === me.playerId) return false;
  if (!me.deckSaved || me.inGame) return false;
  return target.deckSaved && !target.inGame && target.connected;
}

export function secondsUntil(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}
