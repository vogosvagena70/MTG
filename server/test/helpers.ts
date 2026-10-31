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
