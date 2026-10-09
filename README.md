# Kampawng Essentials × Reap

**[Open the pet-food demo](https://reap-demo.kampawng.com/)**

A small shopping demo for Milo, a fictional cat: browse pet food, choose a size, check the full delivery-inclusive price, and complete a sandbox test order. Kampawng’s supplied banner, plaid background and care-focused branding are preserved.

## Walkthrough

1. Choose a product card and size.
2. Confirm your food choice and add one item to the cart.
3. Calculate delivery and review the full total within **S$65**. Delivery timing is not guaranteed.
4. Set up the team’s sandbox test card on the secure page returned by Reap. Never use a real card. Card setup is separate from the food order; a $0.00 amount during setup is not the cart total.
5. Return and check card setup. Once Reap confirms it is ready, refresh any expired delivery price and review the cart again.
6. Place the test order, complete any required hosted approval yourself, and check the result. A receipt appears only after Reap confirms completion.
7. Use **Shop pet food again** after completion to start a new cart while preserving the old receipt.

Each browser has its own signed session, cart, synthetic owner reference, enrollment and checkout. Reloading resumes that cart. A repeat request returns the same checkout/receipt; it does not create another order. Pending or uncertain orders cannot be reset into another checkout.

## What is real—and what is a demo

The server calls **Reap SG sandbox** for product search, details, actual variants, quotes, shipping selection, enrollment and checkout status. The recipient and care context are synthetic. Product-pack illustrations are placeholders, not merchant photographs.

Checkout requests `X-Simulate-Checkout: COMPLETED`. Reap may still return a hosted approval step. The tested example completed at **S$43.90**, with one durable receipt that survived replay and service restart. This proves sandbox completion, not real payment, merchant delivery, production readiness or an independently qualified hosted-payment-approval flow. Individual new visitors must complete their own card setup.

Food/substitution consent, cart review and hosted payment approval are separate. The demo does not assess dietary or medical suitability.

## Run the source locally

Node.js 20 or later. No production npm dependencies are required.

```sh
npm run build
npm run preview
```

This starts the original self-contained concept demo on `127.0.0.1:4173`. The live API-backed shop is built separately as `dist/sandbox.html` and served by `sandbox-serve.mjs`; the original concept remains at `/concept` on the live site.

The sandbox server is configured for the existing demo host: `127.0.0.1:4174`, public origin `https://reap-demo.kampawng.com`, fixed provider `https://sg.sandbox.api.reap.global`, API version `2025-02-14`. Its private configuration directory is defined in `backend/config.mjs`. Credentials and browser state are intentionally absent from this repository; adapt the private directory and approved origin checks deliberately for a different deployment.

The server expects `REAP_API_KEY`, `REAP_BASE_URL` and `REAP_VERSION` in the private `reap-sandbox.env`. Keep that file outside the repository with permission `0600`. Browser-cookie signing material is generated privately by the server. Never put API credentials into HTML, browser scripts, logs or commits.

```sh
npm run sandbox
```

## Verification

```sh
npm test
npm run test:backend
```

The DOM suite uses optional `linkedom` for development only:

```sh
npm install --no-save --package-lock=false linkedom
npm run test:dom
```

Without it, DOM tests are explicitly skipped. With a separate installation, set `KAMPAWNG_DOM_MODULE` to its absolute module entrypoint.

**53 passing checks:** 15 model, 27 backend/security/session and 11 DOM. Coverage includes separate consent, money/budget/expiry, exact variants, interrupted-operation locks, duplicate replay/restart, isolated browser sessions, cookie tampering/origins, archived receipts and hosted-return reconciliation without automatically creating checkout. See [public verification](evidence/PUBLIC-VERIFICATION.md) and [submission notes](evidence/SUBMISSION-NOTE.md).

## Server protections and deployment limits

The API is a bounded pet-food demo, with fixed provider endpoints, known catalogue identifiers, one-item carts, SGD, an S$65 budget, strict origins and signed session cookies. No arbitrary provider URL, caller credential or raw-card input is accepted. Rate limits apply per browser and globally. The event deployment currently permits 100 browser sessions and four shopping runs per session.

Durable state uses private atomic, fsynced files and one writer per store. Unknown POST outcomes fail closed; do not delete state or invent a new key to retry an uncertain order. Completed receipts and old operation keys remain stored when a new cart starts.

The live service is retained on the demo host but is transient: it does not automatically start after a reboot. Rollback snapshots and operational handoff notes are kept locally and excluded from this public repository.

## Assets and references

Kampawng supplied the banner and branding assets. Milo is a generated illustration. The bundled Londrina Solid font’s OFL license is in [assets/OFL-LondrinaSolid.txt](assets/OFL-LondrinaSolid.txt). No Apple font files or private pet records are included.

- [Official Reap documentation](https://docs.reap.global/)
- [Hackathon microsite](https://reap-hackathon-microsite.vercel.app/)
- [API compatibility history](evidence/API-COMPATIBILITY.md)

The live demo also has a [read-only earlier completed test order](https://reap-demo.kampawng.com/?example=1). This synthetic receipt is separate from each visitor’s cart and pending card setup. It does not place an order or prove independently tested hosted payment approval.
