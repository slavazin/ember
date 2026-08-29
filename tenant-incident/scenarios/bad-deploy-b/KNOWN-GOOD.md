# Known-good reference — pricing-svc build 2026.09.02

The reference a change-lens diagnosis diffs the running build against. It records
what the last known-good build did on this surface, so "what changed" has a
baseline to be read against.

- **Build:** `2026.09.02` (succeeds `2026.08.26`).
- **Surface:** `GET /price/:cart` through the gateway.
- **Behavior under the standing cart mix (1..5):** every cart returns 200; carts
  4 and 5, which carry no discount key, are priced at full via a defensive
  `.get("discount", 0)`. Zero 5xx.
- **Pricing-path work:** the catalog lookup and the discount math only.

The successor build `2026.09.09` is identical except one line on the pricing
path — the discount read dropped its default (`item.get("discount", 0)` became
`item["discount"]`), so carts without a discount now raise `KeyError` and return
500. That single change is the regression; the catalog, the cart mix, and the
request rate are unchanged. A diff of the two build sources
(`pricing-svc/app_2026_09_02.py` vs `app_2026_09_09.py`) shows it.
