// Synthetic contract fixtures. These never call Reap or emulate hosted card entry.
export const money = amount => ({ amount, currency: 'SGD' });
export const ids = { product: 'prod_fixture', variant: 'var_fixture', quote: '11111111-1111-4111-8111-111111111111', enrollment: '22222222-2222-4222-8222-222222222222', checkout: '33333333-3333-4333-8333-333333333333', order: 'order_fixture' };
export const FIXTURE_NOW = Date.parse('2026-10-09T08:00:00Z');
export function fixtureFetch() {
  const state = { calls: [], now: FIXTURE_NOW, finalAmount: 59.5, quoteExpiry: '2026-10-09T08:20:00Z', enrollmentStatus: 'REQUIRES_ACTION', checkoutStatus: 'REQUIRES_ACTION', selection: null, throwAt: null, overSize: false, httpStatus: null, responseOverride: null, overridePath: null };
  const variant = { id: ids.variant, name: 'Chicken / 2 kg · fixture', options: [], price: money(54), available: true, requiresShipping: true, media: [] };
  const quote = () => ({ id: ids.quote, expiresAt: state.quoteExpiry, shippingOptions: [
    { id: 'express', name: 'Express · fixture', selected: state.selection === 'express', price: money(5.5), details: [{ key: 'Delivery', value: 'Estimate only · fixture' }] },
    { id: 'standard', name: 'Standard · fixture', selected: state.selection === 'standard', price: money(3), details: [] }
  ], amountBreakdown: { itemsSubtotal: money(54), shipping: money(state.selection === 'standard' ? 3 : 5.5), discounts: [], additionalCharges: [], finalAmount: money(state.finalAmount) } });
  const enrollment = () => ({ id: ids.enrollment, status: state.enrollmentStatus, source: 'EXTERNAL', owner: { type: 'CLIENT_REFERENCE', id: 'kampawng-synthetic-asha', email: 'asha@example.invalid' }, paymentMethod: null, nextAction: state.enrollmentStatus === 'REQUIRES_ACTION' ? { type: 'REDIRECT', url: 'https://sandbox.reap.global/enroll/fixture' } : null, createdAt: '2026-10-09T08:00:00Z', updatedAt: '2026-10-09T08:00:00Z' });
  const checkout = () => ({ id: ids.checkout, status: state.checkoutStatus, quoteId: ids.quote, enrollmentId: ids.enrollment, orderId: state.checkoutStatus === 'COMPLETED' ? ids.order : null, finalAmount: money(state.finalAmount), nextAction: state.checkoutStatus === 'REQUIRES_ACTION' ? { type: 'REDIRECT', url: 'https://sandbox.reap.global/pay/fixture' } : null });
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname, body = options.body ? JSON.parse(options.body) : null;
    // Record contract headers only, excluding Authorization even though the key is fake.
    state.calls.push({ path, method: options.method, body, key: options.headers['Idempotency-Key'], version: options.headers['Reap-Version'], simulated: options.headers['X-Simulate-Checkout'], redirect: options.redirect, host: new URL(url).origin });
    if (state.throwAt === path) throw new Error('Synthetic timeout; should never be shown.');
    if (state.overSize) return new Response('x'.repeat(1048577));
    if (state.httpStatus) return new Response(JSON.stringify({ code: 'IN_PROGRESS', message: 'Untrusted error fixture' }), { status: state.httpStatus });
    if (state.responseOverride && (!state.overridePath || state.overridePath === path)) return new Response(JSON.stringify(state.responseOverride));
    let result;
    if (path.endsWith('/products/search')) result = { id: 'search_fixture', products: [{ id: ids.product, name: 'Fixture pet food', merchant: { name: 'Fixture pet merchant' }, available: true, priceRange: { min: money(54), max: money(54) }, previewVariant: variant }], pagination: { nextCursor: null, hasNextPage: false, returnedCount: 1 }, warnings: [] };
    else if (path.endsWith('/products/details')) result = { products: [{ id: ids.product, name: 'Fixture pet food', merchant: { name: 'Fixture pet merchant' }, media: [], options: [], defaultVariant: variant }], errors: [] };
    else if (path.endsWith('/products/variant')) result = variant;
    else if (path === '/agentic/quotes') result = quote();
    else if (path.endsWith('/shipping-option')) { state.selection = body.shippingOptionId; result = quote(); }
    else if (path === `/agentic/quotes/${ids.quote}`) result = quote();
    else if (path === '/agentic/enrollments' || path === `/agentic/enrollments/${ids.enrollment}`) result = enrollment();
    else if (path === '/agentic/checkouts') { if (options.headers['X-Simulate-Checkout'] === 'COMPLETED') state.checkoutStatus = 'COMPLETED'; result = checkout(); }
    else if (path === `/agentic/checkouts/${ids.checkout}`) result = checkout();
    else throw new Error('Unexpected fixture path');
    return new Response(JSON.stringify(result));
  };
  return { state, fetchImpl };
}
