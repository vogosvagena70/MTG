import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpHandler } from '../src/http';

let server: Server | null = null;

async function serve(staticDir: string | null): Promise<string> {
  server = createServer(createHttpHandler({ staticDir }));
  await new Promise<void>((r) => server!.listen(0, r));
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

function makeDist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mtg-dist-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<div id="root"></div>');
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
  return dir;
}

describe('http handler', () => {
  it('answers health checks', async () => {
    const base = await serve(null);
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('returns 404 for pages when no static dir is configured', async () => {
    const base = await serve(null);
    expect((await fetch(`${base}/`)).status).toBe(404);
  });

  it('serves index.html, assets and an SPA fallback', async () => {
    const base = await serve(makeDist());
    const index = await fetch(`${base}/`);
    expect(index.headers.get('content-type')).toContain('text/html');
    expect(await index.text()).toBe('<div id="root"></div>');
    const asset = await fetch(`${base}/assets/app.js`);
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    const deep = await fetch(`${base}/some/route?room=KX7Q`);
    expect(await deep.text()).toBe('<div id="root"></div>');
  });

  it('rejects path traversal', async () => {
    const base = await serve(makeDist());
    expect((await fetch(`${base}/%2e%2e%2fsecret.txt`)).status).toBe(403);
  });
});
