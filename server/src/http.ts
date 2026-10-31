import { createReadStream, existsSync, statSync } from 'node:fs';
import type { RequestListener } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const isFile = (path: string) => existsSync(path) && statSync(path).isFile();

export function createHttpHandler(opts: { staticDir: string | null }): RequestListener {
  const root = opts.staticDir ? resolve(opts.staticDir) : null;

  const handle: RequestListener = (req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('ok');
      return;
    }
    if (!root || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.writeHead(404);
      res.end();
      return;
    }

    let file: string;
    try {
      file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!isFile(file)) file = join(root, 'index.html'); // client-side routes
    if (!isFile(file)) {
      res.writeHead(404);
      res.end();
      return;
    }

    const immutable = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res);
  };

  return (req, res) => {
    try {
      handle(req, res);
    } catch (err) {
      console.error('http handler error', err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  };
}
