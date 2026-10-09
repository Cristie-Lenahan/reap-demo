import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadConfig, privateDir } from './backend/config.mjs';
import { ReapClient } from './backend/client.mjs';
import { DemoSessions } from './backend/sessions.mjs';
import { createProtectedHandler } from './backend/public-http.mjs';
const port = Number(process.env.KAMPAWNG_DEMO_PORT || 4174);
if (![4174, 4175].includes(port)) throw new Error('INVALID_DEMO_PORT');
const config = await loadConfig();
const client = new ReapClient({ enabled: true, apiKey: config.apiKey });
// This deployed lane always requests Reap simulated completion. It cannot opt into production.
const sessions = await new DemoSessions({ directory: `${privateDir}/browser-sessions`, secret: config.sessionSecret, legacySecret: config.accessCode, client }).open();
const api = createProtectedHandler(request => sessions.resolve(request), { accessCode: config.accessCode, port, publicSessions: true });
await readFile(new URL('dist/sandbox.html', import.meta.url));
const server = createServer(async (request, response) => {
  if (request.url?.startsWith('/api/')) return api(request, response);
  if (!['GET', 'HEAD'].includes(request.method)) return response.writeHead(405).end('Method not allowed');
  const path = request.url?.split('?')[0];
  const name = ['/', '/index.html', '/sandbox'].includes(path) ? 'sandbox.html' : path === '/concept' ? 'index.html' : null;
  if (!name) return response.writeHead(404).end('Not found');
  try {
    const bytes = await readFile(new URL(`dist/${name}`, import.meta.url));
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': bytes.length, 'cache-control': 'no-store', 'x-kampawng-build': createHash('sha256').update(bytes).digest('hex'), 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" }).end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(500).end('Build unavailable'); }
});
let closing = false;
async function close() { if (closing) return; closing = true; server.close(async () => { await sessions.close(); process.exit(0); }); }
process.on('SIGTERM', close); process.on('SIGINT', close);
server.on('error', async () => { await sessions.close(); process.exit(1); });
server.listen(port, '127.0.0.1', () => console.log(`Kampawng SG sandbox demo ready on loopback port ${port}; credentials and requests are never logged.`));
