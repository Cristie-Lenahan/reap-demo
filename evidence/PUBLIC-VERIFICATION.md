# Public demo verification

Live demo: https://reap-demo.kampawng.com/

## Observed sandbox results

- Actual Reap catalogue search, details and variant resolution succeeded.
- Royal Canin Indoor 27, 2kg: S$35.90 plus S$8 delivery, S$43.90 total.
- Original human test-card setup became ACTIVE after an initially pending response.
- Original checkout progressed to COMPLETED, verified by official GET status, producing one receipt. Replaying it after a graceful service restart returned the same receipt and retained one checkout operation.
- Checkout requested Reap’s simulation header; the provider also returned a hosted step. Independent hosted payment approval is not claimed as qualified.
- The later multi-browser shop was verified with separate public sessions. One browser’s search did not affect the other. A new unique-owner browser flow reached a real shipping quote and hosted enrollment; completion of that visitor’s sensitive step remains with the human.

## Local checks

53 passing checks: 15 model, 27 backend/security/session and 11 DOM. The DOM suite exercised the built shopping flow, separate consent, ACTIVE gate, receipt, replay, new cart and return reconciliation with provider fixtures. Fixture completion is distinct from actual provider evidence.

Chrome desktop, 375×812 phone portrait and 812×375 landscape were checked. Product grid and cart had no horizontal overflow; observed button heights exceeded 44px. The supplied banner loaded. The final readable copy was verified on the served page; the existing 11 DOM checks still passed after those changes.

The actual saved Reap key and browser signing secret were checked absent from the public built page. Private files remained outside the workspace. Source routes returned 404; API POST without a signed cart cookie returned 401. The public page’s build hash matched the origin artifact.

## Screenshots

- [Product cards](shop-product-grid.jpg)
- [Phone product cards](shop-mobile-products.jpg)
- [Plain-language cart](shop-readable-copy.jpg)
- [Original confirmed sandbox receipt](live-sandbox-receipt.jpg)

All people, addresses and care information shown are demo data. No real money, merchant purchase or delivery was performed.
