import { randomBytes } from 'node:crypto';
import type { Rng } from '../rng';

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}$/;
const MAX_NAME = 20;

export function generateCode(rng: Rng, isTaken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
    if (!isTaken(code)) return code;
  }
  throw new Error('Could not allocate a room code');
}

export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME).trim();
  return name.length > 0 ? name : null;
}

export function uniqueName(name: string, taken: string[]): string {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

export function newToken(): string {
  return randomBytes(16).toString('hex');
}
