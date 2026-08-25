ALTER TYPE sip_state ADD VALUE IF NOT EXISTS 'setup_failed';
ALTER TYPE sip_state ADD VALUE IF NOT EXISTS 'cancel_pending';
ALTER TYPE sip_state ADD VALUE IF NOT EXISTS 'mandate_failed';
ALTER TYPE sip_state ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE sip_state ADD VALUE IF NOT EXISTS 'revoked';
