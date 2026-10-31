import type { ScryfallCard, ScryfallList, ScryfallSet } from './scryfall';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface ScryfallClient {
  searchAll(q: string): Promise<ScryfallCard[]>;
  listSets(): Promise<ScryfallSet[]>;
}

export class ScryfallError extends Error {}

const API = 'https://api.scryfall.com';
const HEADERS = { 'User-Agent': 'MTGDraftSim/0.1', Accept: 'application/json' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createScryfallClient(opts: { fetchFn?: FetchFn; delayMs?: number } = {}): ScryfallClient {
  const fetchFn = opts.fetchFn ?? fetch;
  const delayMs = opts.delayMs ?? 100;
  let last = 0;

  async function getJson<T>(url: string): Promise<T | null> {
    const wait = last + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    let res: Response;
    try {
      res = await fetchFn(url, { headers: HEADERS });
    } catch {
      throw new ScryfallError('Could not reach Scryfall. Check your connection and retry.');
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new ScryfallError(`Scryfall request failed (${res.status})`);
    return (await res.json()) as T;
  }

  return {
    async searchAll(q) {
      const out: ScryfallCard[] = [];
      let url: string | undefined = `${API}/cards/search?q=${encodeURIComponent(q)}&unique=cards`;
      let first = true;
      while (url) {
        const page: ScryfallList<ScryfallCard> | null = await getJson(url);
        if (!page) {
          if (first) break; // 404 on the first page: no results
          throw new ScryfallError('Scryfall results ended unexpectedly. Please retry.');
        }
        first = false;
        out.push(...page.data);
        url = page.has_more ? page.next_page : undefined;
      }
      return out;
    },
    async listSets() {
      const res = await getJson<ScryfallList<ScryfallSet>>(`${API}/sets`);
      return res?.data ?? [];
    },
  };
}
