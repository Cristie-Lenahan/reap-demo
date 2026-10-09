// Runs the actual portable app against a DOM parser, not a browser or renderer.
// Optional dev-only dependency; never included in the demo or required to use it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
let parseHTML;
try { ({ parseHTML } = await import(process.env.KAMPAWNG_DOM_MODULE || 'linkedom')); } catch { /* Optional dev-only dependency. */ }
const html = await readFile(new URL('../dist/kampawng-demo.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function app(registry = false) {
  const { document, window: domWindow } = parseHTML(html);
  const timers = [], navigation = [], windowListeners = new Map();
  const state = { tool: null, focused: null, scrolled: null };
  domWindow.HTMLElement.prototype.focus = function() { state.focused = this; };
  domWindow.HTMLElement.prototype.scrollIntoView = function() { state.scrolled = this; };
  if (registry) document.modelContext = { registerTool(tool) { state.tool = tool; } };
  const history = {
    replaceState(value, _, url) { navigation[navigation.length ? navigation.length - 1 : 0] = { value, url }; },
    pushState(value, _, url) { navigation.push({ value, url }); }
  };
  const window = { addEventListener(type, listener) { windowListeners.set(type, listener); } };
  const context = createContext({ document, window, history, AbortController, console, setTimeout(fn) { timers.push(fn); } });
  runInContext(script, context, { timeout: 3000 });
  const query = selector => { const el = document.querySelector(selector); assert.ok(el, `Expected ${selector}`); return el; };
  function click(selector) { query(selector).dispatchEvent(new domWindow.Event('click', { bubbles: true })); }
  function change(selector, value) {
    const el = query(selector);
    if (el.tagName === 'SELECT') {
      Array.from(el.options).forEach(o => o.removeAttribute('selected'));
      const option = Array.from(el.options).find(o => o.value === value); assert.ok(option); option.setAttribute('selected', '');
    }
    else el.value = value;
    el.dispatchEvent(new domWindow.Event('change', { bubbles: true }));
  }
  function flush() { while (timers.length) timers.shift()(); }
  function search(scenario = 'normal', meals = '2') {
    change('#scenario', scenario); change('#meals', meals); click('[data-action="search"]'); flush();
  }
  function cart() { click('[data-action="select"][data-offer="exact"]'); }
  function checkout() { cart(); click('[data-action="approve-cart"]'); }
  return { document, state, query, click, change, flush, search, cart, checkout,
    flow: () => query('#flow').textContent,
    pop(stage) { windowListeners.get('popstate')({ state: { revision: 2, stage } }); }
  };
}
const domTest = (name, fn) => test(name, { skip: !parseHTML && 'Optional linkedom dependency unavailable' }, fn);
domTest('portable app renders, completes exact cart and returns one receipt on repeated clicks', () => {
  const a = app(); assert.match(a.flow(), /A little low/); a.search('duplicate'); a.checkout();
  a.click('[data-action="complete"]'); a.click('[data-action="complete"]'); a.flush();
  assert.match(a.flow(), /Care log · 1 entry/); assert.match(a.flow(), /SIM-0001/);
  a.click('[data-action="replay"]'); assert.match(a.flow(), /same receipt/); assert.match(a.flow(), /Care log · 1 entry/);
});
domTest('substitution has separate owner choice and denial remains blocked', () => {
  const a = app(); a.search('substitute'); a.click('[data-offer="substitute"]');
  assert.match(a.flow(), /Change Milo’s recipe/); a.click('[data-action="approve-substitute"]');
  a.click('[data-action="approve-cart"]'); a.click('[data-action="complete"]'); a.flush();
  assert.match(a.flow(), /owner explicitly chose/);
  a.search('denied'); a.click('[data-offer="substitute"]'); a.click('[data-action="deny-substitute"]');
  assert.match(a.flow(), /diet has not been changed/); assert.equal(a.query('button[data-offer="substitute"]').disabled, true);
});
domTest('expired and overspend controls block checkout in the rendered app', () => {
  const a = app(); for (const scenario of ['expired', 'budget']) {
    a.search(scenario); a.cart(); a.click('[data-action="approve-cart"]');
    assert.match(a.flow(), /Checkout blocked/); assert.equal(a.document.querySelector('[data-action="complete"]'), null);
  }
});
domTest('cancel and back invalidate pending checkout completion', () => {
  const a = app(); a.search(); a.checkout(); a.click('[data-action="complete"]');
  a.click('[data-action="back"]'); a.flush(); assert.match(a.flow(), /Checkout cancelled/);
  assert.equal(a.document.querySelector('.receipt-meta'), null);
  a.click('[data-action="approve-cart"]'); a.pop('cart'); a.flush(); assert.match(a.flow(), /clear boundaries/);
  assert.equal(a.document.querySelector('[data-action="complete"]'), null);
});
domTest('reset during search or payment discards stale timers and focuses new flow', () => {
  const a = app(); a.change('#meals', '2'); a.click('[data-action="search"]'); a.click('#reset-top'); a.flush();
  assert.match(a.flow(), /A little low/); assert.match(a.state.focused.textContent, /A little low/);
  a.search(); a.checkout(); a.click('[data-action="complete"]'); a.click('#reset-top'); a.flush();
  assert.match(a.flow(), /A little low/); assert.equal(a.document.querySelector('.receipt-meta'), null);
});
domTest('clarification changes visible deadline and offers show no checkout for tonight', () => {
  const a = app(); a.search('normal', '1'); assert.match(a.query('#care-deadline').textContent, /9 Oct.*8:00 pm/);
  assert.match(a.flow(), /No listed delivery reaches tonight/); a.cart(); assert.match(a.flow(), /after the care deadline/);
  assert.equal(a.document.querySelector('[data-action="approve-cart"]'), null);
});
domTest('quantity invalidation and discovery-only merchants cannot enter checkout', () => {
  const a = app(); a.search(); a.click('[data-offer="discovery"]'); assert.match(a.flow(), /Discovery only/);
  a.cart(); a.change('#quantity', '2'); a.click('[data-action="approve-cart"]'); assert.match(a.flow(), /limit: 1/);
  assert.equal(a.document.querySelector('[data-action="complete"]'), null);
});
domTest('portable artifact is self-contained and read-only tool works with a simulated registry', () => {
  const a = app(true); assert.equal(a.state.tool.name, 'read_care_request');
  assert.equal(a.state.tool.execute({}).simulation, true); assert.equal(a.state.tool.execute({}).receiptCount, 0);
  assert.throws(() => a.state.tool.execute({ approve: true }), /empty object/);
  assert.equal(a.document.querySelector('script[src], link[rel="stylesheet"]'), null);
  assert.ok(a.query('.pet-photo img').getAttribute('src').startsWith('data:image/png;base64,'));
});
