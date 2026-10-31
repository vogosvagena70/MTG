import type { Card, DeckSavePayload, SeatView, SetInfo } from './types';

export type SetsListResult = { ok: true; sets: SetInfo[] } | { ok: false; message: string };

export interface ClientToServerEvents {
  'sets:list': (ack: (res: SetsListResult) => void) => void;
  'practice:start': (p: { setCode: string }) => void;
  'draft:pick': (p: { instanceId: string }) => void;
  'deck:save': (p: DeckSavePayload, ack: (res: { ok: boolean; message?: string }) => void) => void;
  'room:resume': (p: { roomId: string }) => void;
}

export interface ServerToClientEvents {
  'draft:state': (p: { roomId: string; view: SeatView }) => void;
  'draft:complete': (p: { roomId: string; pool: Card[] }) => void;
  'practice:error': (p: { message: string }) => void;
}
