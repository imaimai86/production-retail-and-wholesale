
## Round 1 (2026-10-05)


### Q1: Response body for 400 and 404
Only the 409 body is defined (`{ "error": "Insufficient stock" }`). Existing sale-not-found 404s return an empty body. What do the new 400s (missing/invalid location, status, quantity, product_id, from, to; from == to) and the new 404 on POST /sales (unknown product+location) return?
**Suggested:** `{ "error": "<message>" }`, same shape as the 409. Tests assert the status code and that `error` is a non-empty string, not the exact text. Existing sale-not-found 404s stay unchanged.
**Answer:** accept

### Q2: product_id validation on POST /sales
Should POST /sales return 400 when `product_id` is missing or empty?
**Suggested:** Yes, 400, consistent with POST /inventory/transfer. A product with no inventory row at the location still returns 404.
**Answer:** accept
