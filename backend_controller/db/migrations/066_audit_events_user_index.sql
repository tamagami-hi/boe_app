CREATE INDEX audit_events_metadata_user_idx
  ON audit_events ((metadata->>'userId'), occurred_at DESC, id DESC)
  WHERE metadata ? 'userId';
