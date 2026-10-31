import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SetCards, SetInfo } from '@mtg/shared';
import { ScryfallError, type ScryfallClient } from './client';
import { mapScryfallCard, type ScryfallCard } from './scryfall';

export interface CardSource {
  getSetCards(code: string): Promise<SetCards>;
  listDraftableSets(): Promise<SetInfo[]>;
}

export const FALLBACK_BASICS_SET = 'fdn'; // Foundations: most recent core-style set
const BASIC_NAMES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
const DRAFTABLE_TYPES = ['expansion', 'core', 'draft_innovation'];
const DAY_MS = 24 * 3600 * 1000;

function pickBasics(raw: ScryfallCard[]) {
  return BASIC_NAMES.map((name) => raw.find((c) => c.name === name))
    .filter((c): c is ScryfallCard => !!c)
    .map(mapScryfallCard);
}

export function createCardSource(opts: {
  client: ScryfallClient;
  cacheDir: string;
  now?: () => number;
  today?: () => string;
}): CardSource {
  const { client, cacheDir } = opts;
  const now = opts.now ?? Date.now;
  const today = opts.today ?? (() => new Date().toISOString().slice(0, 10));
  let setsCache: { at: number; sets: SetInfo[] } | null = null;

  return {
    async getSetCards(rawCode) {
      const code = rawCode.toLowerCase();
      if (!/^[a-z0-9]{2,6}$/.test(code)) throw new ScryfallError(`Unknown set "${rawCode}"`);
      const file = join(cacheDir, `${code}.json`);
      if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as SetCards;

      const booster = await client.searchAll(`set:${code} is:booster`);
      const cards = booster.filter((c) => !c.type_line.includes('Basic Land')).map(mapScryfallCard);
      if (cards.length === 0) throw new ScryfallError(`No booster cards found for set "${code}"`);
      let basics = pickBasics(await client.searchAll(`set:${code} type:basic`));
      if (basics.length === 0) basics = pickBasics(await client.searchAll(`set:${FALLBACK_BASICS_SET} type:basic`));

      const result: SetCards = { cards, basics };
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(file, JSON.stringify(result));
      return result;
    },

    async listDraftableSets() {
      if (setsCache && now() - setsCache.at < DAY_MS) return setsCache.sets;
      const t = today();
      const sets = (await client.listSets())
        .filter((s) => DRAFTABLE_TYPES.includes(s.set_type) && !s.digital && !!s.released_at && s.released_at <= t)
        .sort((a, b) => (b.released_at! > a.released_at! ? 1 : -1))
        .map((s) => ({ code: s.code, name: s.name, releasedAt: s.released_at!, iconSvgUri: s.icon_svg_uri }));
      setsCache = { at: now(), sets };
      return sets;
    },
  };
}
