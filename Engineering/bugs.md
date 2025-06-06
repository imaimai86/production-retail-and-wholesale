# Bug Reports

## Inventory transfer ignores available stock
`Inventory.transfer` subtracts the requested quantity from the source location without verifying that enough quantity exists. If the source location has insufficient or no entry, the resulting quantity can become negative.

**Suggested fix:** During the transaction, check the current quantity for the source location and abort with an error when it is less than the requested amount.

## Sales creation bypasses inventory checks
`Sales.create` deducts inventory only when the sale status is `sold`, but it does not verify available quantity. This can leave inventory negative after a sale.

**Suggested fix:** Validate available stock before completing a sale and refuse the operation when stock is insufficient.
