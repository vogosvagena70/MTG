import type { GameAction, Zone } from '@mtg/shared';
import { appendLog, GameError, shuffleInPlace, type GameState, type PlayerState } from './state';

const ZONES: readonly Zone[] = ['library', 'hand', 'battlefield', 'graveyard'];

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
      return out;
    }
    case 'tap':
      if (typeof r.gid !== 'string' || typeof r.tapped !== 'boolean') throw bad();
      return { type: 'tap', gid: r.gid, tapped: r.tapped };
    case 'life':
      if (!isInt(r.delta) || r.delta === 0 || r.delta < -20 || r.delta > 20) throw bad();
      return { type: 'life', delta: r.delta };
    case 'untapAll':
    case 'shuffle':
    case 'mulligan':
    case 'concede':
      return { type: r.type };
    default:
      throw bad();
  }
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));

function findZone(p: PlayerState, gid: string): Zone | null {
  for (const z of ['hand', 'battlefield', 'graveyard'] as const) {
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
  };
  let cards = state.cards;
  let life = me.life;
  let over: GameState['over'] = null;
  let text: string | null = null;

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
      const from = findZone({ ...me, zones }, action.gid);
      const card = cards[action.gid];
      if (!from || !card || card.owner !== seat) throw new GameError('Card is not available');
      if (!ZONES.includes(action.to)) throw new GameError('Invalid action');
      if (from === action.to && from !== 'battlefield') break; // no-op: nothing changes, nothing is logged
      if (from === 'battlefield' && action.to === 'battlefield') {
        setCard(action.gid, { x: clamp(action.x ?? 50), y: clamp(action.y ?? 50) });
        break;
      }
      zones[from] = zones[from].filter((g) => g !== action.gid);
      if (action.to === 'library') zones.library.unshift(action.gid);
      else zones[action.to].push(action.gid);
      if (action.to === 'battlefield') {
        setCard(action.gid, { x: clamp(action.x ?? 50), y: clamp(action.y ?? 50), tapped: false });
      } else if (card.tapped) {
        setCard(action.gid, { tapped: false });
      }
      text = from === 'hand' && action.to === 'library'
        ? `${me.name} put a card from their hand on top of their library`
        : `${me.name} moved ${card.card.name} to ${action.to}`;
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
    case 'untapAll':
      for (const gid of zones.battlefield) if (cards[gid].tapped) setCard(gid, { tapped: false });
      text = `${me.name} untapped all`;
      break;
    case 'shuffle':
      shuffleInPlace(zones.library, state.rng);
      text = `${me.name} shuffled their library`;
      break;
    case 'mulligan':
      zones.library.push(...zones.hand);
      zones.hand = [];
      shuffleInPlace(zones.library, state.rng);
      drawN(7);
      text = `${me.name} took a mulligan`;
      break;
    case 'life': {
      const old = life;
      life += action.delta;
      text = `${me.name}'s life: ${old} → ${life}`;
      break;
    }
    case 'concede':
      over = { conceded: seat };
      text = `${me.name} conceded`;
      break;
    default:
      throw new GameError('Invalid action');
  }

  const players: GameState['players'] = [state.players[0], state.players[1]];
  players[seat] = { ...me, life, zones };
  return {
    ...state,
    players,
    cards,
    over: over ?? state.over,
    log: text === null ? state.log : appendLog(state, text, now),
  };
}
