-- 028_permissions_code_three_segments.sql
--
-- permissions_code_check was defined in 012_canonical_rbac_platform.sql as a
-- strict two-segment pattern, then edited in that same file after it had
-- already been applied on deployed databases to allow the three-segment
-- codes the payment/investing permissions (spec §10) actually use, e.g.
-- investments.review.read. Migration tooling never re-applies an
-- already-recorded version, so any database that ran 012 before that edit is
-- still enforcing the old two-segment-only constraint. This makes the
-- constraint match the code that has depended on it ever since, on every
-- database regardless of when it first ran 012.

ALTER TABLE permissions DROP CONSTRAINT permissions_code_check;

ALTER TABLE permissions
  ADD CONSTRAINT permissions_code_check
  CHECK (code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,2}$');
