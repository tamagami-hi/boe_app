ALTER TABLE users
  ADD COLUMN nominee_name text NULL,
  ADD COLUMN nominee_relation text NULL,
  ADD COLUMN nominee_version integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT users_nominee_pair CHECK ((nominee_name IS NULL) = (nominee_relation IS NULL)),
  ADD CONSTRAINT users_nominee_version_nonnegative CHECK (nominee_version >= 0),
  ADD CONSTRAINT users_nominee_name_valid CHECK (
    nominee_name IS NULL OR (
      nominee_name = btrim(nominee_name)
      AND char_length(nominee_name) BETWEEN 2 AND 120
      AND nominee_name !~ '[\u0001-\u001f\u007f-\u009f]'
      AND nominee_name !~ '[\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]'
      AND nominee_name !~ '^[\u200c\u200d]|[\u200c\u200d]$'
    )
  ),
  ADD CONSTRAINT users_nominee_relation_valid CHECK (
    nominee_relation IS NULL OR (
      nominee_relation = btrim(nominee_relation)
      AND char_length(nominee_relation) BETWEEN 2 AND 120
      AND nominee_relation !~ '[\u0001-\u001f\u007f-\u009f]'
      AND nominee_relation !~ '[\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]'
      AND nominee_relation !~ '^[\u200c\u200d]|[\u200c\u200d]$'
    )
  );

CREATE FUNCTION users_clear_tombstoned_nominee() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.nominee_name := NULL;
  NEW.nominee_relation := NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_tombstone_clears_nominee
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW
  WHEN (NEW.pii_tombstoned_at IS NOT NULL AND (NEW.nominee_name IS NOT NULL OR NEW.nominee_relation IS NOT NULL))
  EXECUTE FUNCTION users_clear_tombstoned_nominee();
