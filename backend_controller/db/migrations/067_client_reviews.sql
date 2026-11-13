CREATE TABLE client_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  rating smallint NOT NULL,
  comment text NULL,
  state text NOT NULL DEFAULT 'new',
  moderation_note text NULL,
  moderated_by_user_id uuid NULL REFERENCES users (id) ON DELETE RESTRICT,
  moderated_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  review_month date GENERATED ALWAYS AS ((date_trunc('month', created_at AT TIME ZONE 'Asia/Kolkata'))::date) STORED,
  CONSTRAINT client_reviews_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT client_reviews_comment CHECK (
    comment IS NULL OR (
      char_length(comment) BETWEEN 1 AND 1000
      AND comment !~ '^\s'
      AND comment !~ '\s$'
      AND comment !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f]'
      AND comment !~ '[\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\u034f\u115f\u1160\u2800\u3164\uffa0\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]'
      AND comment !~ '^[\u200c\u200d]|[\u200c\u200d]$'
    )
  ),
  CONSTRAINT client_reviews_state CHECK (state IN ('new', 'read', 'hidden')),
  CONSTRAINT client_reviews_moderation_note CHECK (
    moderation_note IS NULL OR (
      char_length(moderation_note) BETWEEN 1 AND 1000
      AND moderation_note !~ '^\s'
      AND moderation_note !~ '\s$'
      AND moderation_note !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f]'
      AND moderation_note !~ '[\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\u034f\u115f\u1160\u2800\u3164\uffa0\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]'
      AND moderation_note !~ '^[\u200c\u200d]|[\u200c\u200d]$'
    )
  ),
  CONSTRAINT client_reviews_moderation_pair CHECK ((moderated_at IS NULL) = (moderated_by_user_id IS NULL)),
  CONSTRAINT client_reviews_version CHECK (version >= 1)
);

CREATE UNIQUE INDEX client_reviews_user_month_uk ON client_reviews (user_id, review_month);

CREATE INDEX client_reviews_user_idx ON client_reviews (user_id, created_at DESC, id DESC);

CREATE INDEX client_reviews_inbox_idx ON client_reviews (created_at DESC, id DESC);

CREATE FUNCTION client_reviews_clear_tombstoned_text() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.pii_tombstoned_at IS NOT NULL) THEN
    NEW.comment := NULL;
    NEW.moderation_note := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER client_reviews_tombstone_clears_text
  BEFORE INSERT OR UPDATE OF comment, moderation_note ON client_reviews
  FOR EACH ROW WHEN (NEW.comment IS NOT NULL OR NEW.moderation_note IS NOT NULL)
  EXECUTE FUNCTION client_reviews_clear_tombstoned_text();

CREATE FUNCTION users_tombstone_clear_review_text() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE client_reviews
     SET comment = NULL, moderation_note = NULL, version = version + 1, updated_at = now()
   WHERE user_id = NEW.id AND (comment IS NOT NULL OR moderation_note IS NOT NULL);
  RETURN NULL;
END;
$$;

CREATE TRIGGER users_tombstone_clears_review_text
  AFTER UPDATE OF pii_tombstoned_at ON users
  FOR EACH ROW WHEN (NEW.pii_tombstoned_at IS NOT NULL)
  EXECUTE FUNCTION users_tombstone_clear_review_text();
