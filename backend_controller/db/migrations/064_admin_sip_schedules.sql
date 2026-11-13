CREATE TABLE admin_sip_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  fund_id uuid NOT NULL REFERENCES funds (id) ON DELETE RESTRICT,
  monthly_amount_paise bigint NOT NULL,
  start_month date NOT NULL,
  month_count integer NOT NULL,
  state text NOT NULL DEFAULT 'active',
  created_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  updated_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  request_id text NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz NULL,
  CONSTRAINT admin_sip_schedules_identity_uk UNIQUE (id, user_id, fund_id),
  CONSTRAINT admin_sip_schedules_amount CHECK (monthly_amount_paise > 0),
  CONSTRAINT admin_sip_schedules_start_month CHECK (
    EXTRACT(DAY FROM start_month) = 1 AND start_month BETWEEN DATE '2000-01-01' AND DATE '2199-12-01'
  ),
  CONSTRAINT admin_sip_schedules_month_count CHECK (month_count BETWEEN 1 AND 600),
  CONSTRAINT admin_sip_schedules_state CHECK (state IN ('active', 'closed')),
  CONSTRAINT admin_sip_schedules_closed_shape CHECK ((state = 'active') = (closed_at IS NULL)),
  CONSTRAINT admin_sip_schedules_version CHECK (version > 0),
  CONSTRAINT admin_sip_schedules_request_id CHECK (btrim(request_id) <> '')
);

CREATE UNIQUE INDEX admin_sip_schedules_active_uk ON admin_sip_schedules (user_id, fund_id) WHERE state = 'active';

CREATE INDEX admin_sip_schedules_fund_idx ON admin_sip_schedules (fund_id, state, user_id);

CREATE TABLE admin_sip_schedule_months (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL,
  user_id uuid NOT NULL,
  fund_id uuid NOT NULL,
  sip_month date NOT NULL,
  entry_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz NULL,
  CONSTRAINT admin_sip_schedule_months_schedule_fk FOREIGN KEY (schedule_id, user_id, fund_id)
    REFERENCES admin_sip_schedules (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT admin_sip_schedule_months_entry_fk FOREIGN KEY (entry_id, user_id, fund_id)
    REFERENCES client_value_entries (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT admin_sip_schedule_months_entry_uk UNIQUE (entry_id),
  CONSTRAINT admin_sip_schedule_months_month CHECK (EXTRACT(DAY FROM sip_month) = 1),
  CONSTRAINT admin_sip_schedule_months_request_id CHECK (btrim(request_id) <> '')
);

CREATE UNIQUE INDEX admin_sip_schedule_months_live_uk
  ON admin_sip_schedule_months (schedule_id, sip_month)
  WHERE released_at IS NULL;

CREATE FUNCTION admin_sip_schedule_months_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  schedule_start date;
  schedule_months integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT start_month, month_count INTO schedule_start, schedule_months
      FROM admin_sip_schedules WHERE id = NEW.schedule_id;
    IF NEW.sip_month < schedule_start
       OR NEW.sip_month >= (schedule_start + make_interval(months => schedule_months))::date THEN
      RAISE EXCEPTION 'sip month % is outside schedule %', NEW.sip_month, NEW.schedule_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.released_at IS NULL
     AND NEW.released_at IS NOT NULL
     AND (to_jsonb(NEW) - 'released_at') = (to_jsonb(OLD) - 'released_at')
     AND EXISTS (SELECT 1 FROM client_value_entries r WHERE r.reverses_entry_id = OLD.entry_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'admin_sip_schedule_months rows are append-only; a month is released only after its recording is reversed';
END;
$$;

CREATE TRIGGER admin_sip_schedule_months_guard
  BEFORE INSERT OR UPDATE OR DELETE ON admin_sip_schedule_months
  FOR EACH ROW EXECUTE FUNCTION admin_sip_schedule_months_guard();

CREATE FUNCTION admin_sip_schedule_months_refuse_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin_sip_schedule_months rows are append-only apart from their release';
END;
$$;

CREATE TRIGGER admin_sip_schedule_months_no_truncate
  BEFORE TRUNCATE ON admin_sip_schedule_months
  FOR EACH STATEMENT EXECUTE FUNCTION admin_sip_schedule_months_refuse_truncate();

CREATE FUNCTION admin_sip_schedules_keep_linked_months() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.start_month <> OLD.start_month THEN
    RAISE EXCEPTION 'the start month of admin SIP schedule % cannot change', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM admin_sip_schedule_months m
    WHERE m.schedule_id = NEW.id
      AND m.released_at IS NULL
      AND m.sip_month >= (NEW.start_month + make_interval(months => NEW.month_count))::date
  ) THEN
    RAISE EXCEPTION 'admin SIP schedule % has linked months beyond % months', NEW.id, NEW.month_count
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER admin_sip_schedules_keep_linked_months
  BEFORE UPDATE OF start_month, month_count ON admin_sip_schedules
  FOR EACH ROW EXECUTE FUNCTION admin_sip_schedules_keep_linked_months();
