import { fileURLToPath } from 'node:url';
import { createScryfallClient } from './cards/client';
import { createCardSource } from './cards/source';
import { createHttpHandler } from './http';
import { Battles } from './rooms/battles';
import { RoomManager } from './rooms/manager';
import { createDraftServer } from './server';

const cacheDir = fileURLToPath(new URL('../.cache', import.meta.url));
const source = createCardSource({ client: createScryfallClient(), cacheDir });
const manager = new RoomManager({
  getSetCards: (code) => source.getSetCards(code),
  getSetName: async (code) => {
    try {
      return (await source.listDraftableSets()).find((s) => s.code === code)?.name;
    } catch {
      return undefined;
    }
  },
});
const staticDir =
  process.env.NODE_ENV === 'production' ? fileURLToPath(new URL('../../client/dist', import.meta.url)) : null;
let battles: Battles | undefined;
const { httpServer } = createDraftServer({
  manager,
  createBattles: (hooks) => (battles = new Battles({ manager, ...hooks })),
  listSets: () => source.listDraftableSets(),
  getSetCards: (code) => source.getSetCards(code),
  requestListener: createHttpHandler({ staticDir }),
});

setInterval(() => {
  try {
    manager.sweep();
    battles?.sweep();
  } catch (err) {
    console.error('[server] sweep failed', err);
  }
}, 60_000).unref();

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, () => console.log(`Draft server listening on http://localhost:${port}`));
