ALTER TABLE users ADD COLUMN IF NOT EXISTS username text;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_key
  ON users (lower(username))
  WHERE username IS NOT NULL;
