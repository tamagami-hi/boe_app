ALTER TABLE mandate_setup_attempts
  DROP CONSTRAINT mandate_setup_attempts_token_envelope_check,
  DROP COLUMN sdk_order_token_ciphertext,
  DROP COLUMN sdk_order_token_nonce,
  DROP COLUMN sdk_order_token_key_version,
  DROP COLUMN sdk_order_token_expires_at,
  ADD COLUMN checkout_redirect_url text NULL CHECK (
    checkout_redirect_url IS NULL OR (
      length(checkout_redirect_url) BETWEEN 1 AND 2048
      AND checkout_redirect_url ~ '^https://'
    )
  );

ALTER TABLE mandate_setup_attempts
  ADD CONSTRAINT mandate_setup_attempts_provider_pending_shape CHECK (
    state <> 'provider_pending'
    OR (
      provider_dispatch_started_at IS NOT NULL
      AND provider_order_id IS NOT NULL
    )
  );

UPDATE payment_attempts
SET checkout_channel = 'hosted_redirect'
WHERE checkout_channel = 'phonepe_mobile_sdk';

ALTER TABLE payment_attempts
  DROP CONSTRAINT payment_attempts_checkout_channel_check,
  DROP CONSTRAINT payment_attempts_sdk_token_envelope_check,
  DROP CONSTRAINT payment_attempts_mobile_pending_envelope_check,
  DROP CONSTRAINT payment_attempts_dispatch_channel_check,
  DROP COLUMN sdk_order_token_ciphertext,
  DROP COLUMN sdk_order_token_nonce,
  DROP COLUMN sdk_order_token_key_version,
  DROP COLUMN sdk_order_token_expires_at;

ALTER TABLE payment_attempts
  ADD CONSTRAINT payment_attempts_checkout_channel_check
    CHECK (checkout_channel IN ('hosted_redirect', 'phonepe_autopay', 'phonepe_mandate_setup')),
  ADD CONSTRAINT payment_attempts_dispatch_channel_check
    CHECK (
      provider_dispatch_started_at IS NULL
      OR checkout_channel IN ('hosted_redirect', 'phonepe_autopay', 'phonepe_mandate_setup')
    );
