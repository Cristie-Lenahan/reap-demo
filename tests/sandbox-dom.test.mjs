// Executes the actual built UI against the real workflow with synthetic HTTP fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { ReapClient } from '../backend/client.mjs';
import { DurableStore } from '../backend/store.mjs';
import { DemoBackend } from '../backend/workflow.mjs';
import { fixtureFetch, ids } from './backend-fixture.mjs';
let parseHTML; try { ({ parseHTML } = await import(process.env.KAMPAWNG_DOM_MODULE || 'linkedom')); } catch {}
test('built sandbox UI requires separate consent and ACTIVE enrollment, then renders one receipt on replay', { skip: !parseHTML && 'Optional linkedom dependency unavailable' }, async t => {
  const fixture = fixtureFetch(); const dir = await mkdtemp(join(tmpdir(), 'kampawng-ui-'));
  const store = await new DurableStore(dir).open();
  t.after(async () => { await store.close(); await rm(dir, { recursive: true, force: true }); });
  const backend = new DemoBackend({ store, client: new ReapClient({ enabled: true, apiKey: 'fixture-placeholder', fetchImpl: fixture.fetchImpl }), now: () => fixture.state.now, simulateCompleted: true });
  const html = await readFile(new URL('../dist/sandbox.html', import.meta.url), 'utf8');
  const { document, window } = parseHTML(html);
  const calls = []; let authenticated = true;
  const fetch = async (url, options) => {
    if (url === '/api/status') return Response.json({ authenticated, stage: 'READY' });
    const input = JSON.parse(options.body); calls.push(input);
    if (url === '/api/login') { authenticated = input.code === 'fixture-demo-code'; return Response.json(authenticated ? {} : { error: 'INVALID_ACCESS_CODE' }, { status: authenticated ? 200 : 401 }); }
    try { return Response.json(await backend.action(input.action, input.input)); }
    catch (error) { return Response.json({ error: error.code }, { status: error.status || 500 }); }
  };
  class FixtureDate extends Date { static now() { return fixture.state.now; } }
  runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], createContext({ document, fetch, Date: FixtureDate, console, URLSearchParams, location: { search: '' } }), { timeout: 3000 });
  const flush = async () => { for (let i = 0; i < 200; i++) { await new Promise(r => setTimeout(r, 2)); if (document.querySelector('#sandbox-status').textContent !== 'Please wait…' && document.querySelector('#sandbox-flow').children.length) return; } throw new Error('UI_ASYNC_TIMEOUT'); };
  const click = async selector => { const el = document.querySelector(selector); assert.ok(el, selector); el.dispatchEvent(new window.Event('click', { bubbles: true })); await flush(); };
  await flush();
  await click('[data-action=search]'); await click('[data-action=details]');
  const before = calls.length; await click('[data-action=choose]'); assert.equal(calls.length, before); assert.match(document.querySelector('#sandbox-status').textContent, /Tick the box/);
  document.querySelector('#product-consent').checked = true; await click('[data-action=choose]');
  await click('[data-action=quote]'); await click('[data-action=shipping]');
  await click('[data-action=approveCart]'); assert.equal(store.data.care.approval, null);
  document.querySelector('#delivery-consent').checked = true; await click('[data-action=approveCart]');
  await click('[data-action=enrollment]'); assert.equal(document.querySelector('[data-action=checkout]').disabled, true);
  fixture.state.enrollmentStatus = 'ACTIVE'; await click('[data-action=enrollmentStatus]');
  assert.equal(document.querySelector('[data-action=checkout]').disabled, false);
  await click('[data-action=checkout]'); assert.match(document.querySelector('#sandbox-flow').textContent, /Your test order is complete/); assert.match(document.querySelector('#sandbox-flow').textContent, /payment approval was not tested/); assert.match(document.querySelector('#sandbox-flow').textContent, new RegExp(ids.checkout));
  await click('[data-action=checkout]'); assert.equal(fixture.state.calls.filter(c => c.path === '/agentic/checkouts').length, 1); assert.equal(store.data.care.receipt.careLogEntries, 1);
  await click('[data-action=startNew]'); assert.equal(store.data.archives.length, 1); assert.equal(store.data.care.receipt, null); assert.ok(document.querySelector('[data-action=search]'));
});
test('hosted return reconciles ACTIVE enrollment without automatically creating checkout', { skip: !parseHTML && 'Optional linkedom dependency unavailable' }, async t => {
  const fixture = fixtureFetch(); const dir = await mkdtemp(join(tmpdir(), 'kampawng-return-')); const store = await new DurableStore(dir).open();
  t.after(async () => { await store.close(); await rm(dir, { recursive: true, force: true }); });
  const backend = new DemoBackend({ store, client: new ReapClient({ enabled: true, apiKey: 'fixture-placeholder', fetchImpl: fixture.fetchImpl }), now: () => fixture.state.now, simulateCompleted: true });
  await backend.action('enrollment'); fixture.state.enrollmentStatus = 'ACTIVE';
  const html = await readFile(new URL('../dist/sandbox.html', import.meta.url), 'utf8'); const { document } = parseHTML(html);
  const actions = []; const fetch = async (url, options) => {
    if (url === '/api/status') return Response.json({ authenticated: true, stage: 'REQUIRES_ACTION' });
    const input = JSON.parse(options.body); actions.push(input.action); return Response.json(await backend.action(input.action, input.input));
  };
  class FixtureDate extends Date { static now() { return fixture.state.now; } }
  runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], createContext({ document, fetch, Date: FixtureDate, console, URLSearchParams, location: { search: '?reap-return=1' } }), { timeout: 3000 });
  for (let i = 0; i < 200 && !document.querySelector('#sandbox-status').textContent.includes('Your test card is ready'); i++) await new Promise(r => setTimeout(r, 2));
  assert.match(document.querySelector('#sandbox-status').textContent, /Your test card is ready/);
  assert.ok(actions.includes('enrollmentStatus')); assert.ok(!actions.includes('checkout'));
  assert.equal(store.data.care.enrollment.status, 'ACTIVE'); assert.equal(store.data.care.checkout, null);
});

test('pending checkout exposes owner approval link and hosted return reconciles existing checkout only', { skip: !parseHTML && 'Optional linkedom dependency unavailable' }, async () => {
  const html = await readFile(new URL('../dist/sandbox.html', import.meta.url), 'utf8'); const { document } = parseHTML(html); const actions = [];
  const pending = { id: ids.checkout, status: 'REQUIRES_ACTION', nextAction: { type: 'REDIRECT', url: 'https://sandbox.collect.prava.space/?fixture=owner-only' } };
  const view = { products: [], selection: null, enrollment: { id: ids.enrollment, status: 'ACTIVE' }, quote: { id: ids.quote }, checkout: pending, receipt: null, budgetCents: 6500, permissionExpiresAt: '2099-01-01T00:00:00Z' };
  const fetch = async (url, options) => { if(url === '/api/status') return Response.json({ authenticated: true }); const {action} = JSON.parse(options.body); actions.push(action); return Response.json(action === 'view' ? view : pending); };
  runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], createContext({ document, fetch, Date, console, URLSearchParams, location: { search: '?reap-return=1' } }), { timeout: 3000 });
  for(let i=0;i<200 && !document.querySelector('#sandbox-status').textContent.includes('Your test order is');i++) await new Promise(r=>setTimeout(r,2));
  assert.match(document.querySelector('#sandbox-status').textContent,/waiting for you/); assert.ok(actions.includes('status')); assert.ok(!actions.includes('checkout')); assert.ok(!actions.includes('enrollmentStatus'));
  assert.equal(document.querySelector('a[href*="fixture=owner-only"]').textContent,'Approve on secure page');
});

test('earlier completed example makes only a read-only request and exposes no purchasing action', {skip:!parseHTML}, async()=>{
 const html=await readFile(new URL('../dist/sandbox.html',import.meta.url),'utf8');const {document}=parseHTML(html);const calls=[];
 const fetch=async(url,options)=>{calls.push({url,method:options?.method||'GET'});return Response.json({product:'Cat food',size:'2kg',receipt:{finalCents:4390,orderId:'old-order',checkoutId:'old-checkout',completedAt:'2026-10-09T09:00:00Z',careLogEntries:1,simulationRequested:true,hostedApprovalRequired:true}});};
 runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],createContext({document,fetch,Date,console,URLSearchParams,location:{search:'?example=1'}}));
 for(let i=0;i<100&&!document.querySelector('#sandbox-status').textContent.includes('earlier');i++)await new Promise(r=>setTimeout(r,2));
 assert.deepEqual(calls,[{url:'/api/example',method:'GET'}]);assert.match(document.querySelector('#sandbox-flow').textContent,/separate from your current cart/);assert.equal(document.querySelector('[data-action]'),null);
});
