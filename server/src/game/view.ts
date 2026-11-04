import type { GameCard, GameView } from '@mtg/shared';
import type { GameState, PlayerState } from './state';

function cardsOf(state: GameState, gids: string[]): GameCard[] {
  return gids.map((gid) => ({ ...state.cards[gid] }));
}

function peekFor(state: GameState, me: PlayerState): GameView['me']['peek'] {
  if (!me.peek || state.over) return null;
  const seen = new Set(me.peek.gids);
  const cards = cardsOf(state, me.zones.library.filter((gid) => seen.has(gid)));
  // a search never reveals library order: it is sorted by name, ids break ties
  if (me.peek.mode === 'search') {
    cards.sort((a, b) => a.card.name.localeCompare(b.card.name) || a.gid.localeCompare(b.gid));
  }
  return { mode: me.peek.mode, cards };
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
      battlefield: cardsOf(state, opp.zones.battlefield),
      graveyard: cardsOf(state, opp.zones.graveyard),
      exile: cardsOf(state, opp.zones.exile),
      libraryCount: opp.zones.library.length,
    },
  };
}
