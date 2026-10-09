import { AdapterError, fail, strict, text } from './client.mjs';
// A bounded local endpoint, not an authenticated public API. Do not expose through a tunnel.
export function createApiHandler(backend, { port = 4174, now = () => Date.now() } = {}) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]; let recent = [], inFlight = 0;
  return async function handle(request, response) {
    const send = (status, data) => response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end(JSON.stringify(data));
    try {
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket?.remoteAddress) || !hosts.includes(request.headers.host) || request.headers.origin !== `http://${request.headers.host}` || Object.keys(request.headers).some(k => /^(?:forwarded$|x-forwarded-|cf-)/i.test(k))) fail('LOCAL_ACCESS_REQUIRED', 403);
      if (request.method !== 'POST' || request.url !== '/api/reap' || request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') fail('INVALID_REQUEST', 400);
      if (!backend.ready) fail('SANDBOX_DISABLED', 503); // No file/env reads or network.
      recent = recent.filter(t => t > now() - 60000);
      if (recent.length >= 20 || inFlight >= 2) fail('RATE_LIMITED', 429);
      recent.push(now()); inFlight++;
      try {
        let size = 0, parts = [];
        for await (const chunk of request) { size += chunk.length; if (size > 4096) fail('BODY_TOO_LARGE', 413); parts.push(chunk); }
        let input; try { input = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { fail('INVALID_JSON', 400); }
        strict(input, ['action', 'input']); text(input.action, 30);
        send(200, await backend.action(input.action, input.input || {}));
      } finally { inFlight--; }
    } catch (error) { send(error instanceof AdapterError ? error.status : 500, { error: error instanceof AdapterError ? error.code : 'INTERNAL_ERROR' }); }
  };
}
