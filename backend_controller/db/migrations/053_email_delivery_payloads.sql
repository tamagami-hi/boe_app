CREATE TABLE email_delivery_payloads (
  email_delivery_id uuid PRIMARY KEY REFERENCES email_deliveries(id) ON DELETE RESTRICT,
  ciphertext bytea NULL,
  nonce bytea NULL,
  key_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  scrubbed_at timestamptz NULL,
  CONSTRAINT email_delivery_payloads_key_version CHECK (btrim(key_version) <> ''),
  CONSTRAINT email_delivery_payloads_envelope CHECK (
    (ciphertext IS NULL AND nonce IS NULL)
    OR (
      ciphertext IS NOT NULL AND octet_length(ciphertext) >= 16
      AND nonce IS NOT NULL AND octet_length(nonce) = 12
    )
  ),
  CONSTRAINT email_delivery_payloads_scrubbed CHECK ((ciphertext IS NULL) = (scrubbed_at IS NOT NULL))
);
