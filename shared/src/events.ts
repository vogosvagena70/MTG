import type {
  Card,
  DeckSavePayload,
  DraftStatePayload,
  GameAction,
  GameView,
  IncomingChallenge,
  LobbyView,
  RosterPlayer,
  SessionInfo,
  SetInfo,
} from './types';

export type Ack<T extends object = Record<never, never>> = ({ ok: true } & T) | { ok: false; message: string };
export type SetsListResult = Ack<{ sets: SetInfo[] }>;

export interface CreateRoomPayload {
  name: string;
  setCode: string;
  timerSeconds: number | null;
  practice?: boolean;
}

export interface ClientToServerEvents {
  'sets:list': (ack: (res: SetsListResult) => void) => void;
  'room:create': (p: CreateRoomPayload, ack: (res: Ack<SessionInfo>) => void) => void;
  'room:join': (p: { code: string; name: string }, ack: (res: Ack<SessionInfo>) => void) => void;
  'room:resume': (p: { code: string; token: string }, ack: (res: Ack<{ code: string; playerId: string }>) => void) => void;
  'room:start': (p: Record<string, never>, ack: (res: Ack) => void) => void;
  'room:leave': (p: Record<string, never>, ack: (res: Ack) => void) => void;
  'draft:pick': (p: { instanceId: string }) => void;
  'deck:save': (p: DeckSavePayload, ack: (res: { ok: boolean; message?: string }) => void) => void;
  'battle:challenge': (p: { playerId: string }, ack: (res: Ack) => void) => void;
  'battle:respond': (p: { accept: boolean }, ack: (res: Ack) => void) => void;
  'game:action': (p: GameAction, ack: (res: Ack) => void) => void;
  'game:leave': (p: Record<string, never>, ack: (res: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'room:lobby': (p: LobbyView) => void;
  'draft:state': (p: DraftStatePayload) => void;
  'draft:complete': (p: { code: string; pool: Card[] }) => void;
  'room:error': (p: { message: string }) => void;
  'room:takeover': () => void;
  'battle:roster': (p: { players: RosterPlayer[] }) => void;
  'battle:challenged': (p: IncomingChallenge) => void;
  'battle:declined': (p: { byName: string; reason: 'declined' | 'expired' }) => void;
  'game:state': (p: GameView) => void;
  'game:ended': (p: Record<string, never>) => void;
}
