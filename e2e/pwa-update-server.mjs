import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'dist/pwa-update-fixture');
const version = JSON.parse(await readFile(path.join(root, 'dist/app-version.json'), 'utf8'));
process.env.VITE_APP_SHELL_VERSION = version.shell;
await build({
  configFile: false,
  root: path.join(root, 'e2e/fixtures/pwa-update'),
  resolve: { alias: { '@': path.join(root, 'src') } },
  esbuild: { jsx: 'automatic' },
  build: { outDir: fixture, emptyOutDir: true },
  logLevel: 'warn',
});

let deployment = 0;
let incompatibleApi = false;
const types = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};
createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/__deploy') {
    deployment += 1;
    incompatibleApi = url.searchParams.has('incompatible-api');
    response.end(String(deployment));
    return;
  }
  const relative =
    url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (relative.split(/[\\/]/).includes('..')) {
    response.writeHead(400).end();
    return;
  }
  try {
    let data;
    try {
      data = await readFile(path.join(fixture, relative));
    } catch {
      data = await readFile(path.join(root, 'dist', relative));
    }
    response.setHeader('Content-Type', types[path.extname(relative)] ?? 'application/octet-stream');
    if (relative === 'app-sw.js') {
      const prefix = incompatibleApi
        ? `self.addEventListener('message', event => { if (event.data?.type === 'GET_APP_VERSION') { event.stopImmediatePropagation(); event.ports[0]?.postMessage(${JSON.stringify({ ...version, api: 999, transactionSchema: 1 })}); } });\n`
        : '';
      data = Buffer.concat([
        Buffer.from(prefix),
        data,
        Buffer.from(`\n// test deployment ${deployment}\n`),
      ]);
    }
    response.end(data);
  } catch {
    response.writeHead(404).end();
  }
}).listen(5178, '127.0.0.1');
