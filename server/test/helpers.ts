import type { Scheduler } from '../src/rooms/scheduler';
import { COLORS, type Card, type Rarity, type SetCards } from '@mtg/shared';

let counter = 0;

export function makeCard(over: Partial<Card> = {}): Card {
  counter++;
  return {
    instanceId: '', scryfallId: `sf-${counter}`, name: `Card ${counter}`, manaCost: '{1}', manaValue: 1,
    colors: [], typeLine: 'Artifact', oracleText: '', rarity: 'common', imageUrl: '',
    ...over,
  };
}

export function makeSet(sizes = { common: 60, uncommon: 30, rare: 15, mythic: 5 }): SetCards {
  const cards: Card[] = [];
  for (const rarity of ['common', 'uncommon', 'rare', 'mythic'] as Rarity[]) {
    for (let i = 0; i < sizes[rarity]; i++) {
      cards.push(makeCard({
        name: `${rarity}-${i}`, rarity, colors: [COLORS[i % 5]],
        typeLine: i % 2 ? 'Creature — Test' : 'Instant',
      }));
    }
  }
  const basics = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].map((name) =>
    makeCard({ name, typeLine: `Basic Land — ${name}`, colors: [] }),
  );
  return { cards, basics };
}

export class FakeClock implements Scheduler {
  now = 1_000;
  private tasks: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;

  setTimeout(fn: () => void, ms: number): number {
    const id = this.nextId++;
    this.tasks.push({ at: this.now + ms, fn, id });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.tasks = this.tasks.filter((t) => t.id !== handle);
  }

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = this.tasks.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.tasks = this.tasks.filter((t) => t !== due);
      this.now = due.at;
      due.fn();
    }
    this.now = target;
  }

  get pending(): number {
    return this.tasks.length;
  }
}
