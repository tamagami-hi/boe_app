# Migration 071: the company name in the published legal documents

Status: on local `main` (M14 F1, decision DEC-38, 2026-11-15), not released.

## What it changes

The development content seed gave the investor charter and the grievance document the contact address "BeOnEdge Financial Services Pvt. Ltd.". The company is BeOnEdge LLP. The seed never overwrites a document that exists, so a database seeded before the correction keeps the old name until this migration runs.

For `investor-charter` and `grievance-redressal` only, a **published** document whose `contact.address` is **exactly** `BeOnEdge Financial Services Pvt. Ltd.` gets a new published version. The new version is a copy of the old one, with `contact.address` set to `BeOnEdge LLP` and everything else unchanged. The old version is archived, the way an admin publish archives it, and nothing is deleted.

The migration leaves these alone:
- any other address, including one that only contains the old name;
- drafts;
- every other document;
- the wrong name in any field other than `contact.address`.

It writes no audit row. Seed-published documents have none either, and the change can be traced from three places:
- the archived row's `archived_at`;
- the new row, whose `published_by_user_id` is empty;
- `schema_migrations`.

## Before deploying it to production

Run this read-only query against production. `will_change` is true only on the rows the migration republishes:

```sql
SELECT content_key,
       version,
       state,
       payload #>> '{contact,address}' AS address,
       state = 'published'
         AND content_key IN ('investor-charter', 'grievance-redressal')
         AND payload #>> '{contact,address}' = 'BeOnEdge Financial Services Pvt. Ltd.' AS will_change
FROM content_items
WHERE content_key IN ('investor-charter', 'grievance-redressal')
   OR payload::text ILIKE '%Financial Services%'
   OR title ILIKE '%Financial Services%'
   OR body ILIKE '%Financial Services%'
ORDER BY content_key, version;
```

Any row that names the old company but has `will_change` false is left as it is. Correct it by hand, or ask for a follow-up change.

## Compatibility and rollback

- **v0.16.1** runs unchanged against a database with 071 applied. It reads the published row, its admin FAQ writes use their own keys, and the seed's version-1 insert does nothing when the row exists.
- **071 is not a rollback boundary.** An images-only rollback to v0.16.1 keeps the corrected documents.
- **Lock:** the migration holds `SHARE ROW EXCLUSIVE` on `content_items` for its own transaction. Reads continue during that time, and content writes wait milliseconds.
- **Caching:** public documents are cached for `CACHE_PUBLIC_CONTENT_TTL_MS` (60 seconds by default), so the old name can show for up to a minute after the migration.
