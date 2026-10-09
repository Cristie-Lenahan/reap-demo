import { readFile } from 'node:fs/promises';
// This process consumes the user's private file; neither credentials nor raw responses are printed.
const envPath = '/home/amk1/.config/kampawng-reap-demo/reap-sandbox.env';
const values = Object.fromEntries((await readFile(envPath, 'utf8')).split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2')]; }));
if (!values.REAP_API_KEY || values.REAP_BASE_URL !== 'https://sg.sandbox.api.reap.global' || values.REAP_VERSION !== '2025-02-14') { console.log(JSON.stringify({ checked: false, reason: 'Private configuration missing or not the approved SG sandbox/version.' })); process.exit(1); }
try {
  const response = await fetch(`${values.REAP_BASE_URL}/agentic/products/search`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${values.REAP_API_KEY}`, 'Reap-Version': values.REAP_VERSION, 'content-type': 'application/json' }, body: JSON.stringify({ query: 'cat food', context: { country: 'SG', currency: 'SGD' }, filters: { availability: 'AVAILABLE_ONLY' }, pagination: { limit: 5 } }) });
  const body = await response.json().catch(() => null);
  // Only structural metadata, never arbitrary provider text or auth echoes.
  console.log(JSON.stringify({ checked: true, operation: 'products/search (non-purchasing)', environment: 'SG sandbox', httpStatus: response.status, accepted: response.ok, topLevelFields: response.ok && body && typeof body === 'object' ? Object.keys(body).filter(k => /^[A-Za-z_]{1,40}$/.test(k)).slice(0, 20) : [], errorCode: !response.ok && typeof body?.code === 'string' && /^[A-Z_]{1,70}$/.test(body.code) ? body.code : null }));
} catch (error) { console.log(JSON.stringify({ checked: false, reason: error.name === 'TimeoutError' ? 'Request timed out.' : 'Sandbox network request failed.', errorType: error.name })); process.exitCode = 1; }
