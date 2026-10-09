import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProtectedHandler } from '../backend/public-http.mjs';
const code = 'fixture-demo-code-not-a-reap-key';
function setup() {
  const calls = [];
  const backend = { store: { data: { care: { enrollment: { status: 'REQUIRES_ACTION', nextAction: { url: 'https://secret.fixture.invalid' } } } } }, action: async (action, input) => { calls.push({ action, input }); return { ok: true }; } };
  const handler = createProtectedHandler(backend, { accessCode: code });
  const req = async ({ method = 'POST', url = '/api/reap', body = { action: 'view' }, headers = {}, remoteAddress = '127.0.0.1' } = {}) => {
    const request = { method, url, headers: { host: 'reap-demo.kampawng.com', origin: 'https://reap-demo.kampawng.com', 'content-type': 'application/json', ...headers }, socket: { remoteAddress }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } };
    const response = { writeHead(status, headers) { this.status = status; this.headers = headers; return this; }, end(body) { this.body = JSON.parse(body); } };
    await handler(request, response); return response;
  };
  return { req, calls };
}
test('public API requires separate demo login and secure signed session', async () => {
  const { req, calls } = setup(); assert.equal((await req()).status, 401); assert.equal(calls.length, 0);
  const login = await req({ url: '/api/login', body: { code } }); assert.equal(login.status, 200);
  assert.match(login.headers['set-cookie'], /HttpOnly; Secure; SameSite=Lax/);
  const cookie = login.headers['set-cookie'].split(';')[0];
  assert.equal((await req({ headers: { cookie } })).status, 200); assert.equal(calls.length, 1);
  assert.equal((await req({ headers: { cookie: cookie + 'tampered' } })).status, 401);
  for (const headers of [{ cookie, origin: 'https://attacker.invalid' }, { cookie, origin: undefined }, { cookie, host: 'attacker.invalid' }]) assert.equal((await req({ headers })).status, 403);
  assert.equal((await req({ headers: { cookie }, remoteAddress: '192.0.2.1' })).status, 403);
});
test('public snapshot does not contact Reap or expose hosted enrollment links', async () => {
  const { req, calls } = setup(); const r = await req({ method: 'GET', url: '/api/status' });
  assert.equal(r.status, 200); assert.equal(r.body.authenticated, false); assert.equal(r.body.stage, 'REQUIRES_ACTION');
  assert.doesNotMatch(JSON.stringify(r.body), /secret|nextAction|fixture-demo-code/); assert.equal(calls.length, 0);
});
test('local operator path cannot be obtained via forwarded headers; search stays demo-only', async () => {
  const { req, calls } = setup(); const headers = { host: '127.0.0.1:4174', origin: 'http://127.0.0.1:4174' };
  assert.equal((await req({ headers })).status, 200);
  assert.equal((await req({ headers: { ...headers, 'cf-connecting-ip': '192.0.2.1' } })).status, 403);
  assert.equal((await req({ headers, body: { action: 'search', input: { query: 'arbitrary external URL' } } })).status, 400);
  assert.equal(calls.length, 1);
});
test('login attempts are bounded and errors contain no submitted code', async () => {
  const { req } = setup();
  for (let i = 0; i < 7; i++) { const r = await req({ url: '/api/login', body: { code: 'incorrect-secret-fixture' } }); assert.equal(r.status, i < 6 ? 401 : 429); assert.doesNotMatch(JSON.stringify(r.body), /incorrect-secret-fixture/); }
});

test('read-only completed example does not resolve a browser or call a provider', async()=>{
 let resolutions=0;const example={kind:'PREVIOUS_COMPLETED_SANDBOX_ORDER',readOnly:true,receipt:{finalCents:4390}};
 const handler=createProtectedHandler(()=>{resolutions++;throw new Error('must not resolve');},{accessCode:code,publicSessions:true,completedExample:example});
 const request={method:'GET',url:'/api/example',headers:{host:'reap-demo.kampawng.com'},socket:{remoteAddress:'127.0.0.1'}};
 const response={writeHead(status){this.status=status;return this},end(body){this.body=JSON.parse(body)}};
 await handler(request,response);assert.equal(response.status,200);assert.deepEqual(response.body,example);assert.equal(resolutions,0);
});
