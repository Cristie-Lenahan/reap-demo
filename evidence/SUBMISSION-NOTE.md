# Kampawng Essentials × Reap

Demo: https://reap-demo.kampawng.com/

Kampawng helps a pet owner review an actual sandbox food variant, consent separately to a substitute, and check the full shipping-inclusive cost before checkout. Server-side Reap SG sandbox APIs provide catalogue, variant, quote, hosted enrollment, checkout and authoritative result.

Verified example: Royal Canin Indoor 27 2kg, S$43.90 including shipping, ACTIVE enrollment and COMPLETED checkout with one durable receipt. Duplicate replay and service restart return that same receipt. Budget, quote expiry and distinct consent gates are enforced. API credentials stay server-side; each visitor receives an isolated browser session without a demo login.

All care/recipient data is synthetic. Reap simulation was requested; the provider also returned a hosted step. This verifies sandbox completion, not production payment, merchant delivery, or an independently qualified hosted-payment-approval flow. Open the link to browse product cards, choose a size, review a shipping-inclusive cart and complete a personal sandbox flow. Reloads preserve the current cart; after completion, “Shop pet food again” starts a new request and retains the prior receipt. `/concept` preserves the scripted scenarios.
