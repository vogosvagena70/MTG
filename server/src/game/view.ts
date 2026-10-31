import type { GameCard, GameView } from '@mtg/shared';
import type { GameState, PlayerState } from './state';

function cardsOf(state: GameState, gids: string[]): GameCard[] {
  return gids.map((gid) => ({ ...state.cards[gid] }));
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
      libraryCount: me.zones.library.length,
    },
    opp: {
      name: opp.name,
      life: opp.life,
      connected: connected[1 - seat],
      handCount: opp.zones.hand.length,
      battlefield: cardsOf(state, opp.zones.battlefield),
      graveyard: cardsOf(state, opp.zones.graveyard),
      libraryCount: opp.zones.library.length,
    },
  };
}
