import type { SessionInfo } from '@mtg/shared';

const SESSION_KEY = 'mtg.session';
const NAME_KEY = 'mtg.name';

export function parseSession(raw: string | null): SessionInfo | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SessionInfo> | null;
    if (v && typeof v.code === 'string' && typeof v.playerId === 'string' && typeof v.token === 'string') {
      return { code: v.code, playerId: v.playerId, token: v.token };
    }
  } catch {
    // fall through
  }
  return null;
}

export function roomCodeFromUrl(search: string): string {
  const code = new URLSearchParams(search).get('room');
  return code ? code.trim().toUpperCase().slice(0, 4) : '';
}

export function secondsLeft(deadline: number | null, now: number): number | null {
  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable: resume just won't work
  }
}

export const loadSession = () => parseSession(read(SESSION_KEY));
export const saveSession = (s: SessionInfo | null) => write(SESSION_KEY, s ? JSON.stringify(s) : null);
export const loadName = () => read(NAME_KEY) ?? '';
export const saveName = (name: string) => write(NAME_KEY, name);
