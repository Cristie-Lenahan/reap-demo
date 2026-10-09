import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReapClient, AdapterError, cents } from '../backend/client.mjs';
import { DurableStore } from '../backend/store.mjs';
import { DemoBackend, normalizeEnrollment } from '../backend/workflow.mjs';
import { createApiHandler } from '../backend/http.mjs';
import { fixtureFetch, ids, FIXTURE_NOW } from './backend-fixture.mjs';
const rejects = (promise, code) => assert.rejects(promise, e => e instanceof AdapterError && e.code === code);
async function setup(t, { simulateCompleted = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'kampawng-contract-'));
  let store = await new DurableStore(dir).open(); const fixture = fixtureFetch();
  const client = new ReapClient({ enabled: true, apiKey: 'unit-test-placeholder', fetchImpl: fixture.fetchImpl });
  let backend = new DemoBackend({ client, store, now: () => fixture.state.now, simulateCompleted });
  t.after(async () => { await store.close(); await rm(dir, { recursive: true, force: true }); });
  const action = (name, input) => backend.action(name, input);
  async function cart() {
    await action('search', { query: 'fixture cat food' }); await action('details', { productId: ids.product });
    await action('choose', { productId: ids.product, optionIds: [], substitute: false, ownerDecision: 'approve' });
    await action('quote'); await action('shipping', { shippingOptionId: 'express' });
  }
  async function ready() { await cart(); await action('approveCart', { acceptUnknownDelivery: true }); await action('enrollment'); fixture.state.enrollmentStatus = 'ACTIVE'; }
  async function restart() { await store.close(); store = await new DurableStore(dir).open(); backend = new DemoBackend({ client, store, now: () => fixture.state.now, simulateCompleted }); }
  return { ...fixture, action, cart, ready, restart, dir, store: () => store, backend: () => backend };
}
test('network is disabled by default, even when a key is provided', async () => {
  let calls = 0; const client = new ReapClient({ apiKey: 'unit-test-placeholder', fetchImpl: () => { calls++; } });
  await rejects(client.request('POST', '/agentic/products/search', { query: 'food' }), 'SANDBOX_DISABLED'); assert.equal(calls, 0);
});
test('fixed sandbox host/version, no redirects, bounded endpoints and simulation header', async t => {
  const f = await setup(t); await f.ready(); const receipt = await f.action('checkout');
  assert.equal(receipt.simulatedCheckout, true); assert.equal(receipt.hostedPaymentApprovalExercised, false);
  assert.equal(receipt.finalCents, 5950); assert.equal(receipt.careLogEntries, 1);
  for (const c of f.state.calls) { assert.equal(c.host, 'https://sg.sandbox.api.reap.global'); assert.equal(c.version, '2025-02-14'); assert.equal(c.redirect, 'error'); }
  const search = f.state.calls[0].body; assert.deepEqual(search.filters, { availability: 'AVAILABLE_ONLY' }); assert.deepEqual(search.context, { country: 'SG', currency: 'SGD' });
  const post = f.state.calls.find(c => c.path === '/agentic/checkouts'); assert.equal(post.simulated, 'COMPLETED'); assert.equal(post.key.length, 36);
  assert.equal(f.state.calls.at(-1).method, 'GET'); assert.equal(f.state.calls.at(-1).path, `/agentic/checkouts/${ids.checkout}`);
});
test('owner selection, consent and hosted payment approval remain separate', async t => {
  const f = await setup(t, { simulateCompleted: false }); await f.cart();
  await rejects(f.action('checkout'), 'CART_REAPPROVAL_REQUIRED');
  await rejects(f.action('approveCart', { acceptUnknownDelivery: false }), 'DELIVERY_REVIEW_REQUIRED');
  const consent = await f.action('approveCart', { acceptUnknownDelivery: true }); assert.equal(consent.paymentApproved, false);
  await f.action('enrollment'); await rejects(f.action('checkout'), 'ENROLLMENT_NOT_ACTIVE');
  f.state.enrollmentStatus = 'ACTIVE'; const pending = await f.action('checkout'); assert.equal(pending.status, 'REQUIRES_ACTION'); assert.equal(pending.nextAction.type, 'REDIRECT');
  assert.match(pending.message, /does not cancel/); assert.equal(f.state.calls.find(c => c.path === '/agentic/checkouts').simulated, undefined);
});
test('duplicate checkout and restart return one receipt with no new POST', async t => {
  const f = await setup(t); await f.ready(); const results = await Promise.all([f.action('checkout'), f.action('checkout'), f.action('checkout')]);
  assert.equal(new Set(results.map(x => x.orderId)).size, 1); await f.restart(); assert.equal((await f.action('checkout')).orderId, ids.order);
  assert.equal(f.state.calls.filter(c => c.path === '/agentic/checkouts' && c.method === 'POST').length, 1);
  assert.equal((await f.action('view')).receipt.careLogEntries, 1);
});
test('timeout keeps durable uncertain lock and never retries with a new key', async t => {
  const f = await setup(t); await f.ready(); f.state.throwAt = '/agentic/checkouts';
  await rejects(f.action('checkout'), 'PROVIDER_UNREACHABLE'); await f.restart(); f.state.throwAt = null;
  await rejects(f.action('checkout'), 'RESULT_UNCERTAIN'); await rejects(f.action('choose', { productId: ids.product, substitute: false, ownerDecision: 'approve' }), 'RESULT_UNCERTAIN');
  f.state.now += 25 * 3600000; await rejects(f.action('checkout'), 'RESULT_UNCERTAIN');
  assert.equal(f.state.calls.filter(c => c.path === '/agentic/checkouts').length, 1);
  const disk = await readFile(join(f.dir, 'state.json'), 'utf8'); assert.doesNotMatch(disk, /unit-test-placeholder|authorization|Untrusted error/i);
  assert.equal((await stat(join(f.dir, 'state.json'))).mode & 0o777, 0o600);
});
test('repricing invalidates consent and over-budget checkout is blocked', async t => {
  const f = await setup(t); await f.ready(); f.state.finalAmount = 80;
  await rejects(f.action('checkout'), 'OVER_BUDGET'); assert.equal(f.state.calls.filter(c => c.path === '/agentic/checkouts').length, 0);
  f.state.finalAmount = 60; await rejects(f.action('checkout'), 'CART_REAPPROVAL_REQUIRED');
});
test('expired quote and permission prevent checkout', async t => {
  const f = await setup(t); await f.ready(); f.state.quoteExpiry = '2026-10-09T07:59:00Z'; await rejects(f.action('checkout'), 'QUOTE_EXPIRED');
  f.state.now += 31 * 60000; await rejects(f.action('checkout'), 'PERMISSION_EXPIRED');
});
test('declined substitution cannot be selected later', async t => {
  const f = await setup(t); await f.action('search', { query: 'fixture food' }); await f.action('details', { productId: ids.product });
  await f.action('choose', { productId: ids.product, substitute: true, ownerDecision: 'decline' });
  await rejects(f.action('choose', { productId: ids.product, substitute: true, ownerDecision: 'approve' }), 'SUBSTITUTION_DECLINED');
  await rejects(f.action('quote'), 'OWNER_CHOICE_REQUIRED');
});
test('unknown fields, caller IDs and raw card input are refused', async t => {
  const f = await setup(t);
  await rejects(f.action('search', { query: 'food', apiKey: 'not-a-key' }), 'INVALID_INPUT');
  await rejects(f.action('details', { productId: 'undiscovered' }), 'PRODUCT_NOT_DISCOVERED');
  await rejects(f.action('enrollment', { cardNumber: 'fixture' }), 'INVALID_INPUT');
  await rejects(f.action('checkout', { quoteId: 'caller-controlled' }), 'INVALID_INPUT');
  await rejects(f.action('arbitraryProxy', { url: 'https://example.invalid' }), 'UNKNOWN_ACTION'); assert.equal(f.state.calls.length, 0);
});
test('HTTP security rejects public/forwarded/missing origin and keyless mode', async () => {
  let calls = 0; const backend = { ready: true, action: async () => { calls++; return { ok: true }; } };
  const handler = createApiHandler(backend);
  async function req({ headers = {}, remoteAddress = '127.0.0.1', method = 'POST', body = '{"action":"view"}' } = {}) {
    const request = { method, url: '/api/reap', socket: { remoteAddress }, headers: { host: '127.0.0.1:4174', origin: 'http://127.0.0.1:4174', 'content-type': 'application/json', ...headers }, async *[Symbol.asyncIterator]() { yield Buffer.from(body); } };
    const response = { writeHead(status) { this.status = status; return this; }, end(body) { this.body = JSON.parse(body); } };
    await handler(request, response); return response;
  }
  assert.equal((await req()).status, 200);
  for (const headers of [{ host: 'reap-demo.kampawng.com', origin: 'https://reap-demo.kampawng.com' }, { origin: undefined }, { origin: 'null' }, { 'cf-connecting-ip': '127.0.0.1' }, { forwarded: 'for=127.0.0.1' }, { 'x-forwarded-host': 'localhost' }]) assert.equal((await req({ headers })).status, 403);
  assert.equal((await req({ remoteAddress: '192.0.2.1' })).status, 403);
  assert.equal((await req({ method: 'GET' })).status, 400);
  assert.equal((await req({ body: 'x'.repeat(4097) })).status, 413); assert.equal(calls, 1);
  backend.ready = false; assert.equal((await req()).body.error, 'SANDBOX_DISABLED'); assert.equal(calls, 1);
});
test('unknown errors are sanitized and request rate is bounded', async () => {
  const handler = createApiHandler({ ready: true, action: async () => { throw new Error('Sensitive upstream error fixture'); } });
  for (let i = 0; i < 21; i++) {
    const request = { method: 'POST', url: '/api/reap', socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:4174', origin: 'http://localhost:4174', 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from('{"action":"view"}'); } };
    const response = { writeHead(status) { this.status = status; return this; }, end(body) { this.body = body; } }; await handler(request, response);
    assert.doesNotMatch(response.body, /Sensitive/); assert.equal(response.status, i < 20 ? 500 : 429);
  }
});
test('money rejects foreign currency, negatives, fractional cents and NaN', () => {
  assert.equal(cents({ amount: 59.5, currency: 'SGD' }), 5950);
  for (const amount of [-1, NaN, Infinity, 1.001]) assert.throws(() => cents({ amount, currency: 'SGD' }), AdapterError);
  assert.throws(() => cents({ amount: 1, currency: 'USD' }), AdapterError);
});
test('store refuses a second writer, changed operation bodies and interrupted dispatch', async t => {
  const f = await setup(t); const other = new DurableStore(f.dir); await rejects(other.open(), 'STORE_ALREADY_OWNED');
  await f.store().exclusive(() => f.store().mutation('fixture-op', { n: 1 }, async () => ({ id: 'result' }), x => x));
  await rejects(f.store().exclusive(() => f.store().mutation('fixture-op', { n: 2 }, async () => { throw new Error(); }, x => x)), 'OPERATION_BODY_CHANGED');
  f.store().data.operations.crashed = { key: 'fixture-idempotency', hash: 'fixture-hash', state: 'DISPATCHING', createdAt: new Date(FIXTURE_NOW).toISOString() }; await f.store().save(); await f.restart(); assert.equal(f.store().data.operations.crashed.state, 'UNCERTAIN');
});
test('an invalid successful checkout response locks intent instead of creating another', async t => {
  const f = await setup(t); await f.ready(); f.state.responseOverride = { unexpected: true }; f.state.overridePath = '/agentic/checkouts';
  await rejects(f.action('checkout'), 'INVALID_PROVIDER_RESPONSE'); await f.restart(); f.state.responseOverride = null;
  await rejects(f.action('checkout'), 'RESULT_UNCERTAIN'); assert.equal(f.state.calls.filter(c => c.path === '/agentic/checkouts').length, 1);
});
test('observed Reap sandbox enrollment host is allowed; unrelated hosts stay blocked', () => {
  const raw = { id: ids.enrollment, status: 'REQUIRES_ACTION', owner: { type: 'CLIENT_REFERENCE', id: 'kampawng-synthetic-asha' }, nextAction: { type: 'REDIRECT', url: 'https://sandbox.collect.prava.space/?test-fixture=1' } };
  assert.equal(new URL(normalizeEnrollment(raw).nextAction.url).hostname, 'sandbox.collect.prava.space');
  for (const url of ['https://collect.prava.space/', 'https://sandbox.collect.prava.space.attacker.invalid/', 'http://sandbox.collect.prava.space/', 'https://user:password@sandbox.collect.prava.space/']) assert.throws(() => normalizeEnrollment({ ...raw, nextAction: { type: 'REDIRECT', url } }), AdapterError);
});
test('owner renewal preserves intent and invalidates cart review; cannot unlock completed checkout', async t => {
  const f = await setup(t); await f.ready(); const intent = f.store().data.care.id;
  f.state.now += 31 * 60000; await f.action('renewPermission', { ownerDecision: 'approve' });
  assert.equal(f.store().data.care.id, intent); assert.equal(f.store().data.care.approval, null);
  f.state.quoteExpiry = new Date(f.state.now + 15 * 60000).toISOString(); await f.action('quote'); await f.action('shipping', { shippingOptionId: 'express' }); await f.action('approveCart', { acceptUnknownDelivery: true }); await f.action('checkout');
  await rejects(f.action('renewPermission', { ownerDecision: 'approve' }), 'CHECKOUT_ALREADY_STARTED');
});
test('new hosted session refuses ACTIVE enrollment and keeps prior resource and intent', async t => {
  const f = await setup(t); await f.ready(); const intent = f.store().data.care.id;
  await rejects(f.action('renewEnrollment', { ownerDecision: 'approve' }), 'ENROLLMENT_ALREADY_ACTIVE');
  assert.equal(f.state.calls.filter(c => c.path === '/agentic/enrollments').length, 1);
  f.state.enrollmentStatus = 'EXPIRED';
  f.state.overridePath = '/agentic/enrollments';
  f.state.responseOverride = { id: 'renewed_enrollment_fixture', status: 'REQUIRES_ACTION', owner: { type: 'CLIENT_REFERENCE', id: 'kampawng-synthetic-asha' }, nextAction: { type: 'REDIRECT', url: 'https://sandbox.collect.prava.space/?fixture=renewed' } };
  const next = await f.action('renewEnrollment', { ownerDecision: 'approve' });
  assert.equal(next.status, 'REQUIRES_ACTION'); assert.equal(f.store().data.care.id, intent); assert.equal(f.store().data.care.approval, null);
  assert.deepEqual(f.store().data.care.enrollmentHistory, [{ id: ids.enrollment, status: 'EXPIRED', superseded: true }]);
  const posts = f.state.calls.filter(c => c.path === '/agentic/enrollments'); assert.equal(posts.length, 2); assert.notEqual(posts[0].key, posts[1].key);
});

test('hosted approval required despite simulation request is retained through completion and restart', async t => {
  const f = await setup(t); await f.ready();
  f.state.overridePath = '/agentic/checkouts';
  f.state.responseOverride = { id: ids.checkout, status: 'REQUIRES_ACTION', quoteId: ids.quote, enrollmentId: ids.enrollment, orderId: null, finalAmount: { amount: 59.5, currency: 'SGD' }, nextAction: { type: 'REDIRECT', url: 'https://sandbox.collect.prava.space/?fixture=checkout' } };
  assert.equal((await f.action('checkout')).status, 'REQUIRES_ACTION');
  f.state.overridePath = null; f.state.responseOverride = null; f.state.checkoutStatus = 'COMPLETED';
  await f.restart(); const receipt = await f.action('status');
  assert.equal(receipt.simulationRequested, true); assert.equal(receipt.simulatedCheckout, false); assert.equal(receipt.hostedApprovalRequired, true);
  assert.equal((await f.action('checkout')).checkoutId, receipt.checkoutId);
  assert.equal(f.state.calls.filter(c => c.path === '/agentic/checkouts' && c.method === 'POST').length, 1);
});

test('a new shopping run archives a confirmed receipt and keeps original durable checkout protection', async t => {
  const f = await setup(t); await f.ready(); const receipt = await f.action('checkout'); const priorId = f.store().data.care.id;
  f.backend().uniqueOwners = true;
  await f.action('startNew', { ownerDecision: 'approve' });
  assert.notEqual(f.store().data.care.id, priorId); assert.match(f.store().data.care.owner.id, /^kampawng-demo-/);
  assert.deepEqual(f.store().data.archives[0].receipt, receipt); assert.equal(f.store().data.care.approval, null); assert.equal(f.store().data.care.enrollment, null);
  await f.restart(); assert.equal(f.store().data.archives[0].receipt.checkoutId, receipt.checkoutId);
  await rejects(f.action('startNew', { ownerDecision: 'approve' }), 'FINISH_CURRENT_REQUEST');
  assert.equal(f.state.calls.filter(c => c.path === '/agentic/checkouts' && c.method === 'POST').length, 1);
  assert.equal(f.store().data.operations[`${priorId}:checkout`].state,'COMPLETE');
});
