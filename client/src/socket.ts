import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@mtg/shared';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Same origin; Vite proxies /socket.io to the server in development.
export const socket: AppSocket = io();
