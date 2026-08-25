ALTER TABLE payment_attempts
  ADD COLUMN checkout_channel text NOT NULL DEFAULT 'hosted_redirect',
  ADD COLUMN provider_dispatch_started_at timestamptz NULL,
  ADD COLUMN sdk_order_token_ciphertext bytea NULL,
  ADD COLUMN sdk_order_token_nonce bytea NULL,
  ADD COLUMN sdk_order_token_key_version text NULL,
  ADD COLUMN sdk_order_token_expires_at timestamptz NULL,
  ADD CONSTRAINT payment_attempts_checkout_channel_check
    CHECK (checkout_channel IN ('hosted_redirect', 'phonepe_mobile_sdk')),
  ADD CONSTRAINT payment_attempts_sdk_token_envelope_check
    CHECK (
      (
        NOT (
          checkout_channel = 'phonepe_mobile_sdk'
          AND state = 'provider_pending'
          AND provider_dispatch_started_at IS NOT NULL
          AND provider_order_id IS NOT NULL
        )
        AND
        sdk_order_token_ciphertext IS NULL
        AND sdk_order_token_nonce IS NULL
        AND sdk_order_token_key_version IS NULL
        AND sdk_order_token_expires_at IS NULL
      )
      OR
      (
        checkout_channel = 'phonepe_mobile_sdk'
        AND state = 'provider_pending'
        AND provider_dispatch_started_at IS NOT NULL
        AND provider_order_id IS NOT NULL
        AND sdk_order_token_ciphertext IS NOT NULL
        AND octet_length(sdk_order_token_ciphertext) >= 16
        AND sdk_order_token_nonce IS NOT NULL
        AND octet_length(sdk_order_token_nonce) = 12
        AND sdk_order_token_key_version IS NOT NULL
        AND btrim(sdk_order_token_key_version) <> ''
        AND sdk_order_token_expires_at IS NOT NULL
      )
    ),
  ADD CONSTRAINT payment_attempts_mobile_pending_envelope_check
    CHECK (
      checkout_channel <> 'phonepe_mobile_sdk'
      OR state <> 'provider_pending'
      OR (
        provider_dispatch_started_at IS NOT NULL
        AND provider_order_id IS NOT NULL
        AND sdk_order_token_ciphertext IS NOT NULL
        AND sdk_order_token_nonce IS NOT NULL
        AND sdk_order_token_key_version IS NOT NULL
        AND sdk_order_token_expires_at IS NOT NULL
      )
    ),
  ADD CONSTRAINT payment_attempts_sdk_dispatch_channel_check
    CHECK (provider_dispatch_started_at IS NULL OR checkout_channel = 'phonepe_mobile_sdk');
