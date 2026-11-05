import type { GameAction, GameCard, Zone } from '@mtg/shared';
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
    case 'flip':
      if (typeof r.gid !== 'string') throw bad();
      return { type: 'flip', gid: r.gid };
    case 'token': {
      const text = (v: unknown, max: number) => {
        if (v === undefined) return '';
        if (typeof v !== 'string' || v.trim().length > max) throw bad();
        return v.trim();
      };
      const name = text(r.name, TOKEN_NAME_MAX);
      const description = text(r.description, TOKEN_DESCRIPTION_MAX);
      const power = text(r.power, TOKEN_PT_MAX);
      const toughness = text(r.toughness, TOKEN_PT_MAX);
      if (!name || !power !== !toughness) throw bad();
      return {
        type: 'token',
        name,
        ...(description ? { description } : {}),
        ...(power ? { power, toughness } : {}),
      };
    }
    case 'counters':
      if (typeof r.gid !== 'string' || !isInt(r.delta) || r.delta === 0 || r.delta < -20 || r.delta > 20) throw bad();
      return { type: 'counters', gid: r.gid, delta: r.delta };
    case 'ptCounters': {
      const inRange = (v: unknown): v is number => isInt(v) && Math.abs(v) <= MAX_PT_STEP;
      if (typeof r.gid !== 'string' || !inRange(r.power) || !inRange(r.toughness)) throw bad();
      if (r.power === 0 && r.toughness === 0) throw bad();
      return { type: 'ptCounters', gid: r.gid, power: r.power, toughness: r.toughness };
    }
    case 'life':
      if (!isInt(r.delta) || r.delta === 0 || r.delta < -20 || r.delta > 20) throw bad();
      return { type: 'life', delta: r.delta };
    case 'searchTop':
      if (!isInt(r.count) || r.count < 1 || r.count > MAX_SEARCH_TOP) throw bad();
      return { type: 'searchTop', count: r.count };
    case 'scry':
    case 'surveil':
      if (!isInt(r.count) || r.count < 1 || r.count > MAX_SEARCH_TOP) throw bad();
      return { type: r.type, count: r.count };
    case 'arrangeLibrary': {
      const gids = r.gids;
      if (!Array.isArray(gids) || gids.length === 0 || gids.length > MAX_ARRANGE) throw bad();
      if (!gids.every((g): g is string => typeof g === 'string') || new Set(gids).size !== gids.length) throw bad();
      return { type: 'arrangeLibrary', gids };
    }
    case 'gainControl':
    case 'giveControl':
      if (typeof r.gid !== 'string') throw bad();
      return { type: r.type, gid: r.gid };
    case 'searchLibrary':
    case 'closeLibrary':
    case 'untapAll':
    case 'shuffle':
    case 'concede':
      return { type: r.type };
    default:
      throw bad();
  }
}

export const MAX_SEARCH_TOP = 99;
const MAX_ARRANGE = 1000;
const MAX_PT_STEP = 99;
const MAX_PT_TOTAL = 999;
export const TOKEN_NAME_MAX = 30;
export const TOKEN_PT_MAX = 3;
export const TOKEN_DESCRIPTION_MAX = 300;
const MAX_TOKENS = 200;

/** How a card is named in the log, which both players read. */
const logName = (card: GameCard) => (card.faceDown ? 'a face-down card' : card.card.name);

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
  const oppSeat = (1 - seat) as 0 | 1;
  const them = state.players[oppSeat];
  // the opponent's zones are copied only when an action touches them (control changes, returning a card to its owner)
  let oppZones: Record<Zone, string[]> | null = null;
  const theirZones = () =>
    (oppZones ??= {
      library: [...them.zones.library],
      hand: [...them.zones.hand],
      battlefield: [...them.zones.battlefield],
      graveyard: [...them.zones.graveyard],
      exile: [...them.zones.exile],
    });
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
      // your own cards, plus your opponent's cards you control on your battlefield
      if (!from || !card || (card.owner !== seat && from !== 'battlefield')) throw new GameError('Card is not available');
      if (!ZONES.includes(action.to)) throw new GameError('Invalid action');
      // a card leaving the battlefield goes to its owner's zones
      const borrowed = card.owner !== seat && action.to !== 'battlefield';
      const dest = borrowed ? theirZones() : zones;
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
        text = card.faceDown
          ? `${me.name}'s face-down token left the battlefield`
          : `${me.name}'s ${card.card.name} token left the battlefield`;
        break;
      }
      if (action.to === 'library') {
        if (action.bottom) dest.library.push(action.gid);
        else dest.library.unshift(action.gid);
        // you know where you just put it, so it stays visible in an open window
        if (!borrowed && peek && !peek.gids.includes(action.gid)) peek = { ...peek, gids: [...peek.gids, action.gid] };
      } else {
        dest[action.to].push(action.gid);
      }
      if (action.to === 'battlefield') {
        setCard(action.gid, { x: clamp(action.x ?? 50), y: clamp(action.y ?? 50), tapped: false, counters: 0, ptCounters: { power: 0, toughness: 0 } });
      } else if (card.tapped || card.counters || card.ptCounters.power || card.ptCounters.toughness) {
        setCard(action.gid, { tapped: false, counters: 0, ptCounters: { power: 0, toughness: 0 } });
      }
      // a card returned to the library is hidden anyway, so it comes back face up when drawn
      if (action.to === 'library' && from !== 'library' && card.faceDown) setCard(action.gid, { faceDown: false });
      // the opponent never learns the name of a card that stays hidden
      if (borrowed) {
        const where = action.to === 'library' ? `the ${action.bottom ? 'bottom' : 'top'} of ${them.name}'s library` : `${them.name}'s ${action.to}`;
        text = `${me.name} moved ${logName(card)} to ${where}`;
      } else if (action.to === 'library' && from === 'hand') {
        text = `${me.name} put a card from their hand ${action.bottom ? 'on the bottom' : 'on top'} of their library`;
      } else if (action.to === 'library' && from === 'library') {
        text = `${me.name} moved a card to the ${action.bottom ? 'bottom' : 'top'} of their library`;
      } else if (action.to === 'hand' && from === 'library') {
        text = `${me.name} put a card from their library into their hand`;
      } else if (action.to === 'library' && action.bottom) {
        text = `${me.name} moved ${logName(card)} to the bottom of their library`;
      } else {
        text = `${me.name} moved ${logName(card)} to ${action.to}`;
      }
      break;
    }
    case 'tap': {
      const card = cards[action.gid];
      if (!card || !zones.battlefield.includes(action.gid)) {
        throw new GameError('Card is not on the battlefield');
      }
      setCard(action.gid, { tapped: action.tapped });
      text = `${me.name} ${action.tapped ? 'tapped' : 'untapped'} ${logName(card)}`;
      break;
    }
    case 'flip': {
      const from = findZone({ ...me, zones }, action.gid, peek);
      const card = cards[action.gid];
      if (!from || !card || (card.owner !== seat && from !== 'battlefield')) throw new GameError('Card is not available');
      setCard(action.gid, { faceDown: !card.faceDown });
      // flipping a card in your hand or library is nobody else's business
      if (from !== 'hand' && from !== 'library') {
        text = card.faceDown
          ? `${me.name} flipped ${card.card.name} face up`
          : `${me.name} flipped a card face down`;
      }
      break;
    }
    case 'token': {
      if (zones.battlefield.filter((g) => cards[g].token).length >= MAX_TOKENS) throw new GameError('Too many tokens');
      const gid = `t${++tokenCount}`;
      const stats = action.power ? `${action.power}/${action.toughness}` : null;
      cards = {
        ...cards,
        [gid]: {
          gid, owner: seat, tapped: false, x: 50, y: 50, counters: 0, ptCounters: { power: 0, toughness: 0 },
          token: stats ? { power: action.power, toughness: action.toughness } : {},
          card: {
            instanceId: '', scryfallId: 'token', name: action.name, manaCost: '', manaValue: 0, colors: [],
            typeLine: stats ? `Token — ${stats}` : 'Token', oracleText: action.description ?? '', rarity: 'common', imageUrl: '',
          },
        },
      };
      zones.battlefield.push(gid);
      text = stats ? `${me.name} created a ${stats} ${action.name} token` : `${me.name} created a ${action.name} token`;
      break;
    }
    case 'counters': {
      const card = cards[action.gid];
      if (!card || !zones.battlefield.includes(action.gid)) {
        throw new GameError('Card is not on the battlefield');
      }
      const value = card.counters + action.delta;
      if (value < 0) throw new GameError('No counters to remove');
      setCard(action.gid, { counters: value });
      text = card.faceDown
        ? `${me.name} changed the counters on a face-down card`
        : `${me.name}: ${card.card.name} counters ${card.counters} → ${value}`;
      break;
    }
    case 'ptCounters': {
      const card = cards[action.gid];
      if (!card || !zones.battlefield.includes(action.gid)) {
        throw new GameError('Card is not on the battlefield');
      }
      const power = card.ptCounters.power + action.power;
      const toughness = card.ptCounters.toughness + action.toughness;
      if (Math.abs(power) > MAX_PT_TOTAL || Math.abs(toughness) > MAX_PT_TOTAL) throw new GameError('Too many counters');
      setCard(action.gid, { ptCounters: { power, toughness } });
      const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
      text = card.faceDown
        ? `${me.name} changed the counters on a face-down card`
        : `${me.name}: ${card.card.name} is now ${signed(power)}/${signed(toughness)}`;
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
    case 'scry':
    case 'surveil':
      if (zones.library.length === 0) throw new GameError('Library is empty');
      peek = { mode: action.type, gids: zones.library.slice(0, action.count) };
      text = `${me.name} ${action.type === 'scry' ? 'scried' : 'surveilled'} ${peek.gids.length}`;
      break;
    case 'arrangeLibrary': {
      // only the cards in the open window, and all of them, so nothing unseen can be moved
      const shown = new Set((peek?.gids ?? []).filter((g) => zones.library.includes(g)));
      if (action.gids.length !== shown.size || !action.gids.every((g) => shown.has(g))) {
        throw new GameError('Those cards are not in your library window');
      }
      const slots = zones.library.flatMap((g, i) => (shown.has(g) ? [i] : []));
      const before = slots.map((i) => zones.library[i]);
      if (before.every((g, i) => g === action.gids[i])) break; // same order: nothing to do or log
      slots.forEach((slot, i) => (zones.library[slot] = action.gids[i]));
      text = `${me.name} rearranged cards in their library`;
      break;
    }
    case 'gainControl': {
      const card = cards[action.gid];
      if (!card || !them.zones.battlefield.includes(action.gid)) throw new GameError('Card is not on their battlefield');
      const opp = theirZones();
      opp.battlefield = opp.battlefield.filter((g) => g !== action.gid);
      zones.battlefield.push(action.gid);
      text = `${me.name} gained control of ${logName(card)}`;
      break;
    }
    case 'giveControl': {
      const card = cards[action.gid];
      if (!card || !zones.battlefield.includes(action.gid)) throw new GameError('Card is not on the battlefield');
      zones.battlefield = zones.battlefield.filter((g) => g !== action.gid);
      theirZones().battlefield.push(action.gid);
      text = card.owner === oppSeat
        ? `${me.name} returned ${logName(card)} to ${them.name}`
        : `${me.name} gave control of ${logName(card)} to ${them.name}`;
      break;
    }
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
  if (oppZones) players[oppSeat] = { ...them, zones: oppZones };
  return {
    ...state,
    players,
    cards,
    tokenCount,
    over: over ?? state.over,
    log: text === null ? state.log : appendLog(state, text, now),
  };
}
