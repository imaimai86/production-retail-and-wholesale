# Suggested Improvements for Sales and Inventory APIs

The following suggestions aim to enhance the sales and inventory APIs, organized into phased improvements.

## Phase 1

1. **Connect Sales with Inventory Updates**
   - When a sale is created, deduct the quantity from inventory or mark the item as reserved so it cannot be sold twice.
   - Use database transactions to ensure the sale and inventory update occur atomically.

2. **Introduce Order Statuses**
   - Extend the `sales` table with a `status` column (`order_created`, `sold`, etc.).
   - Items with `order_created` status should be blocked from further sales to prevent double booking.
   - Provide an endpoint to update an order from `order_created` to `sold` once payment or shipment is completed.

3. **Allow Sale Reversal**
   - Implement an endpoint to revoke or cancel a sale, both for `order_created` and `sold` records.
   - Reversing a sale should return the reserved or sold quantity back to inventory.

4. **Product Categories and GST Rates**
   - Add a `categories` table with GST percentages and link products to categories via `category_id`.
   - Use these rates to automatically calculate GST for sales and billing.

5. **Billing API**
   - Provide an API that generates invoice lines, including GST amounts per item and the overall total.

6. **Inventory Transfers as Transactions**
   - Wrap inventory transfer operations in a transaction to prevent inconsistent states if one part of the transfer fails.

These enhancements would synchronize sales and inventory accurately, allow temporary order reservations, support GST compliance, and enable robust order and billing workflows.

## Phase 2
- Batch tracking with expiry dates.
- Low stock alerts.
- Automated reordering.

## Phase 3
- Role-based access control (RBAC) to define permissions for different user roles (e.g., admin, sales staff, inventory manager).
- User authentication enhancements, including password complexity rules, multi-factor authentication (MFA) options.
- Audit logs to track significant user actions for security and compliance.

## Future Enhancements
- Customer relationship management (CRM) integration.
- Support for multiple currencies.
- Recurring billing for subscriptions.
