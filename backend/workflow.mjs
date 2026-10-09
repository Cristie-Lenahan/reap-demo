import { randomUUID } from 'node:crypto';
import { AdapterError, fail, strict, text, cents } from './client.mjs';
import { digest } from './store.mjs';
const id = value => { text(value, 160); if (!/^[A-Za-z0-9_-]+$/.test(value)) fail('INVALID_PROVIDER_ID', 502); return value; };
const label = value => text(value, 1000);
const iso = value => { text(value, 80); if (!Number.isFinite(Date.parse(value))) fail('INVALID_PROVIDER_DATE', 502); return value; };
const fixtureOwner = { type: 'CLIENT_REFERENCE', id: 'kampawng-synthetic-asha', email: 'asha@example.com' };
// No user/card/address input in this demo adapter. All care/recipient data is synthetic.
const fixtureAddress = { firstName: 'Asha', lastName: 'Demo', phone: '+6591234567', addressLine1: '1 Fictional Road', city: 'Singapore', postalCode: '018989', country: 'SG' };
const enrollmentStates = ['REQUIRES_ACTION', 'ACTIVE', 'FAILED', 'EXPIRED', 'REVOKED'];
const checkoutStates = ['REQUIRES_ACTION', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED'];
function nextAction(action) {
  if (action == null) return null;
  if (action.type !== 'REDIRECT') fail('INVALID_PROVIDER_REDIRECT', 502);
  const url = new URL(text(action.url, 2048));
  // Fail closed until any additional hosted domains are explicitly verified.
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.hostname === 'sandbox.collect.prava.space' || url.hostname === 'reap.global' || url.hostname.endsWith('.reap.global'))) fail('UNVERIFIED_HOSTED_DOMAIN', 502);
  return { type: 'REDIRECT', url: url.href, expiresAt: action.expiresAt ? iso(action.expiresAt) : null };
}
function variant(raw) { return { id: id(raw.id), name: typeof raw.name === 'string' ? label(raw.name) : 'Variant', available: raw.available === true, requiresShipping: raw.requiresShipping !== false, priceCents: cents(raw.price), options: (raw.options || []).slice(0, 10).map(o => ({ name: label(o.name), value: label(o.value) })) }; }
function product(raw) { return { id: id(raw.id), name: label(raw.name), merchant: label(raw.merchant?.name), available: raw.available === true, minCents: cents(raw.priceRange.min), maxCents: cents(raw.priceRange.max) }; }
function quote(raw) {
  if (!Array.isArray(raw.shippingOptions) || raw.shippingOptions.length > 50) fail('INVALID_PROVIDER_QUOTE', 502);
  return { id: id(raw.id), expiresAt: iso(raw.expiresAt), finalCents: cents(raw.amountBreakdown?.finalAmount), shipping: raw.shippingOptions.map(s => ({ id: id(s.id), name: label(s.name), selected: s.selected === true, priceCents: cents(s.price), details: (s.details || []).slice(0, 12).map(d => ({ key: label(d.key), value: label(d.value) })) })), deliveryEstimate: 'Unknown: Reap shipping details require owner review; arrival is not guaranteed.', checkedAt: new Date().toISOString() };
}
export function normalizeEnrollment(raw, owner = fixtureOwner) {
  if (!enrollmentStates.includes(raw.status) || raw.owner?.type !== owner.type || raw.owner?.id !== owner.id) fail('INVALID_PROVIDER_ENROLLMENT', 502);
  return { id: id(raw.id), status: raw.status, nextAction: nextAction(raw.nextAction) };
}
export const enrollmentRequest = (returnUrl, owner = fixtureOwner) => ({ source: 'EXTERNAL', owner, presentation: { type: 'REDIRECT', returnUrl } });
function checkout(raw, expected) {
  if (!checkoutStates.includes(raw.status) || raw.quoteId !== expected.quoteId || raw.enrollmentId !== expected.enrollmentId) fail('INVALID_PROVIDER_CHECKOUT', 502);
  return { id: id(raw.id), status: raw.status, quoteId: id(raw.quoteId), enrollmentId: id(raw.enrollmentId), orderId: raw.orderId == null ? null : id(raw.orderId), finalCents: raw.finalAmount ? cents(raw.finalAmount) : null, nextAction: nextAction(raw.nextAction) };
}
export class DemoBackend {
  constructor({ client, store, now = () => Date.now(), returnUrl = 'https://reap-demo.kampawng.com/?reap-return=1', simulateCompleted = false, uniqueOwners = false }) {
    this.client = client; this.store = store; this.now = now; this.simulateCompleted = simulateCompleted === true; this.uniqueOwners = uniqueOwners === true;
    const url = new URL(returnUrl);
    if (url.origin !== 'https://reap-demo.kampawng.com' || url.username || url.password) fail('INVALID_RETURN_URL', 400);
    this.returnUrl = url.href;
  }
  get ready() { return this.client.enabled; }
  async action(name, input = {}) {
    if (!this.ready) fail('SANDBOX_DISABLED', 503);
    return this.store.exclusive(async () => {
      const actions = {
        search: ['query'], details: ['productId'], choose: ['productId', 'optionIds', 'substitute', 'ownerDecision'],
        quote: [], shipping: ['shippingOptionId'], approveCart: ['acceptUnknownDelivery'],
        enrollment: [], enrollmentStatus: [], renewEnrollment: ['ownerDecision'], checkout: [], status: [], view: [], renewPermission: ['ownerDecision'], startNew: ['ownerDecision']
      };
      if (!Object.hasOwn(actions, name)) fail('UNKNOWN_ACTION', 404);
      strict(input, actions[name]);
      if (!this.store.data.care) { this.store.data.care = this.newCare(); await this.store.save(); }
      this.care = this.store.data.care;
      try { return await this[name](input); } finally { await this.store.save(); }
    });
  }
  newCare() {
    const careId = randomUUID();
    return { id: careId, owner: { ...fixtureOwner, id: this.uniqueOwners ? `kampawng-demo-${careId}` : fixtureOwner.id }, generation: 0, expiresAt: this.now() + 30 * 60000, budgetCents: 6500, products: [], details: {}, denied: [], selection: null, quote: null, approval: null, enrollment: null, checkout: null, receipt: null };
  }
  get owner() { return this.care.owner || fixtureOwner; }
  async startNew({ ownerDecision }) {
    if (ownerDecision !== 'approve') fail('OWNER_CHOICE_REQUIRED');
    if (!this.care.receipt || this.care.checkout?.status !== 'COMPLETED' || this.care.receipt.needsReconciliation) fail('FINISH_CURRENT_REQUEST');
    await this.status();
    if ((this.store.data.archives || []).length >= 3) fail('DEMO_RUN_LIMIT');
    this.store.data.archives = [...(this.store.data.archives || []), structuredClone(this.care)];
    this.store.data.care = this.newCare(); this.care = this.store.data.care;
    return { message: 'New sandbox cart ready. Your previous receipt is preserved.' };
  }
  assertMutable({ allowExpired = false } = {}) {
    if (this.care.checkout || this.care.receipt) fail('CHECKOUT_ALREADY_STARTED');
    if (Object.entries(this.store.data.operations).some(([k, op]) => k.startsWith(this.care.id + ':') && ['DISPATCHING', 'UNCERTAIN'].includes(op.state))) fail('RESULT_UNCERTAIN');
    if (!allowExpired && this.now() >= this.care.expiresAt) fail('PERMISSION_EXPIRED');
  }
  policy({ approved = false } = {}) {
    if (this.now() >= this.care.expiresAt) fail('PERMISSION_EXPIRED');
    if (!this.care.selection || this.care.selection.denied) fail('OWNER_CHOICE_REQUIRED');
    const q = this.care.quote;
    if (!q || this.now() >= Date.parse(q.expiresAt)) fail('QUOTE_EXPIRED');
    if (q.finalCents > this.care.budgetCents) fail('OVER_BUDGET');
    if (this.care.selection.variant.requiresShipping && q.shipping.filter(s => s.selected).length !== 1) fail('SHIPPING_REQUIRED');
    if (approved && this.care.approval !== this.cartHash()) fail('CART_REAPPROVAL_REQUIRED');
  }
  cartHash() {
    const q = this.care.quote;
    return digest({ variantId: this.care.selection?.variant.id, quantity: 1, quote: q ? { id: q.id, expiresAt: q.expiresAt, finalCents: q.finalCents, shipping: q.shipping } : null });
  }
  async refreshQuote() {
    const old = this.care.quote; if (!old) fail('QUOTE_REQUIRED');
    const fresh = quote(await this.client.request('GET', `/agentic/quotes/${old.id}`));
    if (fresh.id !== old.id) fail('QUOTE_CHANGED', 502);
    this.care.quote = fresh; return fresh;
  }
  renewPermission({ ownerDecision }) {
    this.assertMutable({ allowExpired: true }); if (ownerDecision !== 'approve') fail('OWNER_CHOICE_REQUIRED');
    this.care.expiresAt = this.now() + 30 * 60000; this.care.approval = null;
    return { permissionExpiresAt: new Date(this.care.expiresAt).toISOString(), paymentApproved: false };
  }
  view() { return { mode: 'SG sandbox adapter', simulationRequested: this.simulateCompleted, owner: 'Asha · synthetic', quantity: 1, budgetCents: this.care.budgetCents, permissionExpiresAt: new Date(this.care.expiresAt).toISOString(), products: this.care.products, details: this.care.details, cartReviewed: this.care.approval === this.cartHash(), selection: this.care.selection, quote: this.care.quote, enrollment: this.care.enrollment, checkout: this.care.checkout, receipt: this.care.receipt, previousReceipts: (this.store.data.archives || []).map(c => c.receipt) }; }
  async search({ query }) {
    this.assertMutable(); text(query, 120);
    const raw = await this.client.request('POST', '/agentic/products/search', { query, context: { country: 'SG', currency: 'SGD' }, filters: { availability: 'AVAILABLE_ONLY' }, pagination: { limit: 5 } });
    if (!Array.isArray(raw.products) || raw.products.length > 50) fail('INVALID_PROVIDER_SEARCH', 502);
    this.care.products = raw.products.map(product); this.care.details = {}; return { products: this.care.products, checkedAt: new Date(this.now()).toISOString(), source: 'Reap SG sandbox catalogue; not live stock or guaranteed delivery.' };
  }
  async details({ productId }) {
    this.assertMutable(); if (!this.care.products.some(p => p.id === productId)) fail('PRODUCT_NOT_DISCOVERED', 400);
    const raw = await this.client.request('POST', '/agentic/products/details', { productIds: [productId] });
    const p = raw.products?.find(p => p.id === productId); if (!p) fail('PRODUCT_DETAILS_UNAVAILABLE', 502);
    const known = this.care.products.find(p => p.id === productId);
    if (p.merchant?.name !== known.merchant || p.name !== known.name) fail('PRODUCT_CHANGED', 409);
    const detail = { id: productId, name: known.name, merchant: known.merchant, options: (p.options || []).slice(0, 10).map(o => ({ name: label(o.name), values: (o.values || []).slice(0, 50).map(v => ({ optionId: id(v.optionId), label: label(v.label), available: v.available === true })) })), defaultVariant: variant(p.defaultVariant) };
    this.care.details[productId] = detail; return detail;
  }
  async choose({ productId, optionIds = [], substitute, ownerDecision }) {
    this.assertMutable(); const p = this.care.details[productId]; if (!p) fail('PRODUCT_DETAILS_REQUIRED');
    if (typeof substitute !== 'boolean' || !['approve', 'decline'].includes(ownerDecision) || !Array.isArray(optionIds) || optionIds.length > 10 || new Set(optionIds).size !== optionIds.length) fail('INVALID_INPUT', 400);
    if (optionIds.length && (optionIds.length !== p.options.length || p.options.some(o => o.values.filter(v => optionIds.includes(v.optionId) && v.available).length !== 1))) fail('INVALID_VARIANT_OPTIONS', 400);
    const choiceHash = digest({ productId, optionIds });
    if (ownerDecision === 'decline') { this.care.denied.push(choiceHash); this.care.selection = null; this.care.quote = null; this.care.approval = null; return { denied: true, message: 'Owner declined. No diet change or checkout.' }; }
    if (this.care.denied.includes(choiceHash)) fail('SUBSTITUTION_DECLINED');
    const v = optionIds.length ? variant(await this.client.request('POST', '/agentic/products/variant', { productId, optionIds })) : p.defaultVariant;
    if (!v.available) fail('VARIANT_AVAILABILITY_UNCONFIRMED');
    this.care.generation++; this.care.selection = { productId, name: p.name, merchant: p.merchant, variant: v, substitute, choice: substitute ? 'Owner explicitly chose this substitute; no medical equivalence claimed.' : 'Owner selected this test variant; no automated exact-recipe claim.' };
    this.care.quote = null; this.care.approval = null; return this.care.selection;
  }
  async quote() {
    this.assertMutable(); if (!this.care.selection) fail('OWNER_CHOICE_REQUIRED');
    if (this.care.quote && this.now() >= Date.parse(this.care.quote.expiresAt)) { this.care.generation++; this.care.quote = null; this.care.approval = null; }
    if (this.care.quote) return this.refreshQuote();
    const body = { email: this.owner.email, items: [{ variantId: this.care.selection.variant.id, quantity: 1 }], ...(this.care.selection.variant.requiresShipping ? { shippingAddress: fixtureAddress } : {}) };
    this.care.quote = await this.store.mutation(`${this.care.id}:quote:${this.care.generation}`, body, key => this.client.request('POST', '/agentic/quotes', body, { idempotencyKey: key }), quote);
    this.care.approval = null; return this.care.quote;
  }
  async shipping({ shippingOptionId }) {
    this.assertMutable(); const q = this.care.quote;
    if (!q || this.now() >= Date.parse(q.expiresAt)) fail('QUOTE_EXPIRED');
    if (!q.shipping.some(s => s.id === shippingOptionId)) fail('INVALID_SHIPPING_OPTION', 400);
    const body = { shippingOptionId };
    this.care.approval = null;
    // Repeated current selection reads its status; moving A -> B -> A is a new,
    // serialized shipping change, not a replay of A's earlier response.
    if (!q.shipping.find(s => s.id === shippingOptionId)?.selected) {
      this.care.shippingGeneration = (this.care.shippingGeneration || 0) + 1;
      try {
        await this.store.mutation(`${this.care.id}:shipping:${q.id}:${this.care.shippingGeneration}`, body, key => this.client.request('POST', `/agentic/quotes/${q.id}/shipping-option`, body, { idempotencyKey: key }), quote);
      } catch (error) {
        if (error.code === 'QUOTE_REPLACEMENT_REQUIRED') { this.care.quote = null; this.care.generation++; }
        throw error;
      }
    }
    this.care.quote = quote(await this.client.request('GET', `/agentic/quotes/${q.id}`));
    if (this.care.quote.id !== q.id || !this.care.quote.shipping.find(s => s.id === shippingOptionId)?.selected) fail('SHIPPING_SELECTION_CHANGED');
    this.care.approval = null; return this.care.quote;
  }
  async approveCart({ acceptUnknownDelivery }) {
    this.assertMutable(); if (acceptUnknownDelivery !== true) fail('DELIVERY_REVIEW_REQUIRED');
    const before = this.cartHash(); await this.refreshQuote();
    if (before !== this.cartHash()) { this.care.approval = null; fail('CART_CHANGED_REVIEW'); }
    this.policy();
    // App-side cart/substitution consent is deliberately distinct from Reap approval.
    this.care.approval = this.cartHash(); return { approved: true, paymentApproved: false, message: 'Cart reviewed; Reap hosted payment approval is still required.' };
  }
  async enrollment() {
    this.assertMutable(); if (this.care.enrollment) return this.enrollmentStatus();
    const body = enrollmentRequest(this.returnUrl, this.owner);
    this.care.enrollment = await this.store.mutation(`${this.care.id}:enrollment`, body, key => this.client.request('POST', '/agentic/enrollments', body, { idempotencyKey: key }), raw => normalizeEnrollment(raw, this.owner));
    return this.care.enrollment;
  }
  async enrollmentStatus() {
    if (!this.care.enrollment) fail('ENROLLMENT_REQUIRED');
    const e = normalizeEnrollment(await this.client.request('GET', `/agentic/enrollments/${this.care.enrollment.id}`), this.owner);
    if (e.id !== this.care.enrollment.id) fail('ENROLLMENT_CHANGED', 502); this.care.enrollment = e; return e;
  }
  async renewEnrollment({ ownerDecision }) {
    this.assertMutable(); if (ownerDecision !== 'approve') fail('OWNER_CHOICE_REQUIRED');
    const prior = await this.enrollmentStatus();
    if (prior.status === 'ACTIVE') fail('ENROLLMENT_ALREADY_ACTIVE');
    if (!['REQUIRES_ACTION', 'FAILED', 'EXPIRED'].includes(prior.status)) fail('ENROLLMENT_STILL_PENDING');
    const generation = (this.care.enrollmentGeneration || 0) + 1;
    if (generation > 3) fail('ENROLLMENT_SESSION_LIMIT');
    const body = enrollmentRequest(this.returnUrl, this.owner);
    const next = await this.store.mutation(`${this.care.id}:enrollment:${generation}`, body, key => this.client.request('POST', '/agentic/enrollments', body, { idempotencyKey: key }), raw => normalizeEnrollment(raw, this.owner));
    this.care.enrollmentHistory = [...(this.care.enrollmentHistory || []), { id: prior.id, status: prior.status, superseded: true }];
    this.care.enrollmentGeneration = generation; this.care.enrollment = next; this.care.approval = null;
    return next;
  }
  async checkout() {
    if (this.care.receipt) return this.care.receipt;
    if (this.care.checkout) return this.status();
    this.assertMutable(); await this.refreshQuote(); this.policy({ approved: true });
    if (!this.care.enrollment) fail('ENROLLMENT_REQUIRED');
    if ((await this.enrollmentStatus()).status !== 'ACTIVE') fail('ENROLLMENT_NOT_ACTIVE');
    const latest = await this.refreshQuote(); this.policy({ approved: true });
    const body = { quoteId: latest.id, enrollmentId: this.care.enrollment.id, presentation: { type: 'REDIRECT', returnUrl: this.returnUrl } };
    this.care.checkout = await this.store.mutation(`${this.care.id}:checkout`, body, key => this.client.request('POST', '/agentic/checkouts', body, { idempotencyKey: key, simulateCompleted: this.simulateCompleted }), raw => checkout(raw, body));
    this.care.checkout.hostedApprovalRequired = this.care.checkout.status === 'REQUIRES_ACTION';
    // Always verify status by GET, including X-Simulate-Checkout results.
    return this.status();
  }
  async status() {
    if (!this.care.checkout) fail('CHECKOUT_REQUIRED');
    const prior = this.care.checkout;
    const result = checkout(await this.client.request('GET', `/agentic/checkouts/${prior.id}`), prior);
    result.hostedApprovalRequired = prior.hostedApprovalRequired === true || prior.status === 'REQUIRES_ACTION';
    if (result.id !== prior.id) fail('CHECKOUT_CHANGED', 502);
    if (this.care.receipt && (result.status !== 'COMPLETED' || result.orderId !== this.care.receipt.orderId || result.finalCents !== this.care.receipt.finalCents)) fail('RECEIPT_RECONCILIATION_REQUIRED', 502);
    this.care.checkout = result;
    if (result.status === 'COMPLETED') {
      if (!result.orderId || result.finalCents === null) fail('RECEIPT_INCOMPLETE', 502);
      if (!this.care.receipt) this.care.receipt = { checkoutId: result.id, orderId: result.orderId, finalCents: result.finalCents, currency: 'SGD', completedAt: new Date(this.now()).toISOString(), simulationRequested: this.simulateCompleted, simulatedCheckout: this.simulateCompleted && !result.hostedApprovalRequired, hostedApprovalRequired: result.hostedApprovalRequired, hostedPaymentApprovalExercised: false, careLogEntries: 1, needsReconciliation: result.finalCents !== this.care.quote.finalCents };
      return this.care.receipt;
    }
    return { ...result, message: ['FAILED', 'EXPIRED'].includes(result.status) ? 'Terminal checkout recorded. A new owner-reviewed request and fresh quote are needed; this care intent stays locked.' : 'Closing or going back does not cancel this checkout. Reconcile this ID before another attempt.' };
  }
}
