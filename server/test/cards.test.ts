import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { mapScryfallCard, type ScryfallCard } from '../src/cards/scryfall';
import { createScryfallClient, ScryfallError } from '../src/cards/client';
import { createCardSource } from '../src/cards/source';
import { basic, bolt, dfc, sets, specialRarity } from './fixtures/scryfall';

describe('mapScryfallCard', () => {
  it('maps a single-faced card', () => {
    expect(mapScryfallCard(bolt)).toEqual({
      instanceId: '', scryfallId: 'id-bolt', name: 'Lightning Bolt', manaCost: '{R}', manaValue: 1,
      colors: ['R'], typeLine: 'Instant', oracleText: 'Lightning Bolt deals 3 damage to any target.',
      rarity: 'common', imageUrl: 'https://img/bolt.jpg',
    });
  });

  it('uses the front face of a double-faced card', () => {
    const c = mapScryfallCard(dfc);
    expect(c.name).toBe('Front Face // Back Face');
    expect(c.manaCost).toBe('{1}{G}');
    expect(c.colors).toEqual(['G']);
    expect(c.imageUrl).toBe('https://img/front.jpg');
    expect(c.oracleText).toBe('Front text.\n//\nBack text.');
  });

  it('maps unknown rarities to rare', () => {
    expect(mapScryfallCard(specialRarity).rarity).toBe('rare');
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('createScryfallClient', () => {
  it('follows next_page and sends required headers', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [bolt], has_more: true, next_page: 'https://api.scryfall.com/page2' }))
      .mockResolvedValueOnce(jsonResponse({ data: [dfc], has_more: false }));
    const client = createScryfallClient({ fetchFn, delayMs: 0 });
    const cards = await client.searchAll('set:abc is:booster');
    expect(cards.map((c) => c.id)).toEqual(['id-bolt', 'id-dfc']);
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.scryfall.com/cards/search?q=set%3Aabc%20is%3Abooster&unique=cards');
    expect(fetchFn.mock.calls[1][0]).toBe('https://api.scryfall.com/page2');
    expect(fetchFn.mock.calls[0][1].headers).toEqual({ 'User-Agent': 'MTGDraftSim/0.1', Accept: 'application/json' });
  });

  it('returns [] on 404 (no search results)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ object: 'error' }, 404));
    expect(await createScryfallClient({ fetchFn, delayMs: 0 }).searchAll('set:zzz')).toEqual([]);
  });

  it('throws ScryfallError on other failures', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    await expect(createScryfallClient({ fetchFn, delayMs: 0 }).searchAll('set:abc')).rejects.toBeInstanceOf(ScryfallError);
  });
});

function fakeClient(byQuery: Record<string, ScryfallCard[]>) {
  return {
    searchAll: vi.fn(async (q: string) => byQuery[q] ?? []),
    listSets: vi.fn(async () => sets),
  };
}

const allBasics = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].map(basic);
const tmp = () => mkdtempSync(join(tmpdir(), 'mtg-cache-'));

describe('createCardSource.getSetCards', () => {
  it('splits booster cards from basics and caches to disk', async () => {
    const cacheDir = tmp();
    const client = fakeClient({
      'set:abc is:booster': [bolt, dfc, basic('Plains')],
      'set:abc type:basic': [...allBasics, basic('Snow-Covered Island')],
    });
    const result = await createCardSource({ client, cacheDir }).getSetCards('ABC');
    expect(result.cards.map((c) => c.name)).toEqual(['Lightning Bolt', 'Front Face // Back Face']);
    expect(result.basics.map((c) => c.name)).toEqual(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']);
    expect(existsSync(join(cacheDir, 'abc.json'))).toBe(true);

    await createCardSource({ client, cacheDir }).getSetCards('abc');
    expect(client.searchAll).toHaveBeenCalledTimes(2); // second source served from disk
  });

  it('falls back to fdn basics when the set has none', async () => {
    const client = fakeClient({ 'set:abc is:booster': [bolt], 'set:fdn type:basic': allBasics });
    const result = await createCardSource({ client, cacheDir: tmp() }).getSetCards('abc');
    expect(result.basics).toHaveLength(5);
  });

  it('throws for a set with no booster cards', async () => {
    const source = createCardSource({ client: fakeClient({}), cacheDir: tmp() });
    await expect(source.getSetCards('zzz')).rejects.toThrow('No booster cards found for set "zzz"');
  });

  it('rejects malformed set codes without calling Scryfall', async () => {
    const client = fakeClient({});
    await expect(createCardSource({ client, cacheDir: tmp() }).getSetCards('../etc')).rejects.toBeInstanceOf(ScryfallError);
    expect(client.searchAll).not.toHaveBeenCalled();
  });
});

describe('createCardSource.listDraftableSets', () => {
  it('keeps released paper expansion/core sets, newest first, cached 24h', async () => {
    const client = fakeClient({});
    let now = 0;
    const source = createCardSource({ client, cacheDir: tmp(), now: () => now, today: () => '2026-10-31' });
    const result = await source.listDraftableSets();
    expect(result.map((s) => s.code)).toEqual(['new', 'cor', 'old']);
    expect(result[0]).toEqual({ code: 'new', name: 'New Set', releasedAt: '2026-09-01', iconSvgUri: 'i/new.svg' });
    now = 23 * 3600 * 1000;
    await source.listDraftableSets();
    expect(client.listSets).toHaveBeenCalledTimes(1);
    now = 25 * 3600 * 1000;
    await source.listDraftableSets();
    expect(client.listSets).toHaveBeenCalledTimes(2);
  });
});
