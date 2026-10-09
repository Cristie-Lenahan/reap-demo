import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const file = new URL('dist/index.html', import.meta.url);
const port = Number(process.env.KAMPAWNG_DEMO_PORT || 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('KAMPAWNG_DEMO_PORT must be a port from 1024 to 65535.');
await readFile(file); // Fail immediately if build has not run.
const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { allow: 'GET, HEAD' }).end('Method not allowed'); return; }
  const path = (request.url || '').split('?')[0];
  if (!['/', '/index.html', '/kampawng-demo.html'].includes(path)) { response.writeHead(404).end('Not found'); return; }
  try {
    const bytes = await readFile(file);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': bytes.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end(request.method === 'HEAD' ? undefined : bytes);
  }
  catch { response.writeHead(500).end('Build unavailable'); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Local preview: http://127.0.0.1:${port}/ (loopback only; no tunnel)`));
