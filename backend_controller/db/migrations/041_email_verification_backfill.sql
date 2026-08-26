UPDATE users u
SET email_verification_state = CASE latest.state
      WHEN 'approved' THEN 'verified'
      WHEN 'rejected' THEN 'rejected'
      ELSE 'pending'
    END,
    email_verified_at = CASE latest.state
      WHEN 'approved' THEN latest.decided_at
      ELSE NULL
    END,
    email_verification_started_at = latest.submitted_at,
    email_verification_expires_at = CASE latest.state
      WHEN 'approved' THEN latest.expires_at
      ELSE NULL
    END,
    updated_at = now()
FROM (
  SELECT DISTINCT ON (user_id) user_id, state, submitted_at, decided_at, expires_at
  FROM kyc_cases
  ORDER BY user_id, created_at DESC, id DESC
) latest
WHERE latest.user_id = u.id;

INSERT INTO email_verification_codes (
  id,
  user_id,
  code_hash,
  code_key_version,
  attempt_count,
  expires_at,
  consumed_at,
  created_at
)
SELECT id,
       user_id,
       code_hash,
       code_key_version,
       attempt_count,
       expires_at,
       consumed_at,
       created_at
FROM (
  SELECT code.*,
         row_number() OVER (
           PARTITION BY user_id, (consumed_at IS NULL)
           ORDER BY created_at DESC, id DESC
         ) AS active_rank
  FROM kyc_verification_codes code
) source
WHERE source.consumed_at IS NOT NULL OR source.active_rank = 1;

DO $$
DECLARE
  source_count bigint;
  target_count bigint;
BEGIN
  SELECT count(*) INTO source_count FROM kyc_verification_codes;
  SELECT count(*) INTO target_count FROM email_verification_codes;
  IF source_count < target_count THEN
    RAISE EXCEPTION 'email verification code backfill copied more rows than source';
  END IF;
  SELECT count(*) INTO source_count
  FROM kyc_cases
  WHERE state = 'approved';
  SELECT count(*) INTO target_count
  FROM users
  WHERE email_verification_state = 'verified';
  IF target_count < source_count THEN
    RAISE EXCEPTION 'email verification user backfill lost approved users';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM kyc_cases cases
    LEFT JOIN users ON users.id = cases.user_id
    WHERE cases.state = 'approved'
      AND (
        users.id IS NULL
        OR users.email_verification_state <> 'verified'
        OR users.email_verified_at IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'every approved email OTP case must map to a verified durable user with a timestamp';
  END IF;
END $$;
