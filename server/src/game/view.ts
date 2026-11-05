import type { Card, GameCard, GameView } from '@mtg/shared';
import type { GameState, PlayerState } from './state';

function cardsOf(state: GameState, gids: string[]): GameCard[] {
  return gids.map((gid) => ({ ...state.cards[gid] }));
}

const FACE_DOWN: Card = {
  instanceId: '', scryfallId: '', name: 'Face-down card', manaCost: '', manaValue: 0, colors: [],
  typeLine: '', oracleText: '', rarity: 'common', imageUrl: '',
};

/** What the opponent may see of a card: a face-down one keeps only its table position and tapped state. */
function publicCardsOf(state: GameState, gids: string[]): GameCard[] {
  return cardsOf(state, gids).map((gc) => {
    if (!gc.faceDown) return gc;
    const { token: _token, ...rest } = gc;
    return { ...rest, card: FACE_DOWN, counters: 0, ptCounters: { power: 0, toughness: 0 } };
  });
}

function peekFor(state: GameState, me: PlayerState): GameView['me']['peek'] {
  if (!me.peek || state.over) return null;
  const seen = new Set(me.peek.gids);
  const library = me.zones.library;
  let topCount = 0;
  while (topCount < library.length && seen.has(library[topCount])) topCount++;
  return { mode: me.peek.mode, cards: cardsOf(state, library.filter((gid) => seen.has(gid))), topCount };
}

export function gameViewFor(state: GameState, seat: 0 | 1, connected: [boolean, boolean]): GameView {
  const me: PlayerState = state.players[seat];
  const opp: PlayerState = state.players[1 - seat];
  return {
    gameId: state.id,
    you: seat,
    firstPlayer: state.firstPlayer,
    over: state.over ? { ...state.over } : null,
    log: state.log.map((entry) => ({ ...entry })),
    me: {
      name: me.name,
      life: me.life,
      hand: cardsOf(state, me.zones.hand),
      battlefield: cardsOf(state, me.zones.battlefield),
      graveyard: cardsOf(state, me.zones.graveyard),
      exile: cardsOf(state, me.zones.exile),
      libraryCount: me.zones.library.length,
      peek: peekFor(state, me),
    },
    opp: {
      name: opp.name,
      life: opp.life,
      connected: connected[1 - seat],
      handCount: opp.zones.hand.length,
      battlefield: publicCardsOf(state, opp.zones.battlefield),
      graveyard: publicCardsOf(state, opp.zones.graveyard),
      exile: publicCardsOf(state, opp.zones.exile),
      libraryCount: opp.zones.library.length,
    },
  };
}
