-- 023_drop_marketing_catalogue.sql
--
-- Remove the marketing catalogue: `courses` and `membership_plans`.
--
-- These existed only to populate the public landing page, which is now a separate
-- application on separate infrastructure (beonedge.in). Nothing in the client app
-- or the admin panel reads them: no public or client endpoint ever exposed either
-- table, and the admin screens that wrote them are removed in the same change.
-- This stack is now solely client investing + admin AUM operations.
--
-- FAQ and legal content are NOT touched. They live in `content_items` and the
-- client app reads them through `/v1/client/support/faqs`,
-- `/v1/public/disclosures`, `/v1/public/investor-charter` and
-- `/v1/public/grievance`.
--
-- Dropped rather than left dormant at the maintainer's explicit instruction. The
-- data is marketing copy that is reproduced on the external site, so there is
-- nothing here that a client's records depend on. `IF EXISTS` keeps the migration
-- idempotent against an environment where it was already applied by hand.
--
-- No dependent objects: neither table is referenced by a foreign key from any
-- surviving table, so no CASCADE is needed and none is used — a CASCADE here
-- could silently remove something a later migration added.

DROP TABLE IF EXISTS membership_plans;
DROP TABLE IF EXISTS courses;
