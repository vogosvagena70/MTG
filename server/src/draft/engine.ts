import type { Card, SeatView } from '@mtg/shared';

export const ROUNDS = 3;

export class InvalidPickError extends Error {}

export interface DraftState {
  seatCount: number;
  round: number; // 0-based
  pickInRound: number; // 0-based
  unopened: Card[][][]; // [seat][round]
  current: Card[][]; // pack in front of each seat
  picks: Card[][];
  pickedThisTurn: boolean[];
  complete: boolean;
}

export function createDraft(seatCount: number, packsPerSeat: Card[][][]): DraftState {
  if (packsPerSeat.length !== seatCount) throw new Error(`Expected packs for ${seatCount} seats`);
  const unopened = packsPerSeat.map((rounds, seat) => {
    if (rounds.length !== ROUNDS) throw new Error(`Seat ${seat} needs ${ROUNDS} packs`);
    return rounds.map((pack, round) => pack.map((card, i) => ({ ...card, instanceId: `r${round}s${seat}c${i}` })));
  });
  return {
    seatCount,
    round: 0,
    pickInRound: 0,
    unopened,
    current: unopened.map((r) => r[0]),
    picks: unopened.map(() => []),
    pickedThisTurn: unopened.map(() => false),
    complete: false,
  };
}

export function applyPick(state: DraftState, seat: number, instanceId: string): DraftState {
  if (state.complete) throw new InvalidPickError('Draft is complete');
  if (seat < 0 || seat >= state.seatCount) throw new InvalidPickError('No such seat');
  if (state.pickedThisTurn[seat]) throw new InvalidPickError('Seat already picked this turn');
  const pack = state.current[seat];
  const card = pack.find((c) => c.instanceId === instanceId);
  if (!card) throw new InvalidPickError('Card is not in the current pack');

  const current = state.current.slice();
  current[seat] = pack.filter((c) => c !== card);
  const picks = state.picks.slice();
  picks[seat] = [...picks[seat], card];
  const pickedThisTurn = state.pickedThisTurn.slice();
  pickedThisTurn[seat] = true;
  return { ...state, current, picks, pickedThisTurn };
}

function passDirection(round: number): 1 | -1 {
  return round === 1 ? -1 : 1; // left, right, left
}

export function advanceIfReady(state: DraftState): DraftState {
  if (state.complete || !state.pickedThisTurn.every(Boolean)) return state;
  const n = state.seatCount;
  const dir = passDirection(state.round);
  const passed: Card[][] = new Array(n);
  for (let i = 0; i < n; i++) passed[(i + dir + n) % n] = state.current[i];
  const reset = state.pickedThisTurn.map(() => false);

  if (passed[0].length > 0) {
    return { ...state, current: passed, pickedThisTurn: reset, pickInRound: state.pickInRound + 1 };
  }
  if (state.round === ROUNDS - 1) {
    return { ...state, current: passed, pickedThisTurn: reset, complete: true };
  }
  const round = state.round + 1;
  return { ...state, round, pickInRound: 0, current: state.unopened.map((r) => r[round]), pickedThisTurn: reset };
}

export function seatView(state: DraftState, seat: number): SeatView {
  return {
    packNumber: state.round + 1,
    pickNumber: state.pickInRound + 1,
    currentPack: state.complete || state.pickedThisTurn[seat] ? null : state.current[seat],
    picks: state.picks[seat],
    complete: state.complete,
  };
}
