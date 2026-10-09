import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DemoSession, MockReapAdapter, DEMO_NOW, EARLY_DEADLINE, DEADLINE, policyChecks, fingerprint, eligibleExact } from '../model.js';
function searched(scenario = 'normal') { const s = new DemoSession(scenario); assert.equal(s.beginSearch(2), true); s.finishSearch(); return s; }
test('exact usual product succeeds with shipping included and one receipt on replay', () => {
  const s = searched(); s.select('exact'); assert.equal(s.approveCart(), true);
  const first = s.complete(), second = s.complete();
  assert.equal(first.receipt.total, 5950); assert.equal(second.receipt.id, first.receipt.id); assert.equal(second.duplicate, true); assert.equal(s.careLog.length, 1);
  s.back(); assert.equal(s.select('exact'), false); assert.equal(s.careLog.length, 1);
});
test('incomplete care update cannot start research', () => { const s = new DemoSession(); assert.equal(s.beginSearch(NaN), false); assert.equal(s.stage, 'care'); });
test('substitute requires separate product choice and fresh cart approval', () => {
  const s = searched('substitute'); s.select('substitute'); assert.equal(s.stage, 'substitution'); assert.equal(s.approveCart(), false); assert.equal(s.complete(), false);
  s.chooseSubstitute(true); assert.equal(policyChecks(s.cart, s.context).every(c => c.ok), true); assert.equal(s.approveCart(), true); assert.equal(s.complete().receipt.total, 6250);
});
test('owner denial never creates checkout and cannot be overridden in denied scenario', () => { const s = searched('denied'); s.select('substitute'); s.chooseSubstitute(true); assert.equal(s.stage, 'offers'); assert.equal(s.select('substitute'), false); assert.equal(s.adapter.checkouts.size, 0); });
test('expired permission blocks both cart approval and completion if expiry changes', () => {
  const s = searched('expired'); s.select('exact'); assert.equal(s.approveCart(), false); assert.match(s.notice, /Expired/); assert.equal(s.adapter.checkouts.size, 0);
  const valid = searched(); valid.select('exact'); valid.approveCart(); assert.throws(() => valid.complete(DEMO_NOW + 4 * 3600000), /Expired/); assert.equal(valid.careLog.length, 0);
});
test('budget is checked including shipping and never auto-increased', () => { const s = searched('budget'); s.select('exact'); assert.equal(s.approveCart(), false); assert.match(s.notice, /80\.00/); assert.equal(s.context.budget, 6500); assert.equal(s.adapter.checkouts.size, 0); });
test('unsupported, sold-out and late sellers do not enter cart or create checkout', () => { const s = searched(); for (const id of ['discovery', 'usual', 'economy']) assert.equal(s.select(id), false); assert.equal(s.cart, null); assert.equal(s.adapter.checkouts.size, 0); });
test('quantity bounds and changing a substitution cart invalidate product consent', () => {
  const s = searched('substitute'); s.select('substitute'); s.chooseSubstitute(true); s.setQuantity(2); assert.equal(s.approveCart(), false); assert.match(s.notice, /limit: 1/);
  for (const q of [0, 1.5, NaN]) { s.setQuantity(q); assert.equal(s.approveCart(), false); }
});
test('cancelled checkout cannot complete; reapproval uses a new checkout attempt', () => {
  const s = searched(); s.select('exact'); s.approveCart(); const old = s.checkoutKey; s.cancelCheckout(); assert.equal(s.ownerApproval, null);
  assert.throws(() => s.adapter.complete({ key: old, context: s.context, ownerApproval: fingerprint(s.cart) }), /cancelled/);
  s.approveCart(); assert.notEqual(s.checkoutKey, old); s.complete(); assert.equal(s.careLog.length, 1);
});
test('same idempotency key cannot be rebound to a different cart', () => {
  const s = searched(); s.select('exact'); const a = new MockReapAdapter(); const cart = s.cart;
  a.createCheckout({ key: 'same', cart, context: s.context, ownerApproval: fingerprint(cart) });
  const other = { ...cart, offer: { ...cart.offer, shipping: 600 } };
  assert.throws(() => a.createCheckout({ key: 'same', cart: other, context: s.context, ownerApproval: fingerprint(other) }), /different cart/);
});
test('completion without matching owner approval cannot create a receipt', () => {
  const s = searched(); s.select('exact'); s.approveCart(); s.ownerApproval = null; assert.throws(() => s.complete(), /approval/); assert.equal(s.careLog.length, 0);
});
test('back clears approvals; a cancelled search cannot settle', () => {
  const s = new DemoSession(); s.beginSearch(2); s.back(); assert.equal(s.finishSearch(), false);
  const sub = searched('substitute'); sub.select('substitute'); sub.chooseSubstitute(true); sub.back(); assert.equal(sub.context.substitution, null); assert.equal(sub.ownerApproval, null);
});
test('one meal moves the deadline earlier and prevents every late checkout', () => {
  const s = new DemoSession('substitute'); s.beginSearch(1); s.finishSearch();
  assert.equal(s.context.deadline, EARLY_DEADLINE); assert.equal(eligibleExact(s.offers, s.context).length, 0);
  for (const offer of s.offers) assert.equal(s.select(offer.id), false);
  assert.equal(s.adapter.checkouts.size, 0); assert.match(s.events.at(-1).detail, /earlier handoff/);
  s.back(); s.beginSearch(2); assert.equal(s.context.deadline, DEADLINE);
});
test('checkout keeps the exact approved quote if the original offer is later mutated', () => {
  const s = searched(); s.select('exact'); s.approveCart();
  s.cart.offer.shipping = 800; s.cart.offer.merchant = 'Changed merchant';
  const result = s.complete(); assert.equal(result.receipt.total, 5950); assert.equal(result.receipt.offer.merchant, 'Kohepets');
  assert.throws(() => { result.receipt.offer.shipping = 900; }, TypeError);
});
test('checkout completion rejects a replaced stored quote without fresh approval', () => {
  const s = searched(); s.select('exact'); s.approveCart();
  const checkout = s.adapter.checkouts.get(s.checkoutKey);
  checkout.cart = { ...checkout.cart, offer: { ...checkout.cart.offer, shipping: 800 } };
  assert.throws(() => s.complete(), /approval/); assert.equal(s.careLog.length, 0);
});
