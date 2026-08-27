ALTER TABLE payment_attempts
  DROP CONSTRAINT payment_attempts_sdk_dispatch_channel_check,
  ADD CONSTRAINT payment_attempts_dispatch_channel_check
    CHECK (
      provider_dispatch_started_at IS NULL
      OR checkout_channel IN ('hosted_redirect', 'phonepe_mobile_sdk', 'phonepe_mandate_setup', 'phonepe_autopay')
    );
