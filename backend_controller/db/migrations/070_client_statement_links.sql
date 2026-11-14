CREATE TABLE client_statement_links (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE RESTRICT,
  token_hash bytea NOT NULL,
  token_key_version text NOT NULL,
  from_period text NOT NULL,
  to_period text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_statement_links_hash_len CHECK (octet_length(token_hash) = 32),
  CONSTRAINT client_statement_links_key_version CHECK (btrim(token_key_version) <> ''),
  CONSTRAINT client_statement_links_from_period CHECK (from_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT client_statement_links_to_period CHECK (to_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT client_statement_links_period_order CHECK (from_period COLLATE "C" <= to_period COLLATE "C"),
  CONSTRAINT client_statement_links_expiry CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX client_statement_links_token_hash_uk ON client_statement_links (token_hash);
