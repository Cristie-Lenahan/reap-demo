import { DemoSession, SCENARIOS, PRODUCT, money, dateLabel, policyChecks, total, eligibleExact, DEMO_NOW } from './model.js';

const icons = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  wallet: '<path d="M20 8V5H5a2 2 0 0 0 0 4h15v10H5a2 2 0 0 1-2-2V7"/><path d="M20 12h-5v4h5"/>',
  bag: '<path d="M5 7h14l1 14H4L5 7Z"/><path d="M9 7V5a3 3 0 0 1 6 0v2M9 11h6M9 15h6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
  flask: '<path d="M9 3h6M10 3v7L5 18a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-8V3M8 15h8"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  truck: '<path d="M3 5h11v12H3V5ZM14 9h4l3 4v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'
};
const icon = name => `<span class="icon-slot"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.info}</svg></span>`;
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = selector => document.querySelector(selector);
let revision = 1, epoch = 0, paying = false, session = new DemoSession('normal', 'care-1'), lastStage = null, timelineOpen = true;
const scenarioSelect = $('#scenario');
scenarioSelect.innerHTML = Object.entries(SCENARIOS).map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
function paintIcons() { document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
function productSummary(offer = PRODUCT, stock = false) {
  return `<div class="product-summary"><div class="product-icon">${icon('bag')}</div><div><h3>${escape(offer.name)}</h3><p>${escape(offer.variant)}</p>${stock ? '<p class="stock-label">Usual seller: sold out</p>' : ''}</div></div>`;
}
function notice() { return session.notice ? `<div class="notice" id="notice" tabindex="-1" role="alert">${escape(session.notice)}</div>` : ''; }
function backButton(label = 'Back to options') { return `<button class="button secondary" data-action="back">${label}</button>`; }
function careView() {
  return `${notice()}<section class="panel"><div class="panel-heading"><div><p class="section-label">01 · CARE UPDATE</p><h2>A little low on the usual.</h2></div><span class="status-tag warn">Needs attention</span></div>
    <div class="care-message"><div class="message-from"><span class="avatar mint">JL</span>Jia, caregiver<time>3:12 pm</time></div><blockquote>“Milo’s food is running low. The usual seller has sold out, and I’m here until tomorrow evening. Can we get a bag here in time?”</blockquote></div>
    ${productSummary(PRODUCT, true)}
    <div class="clarification"><label for="meals">First, how many meals are left?</label><span class="small">Confirm the remaining food and deadline with Jia. These answers follow Milo’s fictional feeding plan.</span><select id="meals"><option value="">Confirm with Jia…</option><option value="2" ${session.meals === 2 ? 'selected' : ''}>2 meals · enough until tomorrow, 6 pm</option><option value="1" ${session.meals === 1 ? 'selected' : ''}>1 meal · needs a handoff tonight, 8 pm</option></select></div>
    <div class="actions"><p class="small">One approved bag. Exact recipe first. No automatic diet changes.</p><button class="button" data-action="search">${icon('search')}Compare options</button></div></section>`;
}
function searchView() {
  return `<section class="panel"><div class="search-loading"><div class="loading-icon">${icon('search')}</div><p class="section-label">SIMULATED SEARCH</p><h2>Finding Milo’s usual.</h2><p>Comparing the exact recipe and bag size,<br>delivery windows, and total cost.</p><div class="search-progress" role="progressbar" aria-label="Simulated search in progress"></div><span class="small">Scripted listings · no live web search</span><div>${backButton('Cancel search')}</div></div></section>`;
}
function offerCard(offer, recommended = false) {
  const validDelivery = offer.etaEnd !== null && offer.etaEnd <= session.context.deadline;
  const denied = session.context.denied.has(offer.id);
  const unavailable = !offer.stock || !validDelivery;
  let label = offer.substitute ? 'Review substitute' : 'Review this cart';
  let action = `data-action="select" data-offer="${offer.id}"`;
  if (!offer.supported) label = offer.stock ? 'View discovery note' : 'Why unavailable?';
  if (unavailable && offer.supported) label = 'Why too late?';
  if (denied) label = 'Owner declined';
  if (session.receipt) label = 'Request already complete';
  return `<article class="offer ${recommended ? 'recommended' : ''} ${unavailable || !offer.supported ? 'muted' : ''}" data-offer-card="${offer.id}"><div class="offer-top"><h3>${escape(offer.merchant)}</h3><span class="status-tag ${unavailable || offer.substitute ? 'warn' : ''} ${denied ? 'blocked' : ''}">${denied ? 'Declined' : escape(offer.tag)}</span></div>
    <p class="offer-name">${escape(offer.name)}</p><p class="offer-variant">${escape(offer.variant)} · 1 bag</p><div class="offer-facts"><div>${icon('bag')}<span><strong>${offer.stock ? 'In stock · simulated' : 'Sold out · simulated'}</strong>${offer.supported ? 'Mock Reap checkout candidate' : 'Discovery only · no checkout'}</span></div><div>${icon('truck')}<span><strong>${escape(offer.delivery)}</strong>${validDelivery ? 'Window before care deadline' : 'Does not meet care deadline'}</span></div></div>
    <p class="evidence">${escape(offer.source)}<br>Checked ${dateLabel(offer.checkedAt)} SGT<br>${escape(offer.uncertainty)}</p><div class="offer-price"><strong>${money(offer.item + offer.shipping)}</strong><span>Total · SGD</span></div><p class="price-breakdown">${money(offer.item)} item + ${money(offer.shipping)} delivery</p><button class="button ${recommended ? '' : 'secondary'}" ${action} ${denied || session.receipt ? 'disabled' : ''}>${label}</button></article>`;
}
function offersView() {
  const exact = session.offers.filter(o => !o.substitute);
  const viable = eligibleExact(session.offers, session.context);
  const needsSubstitute = ['substitute', 'denied'].includes(session.scenario);
  const urgent = session.meals === 1;
  const order = ['exact', 'discovery', 'usual', 'economy'];
  exact.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const heading = urgent ? 'Tonight needs an earlier handoff.' : needsSubstitute ? 'The usual won’t arrive in time.' : 'Same product. A different way here.';
  const summary = urgent ? 'No listed delivery reaches tonight’s 8 pm deadline. Ask Asha and Jia to arrange a handoff of the approved food. The demo has not contacted anyone or created a checkout.' : needsSubstitute ? 'No exact match is eligible for mock checkout before the deadline. The discovery seller remains outside the payment path.' : viable.length ? 'The exact 2 kg chicken recipe fits the care window. Kohepets express totals S$59.50, including delivery.' : 'An exact match is available, but this care request fails a permission or spend control. Review the cart to see why.';
  return `${notice()}<section class="panel"><div class="panel-heading"><div><p class="section-label">02 · COMPARE OPTIONS</p><h2>${heading}</h2><p class="panel-intro">Exact recipe, variant and quantity first. Every listing below is synthetic.</p></div></div><div class="results-summary">${icon(urgent || needsSubstitute ? 'info' : 'check')}<p><strong>${urgent ? 'Manual care handoff needed' : needsSubstitute ? 'Owner decision needed' : viable.length ? 'One exact match fits' : 'Control needs attention'}</strong>${summary}</p></div>
    <div class="offers">${exact.map(o => offerCard(o, viable.some(v => v.id === o.id))).join('')}</div>
    ${needsSubstitute && !urgent ? `<section class="substitute-section"><h3>A different recipe, for Asha to consider</h3><p>The agent can explain an option. Only the owner can choose a diet change. No nutritional or medical equivalence is assumed.</p>${offerCard(session.offers.find(o => o.substitute))}</section>` : ''}
    <div class="actions">${backButton('Back to care update')}<span class="small">Kohepets is Reap-listed; these product offers and checkout support are mocked and untested.</span></div></section>`;
}
function substitutionView() {
  return `${notice()}<section class="panel"><span class="owner-pill"><span class="avatar peach">AS</span>Asha · owner decision</span><p class="section-label">A SEPARATE CHOICE</p><h2>Change Milo’s recipe?</h2><p class="panel-intro">The exact product can’t reach the care window through the mock checkout path. This is a different food.</p><div style="margin-top:22px">${productSummary(session.cart.offer)}</div><div class="alternative-warning"><strong>Chicken → turkey. Same bag size, different recipe.</strong>We have not assessed nutritional suitability or medical equivalence. Choose this only if you’re comfortable making the change for Milo.</div>
    ${session.scenario === 'denied' ? '<div class="notice">Simulated owner instruction: “Do not switch Milo’s recipe.” Approval is unavailable for this scenario.</div>' : '<p class="panel-intro">Your choice applies to this one-bag cart. You’ll still review and approve the total before checkout.</p>'}<div class="actions">${backButton()}<button class="button danger" data-action="deny-substitute">Decline substitute</button><button class="button" data-action="approve-substitute" ${session.scenario === 'denied' ? 'disabled' : ''}>Choose this recipe</button></div></section>`;
}
function cartView() {
  const checks = policyChecks(session.cart, session.context);
  const allPass = checks.every(c => c.ok);
  return `${notice()}<section class="panel"><span class="owner-pill"><span class="avatar peach">AS</span>Asha · owner cart review</span><div class="panel-heading"><div><p class="section-label">03 · REVIEW & APPROVE</p><h2>A cart with clear boundaries.</h2></div><span class="status-tag ${allPass ? '' : 'blocked'}">${allPass ? 'Controls passed' : 'Checkout blocked'}</span></div>${productSummary(session.cart.offer)}<div class="quantity-control"><label for="quantity">Bags</label><input type="number" id="quantity" min="1" max="5" step="1" value="${session.cart.quantity}" aria-describedby="quantity-limit"><span class="small" id="quantity-limit">Permission covers 1 bag.</span></div>
    <div class="quote-rows"><div class="quote-row"><span>${session.cart.quantity} × 2 kg bag</span><span>${money(session.cart.offer.item * session.cart.quantity)}</span></div><div class="quote-row"><span>Delivery · ${escape(session.cart.offer.delivery)}</span><span>${money(session.cart.offer.shipping)}</span></div><div class="quote-row total"><span>Total · SGD</span><span>${money(total(session.cart))}</span></div></div><h3>Deterministic care-request checks</h3><div class="checks">${checks.map(c => `<div class="check ${c.ok ? '' : 'fail'}">${icon(c.ok ? 'check' : 'x')}<div><strong>${escape(c.label)}</strong>${escape(c.detail)}</div></div>`).join('')}</div><p class="cart-controls-note">These care-budget checks run in the app. Each checkout requires owner approval. A changed cart needs fresh approval. This demo grants no recurring purchase authority.</p>
    <div class="actions">${backButton()}<button class="button" data-action="approve-cart">${icon(allPass ? 'shield' : 'lock')}${allPass ? `Approve ${money(total(session.cart))} & continue` : 'Check why checkout is blocked'}</button></div><p class="small" style="margin-top:16px">Mock quote · synthetic delivery estimate. Approval is simulated as Asha; no identity verification happens.</p></section>`;
}
function checkoutView() {
  return `${notice()}<section class="panel"><p class="section-label">04 · OWNER CHECKOUT</p><h2>One approval. One checkout.</h2><p class="panel-intro">This screen represents the future hosted Reap checkout. It is a local mock; no Reap API call has been made.</p><div class="checkout-shell"><div class="checkout-brand"><b>reap<span style="color:#58744f"> / demo</span></b><span>Simulated sandbox</span></div><div class="checkout-body"><span class="owner-pill">${icon('shield')}Asha approved this exact cart</span><h3>${escape(session.cart.offer.merchant)}</h3><p>${escape(session.cart.offer.name)} · ${session.cart.quantity} bag</p><div class="price-large">${money(total(session.cart))}</div><p>Includes ${money(session.cart.offer.shipping)} delivery. Estimated ${escape(session.cart.offer.delivery)}; arrival is not guaranteed.</p><button class="button full" data-action="complete" ${paying ? 'disabled' : ''}>${icon('lock')}${paying ? 'Recording mock result…' : 'Complete simulated payment'}</button><p class="checkout-disclaimer">No card details, no funds, no merchant order. A future live adapter must obtain Reap’s hosted owner approval and verify status server-side.</p>${session.scenario === 'duplicate' ? `<button class="button secondary full" data-action="double-submit" ${paying ? 'disabled' : ''}>Test a repeated payment click</button>` : ''}</div></div><div class="actions">${backButton('Cancel checkout & return')}<span class="small">Cancelling clears this cart’s checkout approval.</span></div></section>`;
}
function receiptView() {
  const r = session.receipt;
  return `${notice()}<section class="panel"><div class="receipt-header"><div class="success-icon">${icon('check')}</div><p class="section-label">05 · RECEIPT & CARE LOG</p><h2>Milo’s request is on record.</h2><p>Mock checkout complete. One receipt, one care-log entry.</p></div><div class="receipt-paper"><div class="receipt-meta"><strong>${escape(r.id)}</strong><span>SIMULATED · ${dateLabel(r.completedAt)} SGT</span></div>${productSummary(r.offer)}<div class="quote-rows"><div class="quote-row"><span>Merchant</span><span>${escape(r.offer.merchant)}</span></div><div class="quote-row"><span>Quantity</span><span>${r.quantity} bag</span></div><div class="quote-row"><span>Delivery estimate</span><span>${escape(r.offer.delivery)}</span></div><div class="quote-row total"><span>Simulated total</span><span>${money(r.total)}</span></div></div><p class="small">No real payment, delivery booking or order was placed. Arrival remains uncertain.</p></div><div class="care-log"><h3>${icon('list')} Care log · ${session.careLog.length} entry</h3><p>Asha approved ${escape(r.offer.name)}, ${r.quantity} bag, at ${money(r.total)} including delivery. ${r.offer.substitute ? 'The owner explicitly chose the different turkey recipe.' : 'Milo’s exact usual recipe was retained.'}</p><span class="small">Jia can see the simulated result. No message was sent to anyone.</span></div><div class="actions"><button class="button secondary" data-action="replay">Replay same payment request</button><button class="button" data-action="reset">Try another scenario</button></div><p class="small" style="margin-top:14px">Duplicate guard applies within this demo session. Reloading starts a new, empty simulation.</p></section>`;
}
const views = { care: careView, searching: searchView, offers: offersView, substitution: substitutionView, cart: cartView, checkout: checkoutView, receipt: receiptView };
function render({ focus = false, replace = false } = {}) {
  const activeStep = { care: 0, searching: 1, offers: 1, substitution: 2, cart: 2, checkout: 3, receipt: 4 }[session.stage];
  $('#steps').innerHTML = ['Care update', 'Compare', 'Approve', 'Checkout', 'Care log'].map((label, i) => `<span class="step ${i === activeStep ? 'active' : ''} ${i < activeStep ? 'done' : ''}" ${i === activeStep ? 'aria-current="step"' : ''}><span class="step-index">${i < activeStep ? '✓' : i + 1}</span>${label}</span>`).join('');
  const expiry = policyChecks({ offer: session.offers[1], quantity: 1 }, session.context).find(c => c.id === 'expiry');
  $('#care-deadline').textContent = `${dateLabel(session.context.deadline)} SGT`;
  $('#permission-context').className = `permission ${expiry.ok ? '' : 'invalid'}`;
  $('#permission-context').innerHTML = `${icon(expiry.ok ? 'shield' : 'lock')}<span>${expiry.ok ? 'Permission ends 9 Oct, 7 pm SGT.<br>Owner approves every checkout.' : 'Permission expired. A new owner care request is needed.'}</span>`;
  $('#flow').innerHTML = views[session.stage]();
  $('#timeline').innerHTML = session.events.length ? session.events.map((e, i) => `<div class="timeline-item"><span class="timeline-number">${i + 1}</span><div><strong>${escape(e.title)}</strong><p>${escape(e.detail)}</p></div></div>`).join('') : '<p class="empty-timeline">The care update is ready. Confirm meals remaining to begin.</p>';
  $('#timeline-count').textContent = `${session.events.length} action${session.events.length === 1 ? '' : 's'}`;
  $('#timeline-content').hidden = !timelineOpen; $('#timeline-toggle').setAttribute('aria-expanded', String(timelineOpen));
  paintIcons();
  if (session.stage !== lastStage && session.stage !== 'searching') {
    const state = { revision, stage: session.stage };
    history[replace || lastStage === null ? 'replaceState' : 'pushState'](state, '', `#${session.stage}`);
    lastStage = session.stage;
  }
  if (focus) {
    const target = $('#notice') || $('#flow h2');
    if (target) { target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'start', behavior: 'auto' }); }
  }
}
function announce(text) { $('#announcer').textContent = text; }
function reset(scenario = scenarioSelect.value) {
  epoch++; paying = false; revision++; session = new DemoSession(scenario, `care-${revision}`); lastStage = null;
  render({ replace: true, focus: true }); announce('Demo reset. New empty care request.');
}
function beginSearch() {
  const meals = Number($('#meals').value);
  if (!session.beginSearch(meals)) { render({ focus: true }); return; }
  const token = ++epoch, active = session;
  render({ focus: true }); announce('Simulated search started.');
  setTimeout(() => { if (token !== epoch || active !== session) return; session.finishSearch(); render({ focus: true }); announce('Simulated comparison ready.'); }, 850);
}
function completePayment(double = false) {
  if (paying || session.stage !== 'checkout') return;
  paying = true; const token = ++epoch, active = session;
  render(); announce('Recording simulated payment result.');
  setTimeout(() => {
    if (token !== epoch || active !== session) return;
    paying = false;
    try { session.complete(); if (double) session.complete(); } catch (error) { session.notice = error.message; }
    render({ focus: true }); announce(session.notice || 'Simulated checkout complete. One receipt saved.');
  }, 650);
}
document.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]'); if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'search') return beginSearch();
  if (action === 'complete' || action === 'double-submit') return completePayment(action === 'double-submit');
  if (action === 'reset') return reset();
  if (action === 'back') { epoch++; paying = false; session.back(); render({ focus: true, replace: true }); return; }
  try {
    if (action === 'select') session.select(button.dataset.offer);
    if (action === 'approve-substitute') session.chooseSubstitute(true);
    if (action === 'deny-substitute') session.chooseSubstitute(false);
    if (action === 'approve-cart') session.approveCart();
    if (action === 'replay') session.complete();
  } catch (error) { session.notice = error.message; }
  render({ focus: true });
});
document.addEventListener('change', event => {
  if (event.target.id === 'quantity') { const amount = Number(event.target.value); session.setQuantity(amount); render(); $('#quantity').focus(); }
});
scenarioSelect.addEventListener('change', () => reset());
$('#reset-top').addEventListener('click', () => reset());
$('.brand').addEventListener('click', event => { event.preventDefault(); reset(); });
$('#timeline-toggle').addEventListener('click', () => { timelineOpen = !timelineOpen; $('#timeline-content').hidden = !timelineOpen; $('#timeline-toggle').setAttribute('aria-expanded', String(timelineOpen)); });
window.addEventListener('popstate', event => {
  epoch++; paying = false;
  if (session.stage === 'checkout') session.cancelCheckout();
  const target = event.state?.revision === revision ? event.state.stage : 'care';
  if (session.receipt) { session.stage = 'receipt'; session.notice = 'Completed request retained. Reset to start a new care request.'; }
  else if (target === 'care' || target === 'offers') { session.stage = target; session.ownerApproval = null; session.context.substitution = null; session.cart = null; }
  else if (target === 'cart' && session.cart) session.stage = 'cart';
  else session.back();
  lastStage = null; render({ focus: true, replace: true });
});
// Read-only agent inspection; approval and checkout remain in the owner's visible UI.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  try { Promise.resolve(document.modelContext.registerTool({
    name: 'read_care_request', title: 'Read simulated care request',
    description: 'Read the current simulated care request, offer eligibility and stage. This does not approve a purchase or change state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute(input) { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Expected an empty object.'); return { simulation: true, scenario: session.scenario, stage: session.stage, budget: session.context.budget, currency: 'SGD', receiptCount: session.careLog.length, eligibleExactOfferIds: eligibleExact(session.offers, session.context).map(o => o.id) }; }
  }, { signal: lifecycle.signal })).catch(() => {}); } catch { /* Unsupported registry must not block the demo. */ }
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}
render({ replace: true });
