import { COLORS, type Card, type Color } from '@mtg/shared';

export type ColorGroup = Color | 'multi' | 'colorless';

const GROUP_ORDER: ColorGroup[] = ['W', 'U', 'B', 'R', 'G', 'multi', 'colorless'];

export const GROUP_LABEL: Record<ColorGroup, string> = {
  W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', multi: 'Multicolor', colorless: 'Colorless',
};

export const BASIC_NAMES: Record<Color, string> = {
  W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest',
};

export function colorGroup(card: Card): ColorGroup {
  if (card.colors.length === 0) return 'colorless';
  if (card.colors.length > 1) return 'multi';
  return card.colors[0];
}

export function groupByColor(cards: Card[]): { group: ColorGroup; cards: Card[] }[] {
  return GROUP_ORDER.map((group) => ({ group, cards: cards.filter((c) => colorGroup(c) === group) })).filter(
    (g) => g.cards.length > 0,
  );
}

export const isLand = (card: Card) => /\bLand\b/.test(card.typeLine.split(' // ')[0]);

export function manaCurve(cards: Card[]): number[] {
  const curve = [0, 0, 0, 0, 0, 0, 0];
  for (const c of cards) if (!isLand(c)) curve[Math.min(6, Math.floor(c.manaValue))]++;
  return curve;
}

export function deckSize(main: Card[], basics: Record<Color, number>): number {
  return main.length + COLORS.reduce((sum, c) => sum + basics[c], 0);
}

function countLines(counts: Map<string, number>): string[] {
  return [...counts].map(([name, k]) => `${k} ${name}`);
}

export function buildDecklist(main: Card[], sideboard: Card[], basics: Record<Color, number>): string {
  const mainCounts = new Map<string, number>();
  for (const c of main) mainCounts.set(c.name, (mainCounts.get(c.name) ?? 0) + 1);
  for (const color of COLORS) {
    if (basics[color] > 0) {
      const name = BASIC_NAMES[color];
      mainCounts.set(name, (mainCounts.get(name) ?? 0) + basics[color]);
    }
  }
  const sideCounts = new Map<string, number>();
  for (const c of sideboard) sideCounts.set(c.name, (sideCounts.get(c.name) ?? 0) + 1);
  return [...countLines(mainCounts), '', 'Sideboard', ...countLines(sideCounts)].join('\n');
}
