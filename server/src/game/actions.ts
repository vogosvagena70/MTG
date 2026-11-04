import type { GameAction, Zone } from '@mtg/shared';
import { appendLog, GameError, shuffleInPlace, type GameState, type PlayerState } from './state';

const ZONES: readonly Zone[] = ['library', 'hand', 'battlefield', 'graveyard', 'exile'];

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

export function parseAction(raw: unknown): GameAction {
  const bad = () => new GameError('Invalid action');
  if (!raw || typeof raw !== 'object') throw bad();
  const r = raw as Record<string, unknown>;
  switch (r.type) {
    case 'draw':
      if (!isInt(r.count) || r.count < 1 || r.count > 7) throw bad();
      return { type: 'draw', count: r.count };
    case 'move': {
      if (typeof r.gid !== 'string' || typeof r.to !== 'string' || !ZONES.includes(r.to as Zone)) throw bad();
      const out: GameAction = { type: 'move', gid: r.gid, to: r.to as Zone };
      for (const k of ['x', 'y'] as const) {
        if (r[k] === undefined) continue;
        if (typeof r[k] !== 'number' || !Number.isFinite(r[k])) throw bad();
        out[k] = r[k] as number;
      }
      if (r.bottom !== undefined) {
        if (typeof r.bottom !== 'boolean') throw bad();
        if (r.to === 'library') out.bottom = r.bottom;
      }
      return out;
    }
    case 'tap':
      if (typeof r.gid !== 'string' || typeof r.tapped !== 'boolean') throw bad();
      return { type: 'tap', gid: r.gid, tapped: r.tapped };
    case 'token': {
      const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
      const name = text(r.name);
      const power = text(r.power);
      const toughness = text(r.toughness);
      if (!name || name.length > TOKEN_NAME_MAX || !power || power.length > TOKEN_PT_MAX || !toughness || toughness.length > TOKEN_PT_MAX) {
        throw bad();
      }
      return { type: 'token', name, power, toughness };
    }
    case 'counters':
      if (typeof r.gid !== 'string' || !isInt(r.delta) || r.delta === 0 || r.delta < -20 || r.delta > 20) throw bad();
      return { type: 'counters', gid: r.gid, delta: r.delta };
    case 'life':
      if (!isInt(r.delta) || r.delta === 0 || r.delta < -20 || r.delta > 20) throw bad();
      return { type: 'life', delta: r.delta };
    case 'searchTop':
      if (!isInt(r.count) || r.count < 1 || r.count > MAX_SEARCH_TOP) throw bad();
      return { type: 'searchTop', count: r.count };
    case 'searchLibrary':
    case 'closeLibrary':
    case 'untapAll':
    case 'shuffle':
    case 'mulligan':
    case 'concede':
      return { type: r.type };
    default:
      throw bad();
  }
}

export const MAX_SEARCH_TOP = 99;
export const TOKEN_NAME_MAX = 30;
export const TOKEN_PT_MAX = 3;
const MAX_TOKENS = 200;

const clamp = (n: number) => Math.min(100, Math.max(0, n));

function findZone(p: PlayerState, gid: string, peek: PlayerState['peek']): Zone | null {
  // library cards can only be touched while they are shown in the open window
  if (peek?.gids.includes(gid) && p.zones.library.includes(gid)) return 'library';
  for (const z of ['hand', 'battlefield', 'graveyard', 'exile'] as const) {
    if (p.zones[z].includes(gid)) return z;
  }
  return null;
}

export function applyAction(state: GameState, seat: 0 | 1, action: GameAction, now: number): GameState {
  if (state.over) throw new GameError('Game is over');
  const me = state.players[seat];
  const zones: Record<Zone, string[]> = {
    library: [...me.zones.library],
    hand: [...me.zones.hand],
    battlefield: [...me.zones.battlefield],
    graveyard: [...me.zones.graveyard],
    exile: [...me.zones.exile],
  };
  let cards = state.cards;
  let life = me.life;
  let over: GameState['over'] = null;
  let text: string | null = null;
  let peek = me.peek;
  let tokenCount = state.tokenCount ?? 0;

  const setCard = (gid: string, patch: Partial<GameState['cards'][string]>) => {
    cards = { ...cards, [gid]: { ...cards[gid], ...patch } };
  };
  const drawN = (n: number) => {
    const moved = zones.library.splice(0, n);
    zones.hand.push(...moved);
    return moved.length;
  };

  switch (action.type) {
    case 'draw': {
      if (zones.library.length === 0) throw new GameError('Library is empty');
      const n = drawN(action.count);
      text = `${me.name} drew ${n} card${n === 1 ? '' : 's'}`;
      break;
    }
    case 'move': {
      const from = findZone({ ...me, zones }, action.gid, peek);
      const card = cards[action.gid];
      if (!from || !card || card.owner !== seat) throw new GameError('Card is not available');
      if (!ZONES.includes(action.to)) throw new GameError('Invalid action');
      if (from === action.to && from !== 'battlefield' && from !== 'library') break; // no-op: nothing changes, nothing is logged
      if (from === 'battlefield' && action.to === 'battlefield') {
        setCard(action.gid, { x: clamp(action.x ?? 50), y: clamp(action.y ?? 50) });
        break;
      }
      zones[from] = zones[from].filter((g) => g !== action.gid);
      if (card.token) {
        // tokens cease to exist when they leave the battlefield
        const { [action.gid]: _gone, ...rest } = cards;
        cards = rest;
        text = `${me.name}'s ${card.card.name} token left the battlefield`;
        break;
      }
      if (action.to === 'library') {
        if (action.bottom) zones.library.push(action.gid);
        else zones.library.unshift(action.gid);
        // you know where you just put it, so it stays visible in an open window
        if (peek && !peek.gids.includes(action.gid)) peek = { ...peek, gids: [...peek.gids, action.gid] };
      } else {
        zones[action.to].push(action.gid);
      }
      if (action.to === 'battlefield') {
        setCard(action.gid, { x: clamp(action.x ?? 50), y: clamp(action.y ?? 50), tapped: false, counters: 0 });
      } else if (card.tapped || card.counters) {
        setCard(action.gid, { tapped: false, counters: 0 });
      }
      // the opponent never learns the name of a card that stays hidden
      if (action.to === 'library' && from === 'hand') {
        text = `${me.name} put a card from their hand ${action.bottom ? 'on the bottom' : 'on top'} of their library`;
      } else if (action.to === 'library' && from === 'library') {
        text = `${me.name} moved a card to the ${action.bottom ? 'bottom' : 'top'} of their library`;
      } else if (action.to === 'hand' && from === 'library') {
        text = `${me.name} put a card from their library into their hand`;
      } else if (action.to === 'library' && action.bottom) {
        text = `${me.name} moved ${card.card.name} to the bottom of their library`;
      } else {
        text = `${me.name} moved ${card.card.name} to ${action.to}`;
      }
      break;
    }
    case 'tap': {
      const card = cards[action.gid];
      if (!card || card.owner !== seat || !zones.battlefield.includes(action.gid)) {
        throw new GameError('Card is not on the battlefield');
      }
      setCard(action.gid, { tapped: action.tapped });
      text = `${me.name} ${action.tapped ? 'tapped' : 'untapped'} ${card.card.name}`;
      break;
    }
    case 'token': {
      if (zones.battlefield.filter((g) => cards[g].token).length >= MAX_TOKENS) throw new GameError('Too many tokens');
      const gid = `t${++tokenCount}`;
      cards = {
        ...cards,
        [gid]: {
          gid, owner: seat, tapped: false, x: 50, y: 50, counters: 0,
          token: { power: action.power, toughness: action.toughness },
          card: {
            instanceId: '', scryfallId: 'token', name: action.name, manaCost: '', manaValue: 0, colors: [],
            typeLine: 'Token Creature', oracleText: '', rarity: 'common', imageUrl: '',
          },
        },
      };
      zones.battlefield.push(gid);
      text = `${me.name} created a ${action.power}/${action.toughness} ${action.name} token`;
      break;
    }
    case 'counters': {
      const card = cards[action.gid];
      if (!card || card.owner !== seat || !zones.battlefield.includes(action.gid)) {
        throw new GameError('Card is not on the battlefield');
      }
      const old = card.counters ?? 0;
      setCard(action.gid, { counters: old + action.delta });
      text = `${me.name}: ${card.card.name} counters ${old} → ${old + action.delta}`;
      break;
    }
    case 'untapAll':
      for (const gid of zones.battlefield) if (cards[gid].tapped) setCard(gid, { tapped: false });
      text = `${me.name} untapped all`;
      break;
    case 'shuffle':
      shuffleInPlace(zones.library, state.rng);
      peek = undefined;
      text = `${me.name} shuffled their library`;
      break;
    case 'mulligan':
      zones.library.push(...zones.hand);
      zones.hand = [];
      shuffleInPlace(zones.library, state.rng);
      peek = undefined;
      drawN(7);
      text = `${me.name} took a mulligan`;
      break;
    case 'life': {
      const old = life;
      life += action.delta;
      text = `${me.name}'s life: ${old} → ${life}`;
      break;
    }
    case 'searchTop':
      if (zones.library.length === 0) throw new GameError('Library is empty');
      peek = { mode: 'top', gids: zones.library.slice(0, action.count) };
      text = `${me.name} searched the top ${peek.gids.length} of their library`;
      break;
    case 'searchLibrary':
      if (zones.library.length === 0) throw new GameError('Library is empty');
      peek = { mode: 'search', gids: [...zones.library] };
      text = `${me.name} searched their library`;
      break;
    case 'closeLibrary':
      peek = undefined;
      break;
    case 'concede':
      over = { conceded: seat };
      text = `${me.name} conceded`;
      break;
    default:
      throw new GameError('Invalid action');
  }

  const players: GameState['players'] = [state.players[0], state.players[1]];
  // the window only ever holds cards still in the library; it closes once none are left
  if (peek) {
    const inLibrary = new Set(zones.library);
    const gids = peek.gids.filter((g) => inLibrary.has(g));
    peek = gids.length > 0 ? { ...peek, gids } : undefined;
  }
  players[seat] = { ...me, life, zones, peek };
  return {
    ...state,
    players,
    cards,
    tokenCount,
    over: over ?? state.over,
    log: text === null ? state.log : appendLog(state, text, now),
  };
}
