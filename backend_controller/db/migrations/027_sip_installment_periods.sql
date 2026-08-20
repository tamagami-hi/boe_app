-- 027_sip_installment_periods.sql
--
-- Names the calendar month a SIP installment order belongs to, and makes a
-- second installment order for the same plan and month structurally
-- impossible. A SIP is client-initiated, no-auto-debit checkout per
-- installment (spec §6.2 fallback); the risk this guards against is the
-- reconciliation worker creating, or a crash/retry duplicating, a second
-- payable order for a month whose installment already exists, however that
-- first order's payment ultimately resolves.

ALTER TABLE investment_orders
  ADD COLUMN due_period date NULL;

ALTER TABLE investment_orders
  ADD CONSTRAINT investment_orders_due_period_link
    CHECK ((type = 'sip_installment') OR (due_period IS NULL));

CREATE UNIQUE INDEX investment_orders_sip_plan_period_uk
  ON investment_orders (sip_plan_id, due_period)
  WHERE type = 'sip_installment';
