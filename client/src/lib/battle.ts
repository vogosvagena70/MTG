import type { RosterPlayer } from '@mtg/shared';

export function canChallenge(me: RosterPlayer | undefined, target: RosterPlayer): boolean {
  if (!me || target.isYou || target.playerId === me.playerId) return false;
  if (!me.deckSaved || me.inGame) return false;
  return target.deckSaved && !target.inGame && target.connected;
}

export function secondsUntil(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

const clampPct = (n: number) => Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;

export function dropPosition(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 50, y: 50 };
  return {
    x: clampPct(((clientX - rect.left) / rect.width) * 100),
    y: clampPct(((clientY - rect.top) / rect.height) * 100),
  };
}

export function actionErrorText(res: { ok: boolean; message?: string }): string | null {
  return res.ok ? null : res.message || 'Action failed';
}
