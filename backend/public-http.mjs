import { createHmac, timingSafeEqual } from 'node:crypto';
import { AdapterError, fail, strict, text } from './client.mjs';
const equal = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function createProtectedHandler(backend, { accessCode, port = 4174, now = () => Date.now(), publicSessions = false }) {
  const origin = 'https://reap-demo.kampawng.com';
  const sign = value => createHmac('sha256', accessCode).update(value).digest('base64url');
  let attempts = [], recent = [], inFlight = 0;
  return async (request, response) => {
    const send = (status, data, extra = {}) => response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(request.demoSessionCookie ? { 'set-cookie': request.demoSessionCookie } : {}), ...extra }).end(JSON.stringify(data));
    try {
      const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket?.remoteAddress);
      const local = loopback && [`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host) && !Object.keys(request.headers).some(k => /^(?:forwarded$|x-forwarded-|cf-)/i.test(k));
      if (!loopback || (!local && request.headers.host !== 'reap-demo.kampawng.com')) fail('INVALID_HOST', 403);
      const cookie = request.headers.cookie?.match(/(?:^|;\s*)kampawng_demo=([A-Za-z0-9_.-]+)/)?.[1] || '';
      const [expiry, signature] = cookie.split('.');
      const authenticated = !!signature && Number(expiry) > now() && Number(expiry) <= now() + 8 * 3600000 && equal(signature, sign(expiry));
      if (request.method === 'GET' && request.url === '/api/status') {
        // Public snapshot costs no Reap requests and never contains hosted-session URLs.
        const selected = typeof backend === 'function' ? await backend(request) : backend;
        const care = selected.store.data.care;
        return send(200, { revision: publicSessions ? 'kampawng-reap-shop-v2' : 'kampawng-reap-sandbox-v1', sandbox: true, authenticated: local || authenticated || publicSessions, stage: care?.receipt ? 'COMPLETED' : care?.checkout?.status || care?.enrollment?.status || (care?.quote ? 'QUOTED' : 'READY'), receipt: care?.receipt || null, hostedApprovalTested: care?.receipt?.hostedPaymentApprovalExercised === true });
      }
      if (request.method !== 'POST' || !['/api/login', '/api/reap'].includes(request.url)) fail('INVALID_REQUEST', 400);
      if (publicSessions && request.url === '/api/login') fail('INVALID_REQUEST', 404);
      if (request.headers.origin !== (local ? `http://${request.headers.host}` : origin) || request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') fail('INVALID_ORIGIN', 403);
      recent = recent.filter(t => t > now() - 60000);
      if (recent.length >= (publicSessions ? 120 : 30) || inFlight >= (publicSessions ? 6 : 2)) fail('RATE_LIMITED', 429);
      recent.push(now());
      if (request.url === '/api/reap' && !local && !authenticated && !publicSessions) fail('DEMO_ACCESS_REQUIRED', 401);
      let size = 0, parts = [];
      for await (const chunk of request) { size += chunk.length; if (size > 4096) fail('BODY_TOO_LARGE', 413); parts.push(chunk); }
      let input; try { input = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { fail('INVALID_JSON', 400); }
      if (request.url === '/api/login') {
        attempts = attempts.filter(t => t > now() - 60000);
        if (attempts.length >= 6) fail('RATE_LIMITED', 429);
        attempts.push(now()); strict(input, ['code']); text(input.code, 100);
        if (!equal(input.code, accessCode)) fail('INVALID_ACCESS_CODE', 401);
        const expires = String(now() + 8 * 3600000);
        return send(200, { authenticated: true }, { 'set-cookie': `kampawng_demo=${expires}.${sign(expires)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800` });
      }
      strict(input, ['action', 'input']); text(input.action, 30);
      if (input.action === 'search' && input.input?.query !== 'cat food') fail('DEMO_QUERY_ONLY', 400);
      inFlight++;
      try { const selected = typeof backend === 'function' ? await backend(request) : backend; send(200, await selected.action(input.action, input.input || {})); } finally { inFlight--; }
    } catch (error) { send(error instanceof AdapterError ? error.status : 500, { error: error instanceof AdapterError ? error.code : 'INTERNAL_ERROR' }); }
  };
}
