-- RA-C.10: email-OTP KYC verification codes (decisions 8-10). A short-lived,
-- hashed one-time code emailed to the client from the company mailbox; verifying
-- it approves the user's kyc_case. OTP semantics (attempt counting + resend
-- cooldown) differ from the high-entropy link tokens in verification_tokens, so
-- this is a dedicated additive table rather than an overload of that table.
-- Additive on the canonical baseline (>= 009). The raw code is never stored;
-- only its 32-byte keyed hash is persisted.

CREATE TABLE kyc_verification_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kyc_case_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  code_hash bytea NOT NULL,
  code_key_version text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Ownership is bound to the case's (id, user_id) so a code can never reference
  -- another user's KYC case.
  CONSTRAINT kyc_verification_codes_case_fk
    FOREIGN KEY (kyc_case_id, user_id) REFERENCES kyc_cases (id, user_id) ON DELETE RESTRICT,
  CONSTRAINT kyc_verification_codes_hash_len CHECK (octet_length(code_hash) = 32),
  CONSTRAINT kyc_verification_codes_key_version CHECK (btrim(code_key_version) <> ''),
  CONSTRAINT kyc_verification_codes_attempts CHECK (attempt_count >= 0),
  CONSTRAINT kyc_verification_codes_expiry CHECK (expires_at > created_at)
);

-- At most one active (unconsumed) code per case: a resend supersedes the old one.
CREATE UNIQUE INDEX kyc_verification_codes_active_uk
  ON kyc_verification_codes (kyc_case_id)
  WHERE consumed_at IS NULL;

-- Owner history + resend-cooldown lookup.
CREATE INDEX kyc_verification_codes_user_idx
  ON kyc_verification_codes (user_id, created_at DESC);
