import { COLORS, type Card, type Color, type Rarity } from '@mtg/shared';

export interface ScryfallFace {
  name: string;
  mana_cost?: string;
  colors?: string[];
  oracle_text?: string;
  image_uris?: { normal: string };
}

export interface ScryfallCard {
  id: string;
  name: string;
  mana_cost?: string;
  cmc: number;
  colors?: string[];
  type_line: string;
  oracle_text?: string;
  rarity: string;
  image_uris?: { normal: string };
  card_faces?: ScryfallFace[];
}

export interface ScryfallList<T> {
  data: T[];
  has_more: boolean;
  next_page?: string;
}

export interface ScryfallSet {
  code: string;
  name: string;
  set_type: string;
  released_at?: string;
  digital: boolean;
  icon_svg_uri: string;
}

const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'mythic'];

function toColors(raw: string[] | undefined): Color[] {
  return (raw ?? []).filter((c): c is Color => (COLORS as string[]).includes(c));
}

export function mapScryfallCard(c: ScryfallCard): Card {
  const face = c.card_faces?.[0];
  const oracleText =
    c.oracle_text ?? (c.card_faces ? c.card_faces.map((f) => f.oracle_text ?? '').join('\n//\n') : '');
  return {
    instanceId: '',
    scryfallId: c.id,
    name: c.name,
    manaCost: c.mana_cost ?? face?.mana_cost ?? '',
    manaValue: c.cmc,
    colors: toColors(c.colors ?? face?.colors),
    typeLine: c.type_line,
    oracleText,
    rarity: (RARITIES as string[]).includes(c.rarity) ? (c.rarity as Rarity) : 'rare',
    imageUrl: c.image_uris?.normal ?? face?.image_uris?.normal ?? '',
  };
}
