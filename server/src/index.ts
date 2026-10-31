import { fileURLToPath } from 'node:url';
import { createScryfallClient } from './cards/client';
import { createCardSource } from './cards/source';
import { RoomManager } from './rooms/RoomManager';
import { createDraftServer } from './server';

const cacheDir = fileURLToPath(new URL('../.cache', import.meta.url));
const source = createCardSource({ client: createScryfallClient(), cacheDir });
const manager = new RoomManager({ getSetCards: (code) => source.getSetCards(code) });
const { httpServer } = createDraftServer({ manager, listSets: () => source.listDraftableSets() });

setInterval(() => manager.sweep(), 60_000).unref();

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, () => console.log(`Draft server listening on http://localhost:${port}`));
