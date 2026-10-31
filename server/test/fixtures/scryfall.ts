import type { ScryfallCard, ScryfallSet } from '../../src/cards/scryfall';

export const bolt: ScryfallCard = {
  id: 'id-bolt', name: 'Lightning Bolt', mana_cost: '{R}', cmc: 1, colors: ['R'],
  type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.',
  rarity: 'common', image_uris: { normal: 'https://img/bolt.jpg' },
};

export const dfc: ScryfallCard = {
  id: 'id-dfc', name: 'Front Face // Back Face', cmc: 2,
  type_line: 'Creature — Human // Creature — Werewolf', rarity: 'uncommon',
  card_faces: [
    { name: 'Front Face', mana_cost: '{1}{G}', colors: ['G'], oracle_text: 'Front text.', image_uris: { normal: 'https://img/front.jpg' } },
    { name: 'Back Face', mana_cost: '', colors: ['G'], oracle_text: 'Back text.', image_uris: { normal: 'https://img/back.jpg' } },
  ],
};

export const specialRarity: ScryfallCard = {
  id: 'id-special', name: 'Odd Card', mana_cost: '{3}', cmc: 3, colors: [],
  type_line: 'Artifact', oracle_text: '', rarity: 'special', image_uris: { normal: 'https://img/odd.jpg' },
};

export function basic(name: string): ScryfallCard {
  return {
    id: `id-${name}`, name, cmc: 0, colors: [], type_line: `Basic Land — ${name}`,
    oracle_text: '', rarity: 'common', image_uris: { normal: `https://img/${name}.jpg` },
  };
}

export const sets: ScryfallSet[] = [
  { code: 'old', name: 'Old Set', set_type: 'expansion', released_at: '2020-01-01', digital: false, icon_svg_uri: 'i/old.svg' },
  { code: 'new', name: 'New Set', set_type: 'expansion', released_at: '2026-09-01', digital: false, icon_svg_uri: 'i/new.svg' },
  { code: 'cor', name: 'Core Set', set_type: 'core', released_at: '2025-06-01', digital: false, icon_svg_uri: 'i/cor.svg' },
  { code: 'fut', name: 'Future Set', set_type: 'expansion', released_at: '2027-02-01', digital: false, icon_svg_uri: 'i/fut.svg' },
  { code: 'dig', name: 'Digital Set', set_type: 'expansion', released_at: '2024-01-01', digital: true, icon_svg_uri: 'i/dig.svg' },
  { code: 'pro', name: 'Promo Set', set_type: 'promo', released_at: '2024-01-01', digital: false, icon_svg_uri: 'i/pro.svg' },
];
