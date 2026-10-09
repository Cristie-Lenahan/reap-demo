// All fixtures, prices, availability and delivery windows are synthetic.
export const DEMO_NOW = Date.parse('2026-10-09T15:30:00+08:00');
export const DEADLINE = Date.parse('2026-10-10T18:00:00+08:00');
export const EARLY_DEADLINE = Date.parse('2026-10-09T20:00:00+08:00');
export const PRODUCT = { sku: 'pp-indoor-chicken-2kg', name: 'Paw Pantry Indoor Chicken', variant: 'Dry food · chicken recipe · 2 kg' };
export const SCENARIOS = {
  normal: 'Usual item sold out',
  substitute: 'No exact match in time',
  denied: 'Owner declines substitute',
  expired: 'Permission expired',
  budget: 'Price exceeds budget',
  duplicate: 'Repeated payment click'
};
export const money = cents => new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' }).format(cents / 100);
export const dateLabel = timestamp => new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(timestamp);
const TOMORROW = Date.parse('2026-10-10T00:00:00+08:00');
export function makeOffers(scenario) {
  const noExact = ['substitute', 'denied'].includes(scenario);
  const common = { ...PRODUCT, quantity: 1, checkedAt: DEMO_NOW, source: 'Synthetic merchant listing', uncertainty: 'Estimate only; arrival is not guaranteed.' };
  return [
    { ...common, id: 'usual', merchant: 'Paw Pantry', supported: false, stock: false, item: 4800, shipping: 600, etaStart: null, etaEnd: null, delivery: 'Restock date unknown', tag: 'Usual seller' },
    { ...common, id: 'exact', merchant: 'Kohepets', supported: true, stock: true, item: scenario === 'budget' ? 7200 : 5400, shipping: scenario === 'budget' ? 800 : 550, etaStart: TOMORROW + (noExact ? 36 : 10) * 3600000, etaEnd: TOMORROW + (noExact ? 42 : 14) * 3600000, delivery: noExact ? '11 Oct, noon–6 pm' : '10 Oct, 10 am–2 pm', tag: noExact ? 'After care deadline' : 'Exact match' },
    { ...common, id: 'discovery', merchant: 'The Paw Room', supported: false, stock: true, item: 5100, shipping: 500, etaStart: TOMORROW + 9 * 3600000, etaEnd: TOMORROW + 13 * 3600000, delivery: '10 Oct, 9 am–1 pm', tag: 'Discovery only' },
    { ...common, id: 'economy', merchant: 'Kohepets · economy delivery', supported: true, stock: true, item: 5400, shipping: 300, etaStart: TOMORROW + 60 * 3600000, etaEnd: TOMORROW + 66 * 3600000, delivery: '12 Oct, noon–6 pm', tag: 'Arrives too late' },
    { ...common, id: 'substitute', sku: 'np-adult-turkey-2kg', name: 'Neighbour Pantry Adult Turkey', variant: 'Dry food · turkey recipe · 2 kg', merchant: 'Kohepets', supported: true, stock: true, item: 5700, shipping: 550, etaStart: TOMORROW + 10 * 3600000, etaEnd: TOMORROW + 14 * 3600000, delivery: '10 Oct, 10 am–2 pm', tag: 'Different recipe', substitute: true }
  ];
}
export function fingerprint(cart) { const o = cart.offer; return JSON.stringify([o.id, o.sku, o.variant, cart.quantity, o.item, o.shipping, o.merchant, o.etaStart, o.etaEnd]); }
export function total(cart) { return cart.offer.item * cart.quantity + cart.offer.shipping; }
export function policyChecks(cart, context, now = DEMO_NOW) {
  const o = cart.offer;
  return [
    { id: 'merchant', ok: o.supported === true, label: 'Checkout merchant', detail: o.supported ? 'Mock Reap-supported merchant' : 'Discovery only; checkout unavailable' },
    { id: 'stock', ok: o.stock === true, label: 'Availability', detail: o.stock ? 'In stock in this simulation' : 'Sold out' },
    { id: 'product', ok: o.sku === PRODUCT.sku && o.variant === PRODUCT.variant || context.substitution === fingerprint(cart), label: 'Product choice', detail: o.sku === PRODUCT.sku && o.variant === PRODUCT.variant ? 'Exact approved product and variant' : context.substitution === fingerprint(cart) ? 'Owner explicitly chose this different recipe' : 'Different recipe needs explicit owner choice' },
    { id: 'quantity', ok: Number.isInteger(cart.quantity) && cart.quantity >= 1 && cart.quantity <= context.maxQuantity, label: 'Quantity', detail: `Approved limit: ${context.maxQuantity} bag; cart: ${cart.quantity}` },
    { id: 'delivery', ok: Number.isFinite(o.etaEnd) && o.etaEnd <= context.deadline, label: 'Delivery estimate', detail: Number.isFinite(o.etaEnd) && o.etaEnd <= context.deadline ? 'Estimated window is before the care deadline' : 'No delivery window before the care deadline' },
    { id: 'budget', ok: total(cart) <= context.budget, label: 'Total including shipping', detail: `${money(total(cart))} of ${money(context.budget)} budget` },
    { id: 'expiry', ok: now < context.expiresAt, label: 'Care permission', detail: now < context.expiresAt ? `Valid until ${dateLabel(context.expiresAt)} SGT` : 'Expired; owner must create a new care request' },
    { id: 'denial', ok: !context.denied.has(o.id), label: 'Owner decision', detail: context.denied.has(o.id) ? 'Owner declined this substitute' : 'No prior refusal for this item' }
  ];
}
export function eligibleExact(offers, context) {
  return offers.filter(o => !o.substitute && policyChecks({ offer: o, quantity: 1 }, context).every(c => c.ok));
}
// Clean seam for future server-side Reap search/details/quote/shipping/checkout/status.
// This adapter never sends a request. App policy is not a Reap recurring mandate.
export class MockReapAdapter {
  constructor() { this.checkouts = new Map(); this.completed = new Map(); }
  createCheckout({ key, cart, context, ownerApproval, now = DEMO_NOW }) {
    if (ownerApproval !== fingerprint(cart)) throw new Error('Owner must approve this exact cart.');
    const failed = policyChecks(cart, context, now).filter(c => !c.ok);
    if (failed.length) throw new Error(failed.map(c => c.detail).join(' · '));
    const existing = this.checkouts.get(key);
    if (existing && existing.fingerprint !== fingerprint(cart)) throw new Error('Idempotency key belongs to a different cart.');
    if (existing) return existing;
    const snapshot = Object.freeze({ offer: Object.freeze({ ...cart.offer }), quantity: cart.quantity });
    const checkout = { key, fingerprint: fingerprint(snapshot), cart: snapshot, status: 'READY', simulation: true };
    this.checkouts.set(key, checkout);
    return checkout;
  }
  complete({ key, context, ownerApproval, now = DEMO_NOW }) {
    const c = this.checkouts.get(key);
    if (!c) throw new Error('Checkout has not been created.');
    if (c.status === 'CANCELLED') throw new Error('Checkout was cancelled. Review the cart again.');
    if (this.completed.has(key)) return { receipt: this.completed.get(key), duplicate: true };
    if (ownerApproval !== c.fingerprint || fingerprint(c.cart) !== c.fingerprint) throw new Error('Owner approval no longer matches this cart.');
    const failed = policyChecks(c.cart, context, now).filter(p => !p.ok);
    if (failed.length) throw new Error(failed.map(p => p.detail).join(' · '));
    const receipt = { id: `SIM-${String(this.completed.size + 1).padStart(4, '0')}`, key, total: total(c.cart), quantity: c.cart.quantity, offer: c.cart.offer, completedAt: now, simulation: true };
    c.status = 'COMPLETED'; this.completed.set(key, receipt);
    return { receipt, duplicate: false };
  }
  cancel(key) { const c = this.checkouts.get(key); if (c && c.status !== 'COMPLETED') c.status = 'CANCELLED'; }
}
export class DemoSession {
  constructor(scenario = 'normal', requestId = 'care-1', adapter = new MockReapAdapter()) {
    if (!(scenario in SCENARIOS)) throw new Error('Unknown scenario.');
    this.scenario = scenario; this.requestId = requestId; this.adapter = adapter;
    this.context = { budget: 6500, maxQuantity: 1, deadline: DEADLINE, expiresAt: DEMO_NOW + (scenario === 'expired' ? -3600000 : 3.5 * 3600000), substitution: null, denied: new Set() };
    this.offers = makeOffers(scenario); this.stage = 'care'; this.meals = null; this.cart = null;
    this.ownerApproval = null; this.checkoutKey = null; this.attempt = 0; this.receipt = null; this.careLog = []; this.notice = ''; this.events = [];
  }
  record(title, detail) { this.events.push({ title, detail }); }
  beginSearch(meals) {
    if (this.stage !== 'care') return false;
    if (![1, 2].includes(meals)) { this.notice = 'Confirm how many meals remain before we compare delivery windows.'; return false; }
    this.meals = meals; this.context.deadline = meals === 1 ? EARLY_DEADLINE : DEADLINE;
    this.stage = 'searching'; this.notice = '';
    this.record('Care update clarified', `Jia confirmed ${meals} meal${meals > 1 ? 's' : ''} remaining and a handoff deadline of ${dateLabel(this.context.deadline)} SGT. Need one 2 kg bag.`); return true;
  }
  finishSearch() {
    if (this.stage !== 'searching') return false;
    this.record('Exact product compared first', 'Matched chicken recipe, dry food, 2 kg and quantity 1 across synthetic seller listings.');
    const viable = eligibleExact(this.offers, this.context);
    this.record('Delivery and total checked', viable.length ? 'Kohepets express fits the estimated window and S$65 budget.' : 'No exact match passes every care-request control.');
    if (this.meals === 1) this.record('Earlier handoff needed', 'None of the synthetic offers reaches tonight’s deadline. Ask the owner and caregiver to arrange an earlier handoff of the approved food; no checkout is created.');
    if (this.meals !== 1 && ['substitute', 'denied'].includes(this.scenario)) this.record('Owner choice needed', 'A different turkey recipe is available in the simulation. It is not assumed nutritionally or medically equivalent.');
    this.stage = 'offers'; return true;
  }
  select(id) {
    if (this.stage !== 'offers') return false;
    if (this.receipt) { this.notice = 'This care request already has a receipt. Reset the demo to start a new request.'; return false; }
    const offer = this.offers.find(o => o.id === id); if (!offer) return false;
    this.notice = '';
    if (!offer.supported) { this.notice = offer.stock ? 'Discovery only. This seller is outside the mock checkout path. No order was created.' : 'The usual product is sold out. No order was created.'; return false; }
    if (this.context.denied.has(id)) { this.notice = 'Asha declined this recipe. Choose another option or start a new care request.'; return false; }
    if (offer.etaEnd > this.context.deadline) { this.notice = 'This delivery estimate is after the care deadline. No checkout was created.'; return false; }
    this.cart = { offer, quantity: 1 }; this.ownerApproval = null; this.context.substitution = null;
    this.stage = offer.substitute ? 'substitution' : 'cart'; return true;
  }
  chooseSubstitute(approve) {
    if (this.stage !== 'substitution') return false;
    if (!approve || this.scenario === 'denied') {
      this.context.denied.add(this.cart.offer.id); this.context.substitution = null;
      this.record('Substitute declined', 'Asha did not authorize a recipe change. No checkout or payment was created.');
      this.stage = 'offers'; this.cart = null; this.notice = 'Substitute declined. Milo’s diet has not been changed.'; return true;
    }
    this.context.substitution = fingerprint(this.cart); this.stage = 'cart';
    this.record('Substitute explicitly chosen', 'Asha chose the turkey recipe for this one-bag cart. Separate checkout approval still required.'); return true;
  }
  setQuantity(quantity) { if (this.stage !== 'cart') return; this.cart.quantity = quantity; this.ownerApproval = null; this.notice = ''; }
  approveCart(now = DEMO_NOW) {
    if (this.stage !== 'cart') return false;
    if (this.receipt) { this.stage = 'receipt'; this.notice = 'This care request is already complete. No additional checkout was created.'; return false; }
    const failed = policyChecks(this.cart, this.context, now).filter(c => !c.ok);
    if (failed.length) { this.notice = `Checkout blocked: ${failed.map(c => c.detail).join(' · ')}`; return false; }
    this.ownerApproval = fingerprint(this.cart); this.attempt++;
    this.checkoutKey = `${this.requestId}:attempt-${this.attempt}:${this.ownerApproval}`;
    this.adapter.createCheckout({ key: this.checkoutKey, cart: this.cart, context: this.context, ownerApproval: this.ownerApproval, now });
    this.record('Owner approved this cart', `Asha approved ${money(total(this.cart))}, including delivery, for this checkout only.`);
    this.stage = 'checkout'; this.notice = ''; return true;
  }
  complete(now = DEMO_NOW) {
    if (!['checkout', 'receipt'].includes(this.stage)) return false;
    const result = this.adapter.complete({ key: this.checkoutKey, context: this.context, ownerApproval: this.ownerApproval, now });
    if (!result.duplicate) { this.receipt = result.receipt; this.careLog.push(result.receipt); this.record('Mock checkout completed', `${result.receipt.id} recorded once. No real payment or merchant order.`); }
    this.stage = 'receipt'; this.notice = result.duplicate ? 'Repeated request ignored. The same receipt was returned; no second payment or care-log entry.' : '';
    return result;
  }
  cancelCheckout() {
    if (this.stage !== 'checkout') return false;
    this.adapter.cancel(this.checkoutKey); this.ownerApproval = null; this.stage = 'cart';
    this.notice = 'Checkout cancelled. No payment recorded. Approve the cart again to create a new checkout.';
    this.record('Mock checkout cancelled', 'Owner approval cleared; no care-log receipt created.'); return true;
  }
  back() {
    if (this.stage === 'receipt') { this.stage = 'offers'; this.notice = 'This request is complete. Its receipt is retained; reset to start a new care request.'; return true; }
    if (this.stage === 'checkout') return this.cancelCheckout();
    if (['cart', 'substitution'].includes(this.stage)) { this.ownerApproval = null; this.context.substitution = null; this.cart = null; this.stage = 'offers'; this.notice = ''; return true; }
    if (['offers', 'searching'].includes(this.stage)) { this.stage = 'care'; this.notice = ''; return true; }
    return false;
  }
}
