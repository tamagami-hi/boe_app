LOCK TABLE content_items IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMPORARY TABLE company_name_corrections ON COMMIT DROP AS
SELECT id, content_key, kind, title, body, payload
FROM content_items
WHERE content_key IN ('investor-charter', 'grievance-redressal')
  AND state = 'published'
  AND payload #>> '{contact,address}' = 'BeOnEdge Financial Services Pvt. Ltd.';

UPDATE content_items AS item
SET state = 'archived',
    archived_at = now(),
    updated_at = now()
FROM company_name_corrections AS correction
WHERE item.id = correction.id;

INSERT INTO content_items (content_key, kind, version, title, body, payload, state, published_at)
SELECT correction.content_key,
       correction.kind,
       (SELECT max(existing.version) + 1 FROM content_items AS existing WHERE existing.content_key = correction.content_key),
       correction.title,
       correction.body,
       jsonb_set(correction.payload, '{contact,address}', to_jsonb('BeOnEdge LLP'::text)),
       'published',
       now()
FROM company_name_corrections AS correction;
