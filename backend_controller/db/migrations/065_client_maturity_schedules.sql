CREATE TABLE client_maturity_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  fund_id uuid NOT NULL REFERENCES funds (id) ON DELETE RESTRICT,
  maturity_date date NOT NULL,
  state text NOT NULL DEFAULT 'scheduled',
  resolution text NULL,
  maturity_id uuid NULL,
  follow_up_sip_schedule_id uuid NULL,
  created_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  updated_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  request_id text NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  CONSTRAINT client_maturity_schedules_identity_uk UNIQUE (id, user_id, fund_id),
  CONSTRAINT client_maturity_schedules_maturity_fk FOREIGN KEY (maturity_id, user_id, fund_id)
    REFERENCES client_position_maturities (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT client_maturity_schedules_sip_schedule_fk FOREIGN KEY (follow_up_sip_schedule_id, user_id, fund_id)
    REFERENCES admin_sip_schedules (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT client_maturity_schedules_date CHECK (maturity_date BETWEEN DATE '2000-01-01' AND DATE '2199-12-31'),
  CONSTRAINT client_maturity_schedules_state CHECK (state IN ('scheduled', 'resolved', 'cancelled')),
  CONSTRAINT client_maturity_schedules_resolution CHECK (
    resolution IS NULL OR resolution IN ('return_all', 'one_time_and_sip', 'sip_reinvestment')
  ),
  CONSTRAINT client_maturity_schedules_shape CHECK (
    (state = 'scheduled' AND resolution IS NULL AND resolved_at IS NULL AND cancelled_at IS NULL
      AND maturity_id IS NULL AND follow_up_sip_schedule_id IS NULL)
    OR (state = 'resolved' AND resolution IS NOT NULL AND resolved_at IS NOT NULL AND cancelled_at IS NULL)
    OR (state = 'cancelled' AND resolution IS NULL AND cancelled_at IS NOT NULL AND resolved_at IS NULL
      AND maturity_id IS NULL AND follow_up_sip_schedule_id IS NULL)
  ),
  CONSTRAINT client_maturity_schedules_resolution_links CHECK (
    resolution IS NULL
    OR (resolution = 'return_all' AND maturity_id IS NOT NULL AND follow_up_sip_schedule_id IS NULL)
    OR (resolution = 'one_time_and_sip' AND follow_up_sip_schedule_id IS NOT NULL)
    OR (resolution = 'sip_reinvestment' AND maturity_id IS NULL AND follow_up_sip_schedule_id IS NOT NULL)
  ),
  CONSTRAINT client_maturity_schedules_version CHECK (version > 0),
  CONSTRAINT client_maturity_schedules_request_id CHECK (btrim(request_id) <> '')
);

CREATE UNIQUE INDEX client_maturity_schedules_open_uk
  ON client_maturity_schedules (user_id, fund_id)
  WHERE state = 'scheduled';

CREATE UNIQUE INDEX client_maturity_schedules_maturity_uk
  ON client_maturity_schedules (maturity_id)
  WHERE maturity_id IS NOT NULL;

CREATE INDEX client_maturity_schedules_dashboard_idx
  ON client_maturity_schedules (state, maturity_date, id);

CREATE INDEX client_maturity_schedules_user_idx
  ON client_maturity_schedules (user_id, maturity_date);

CREATE FUNCTION client_maturity_schedules_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.state = 'scheduled' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'client_maturity_schedules rows are never deleted and a resolved or cancelled row never changes';
END;
$$;

CREATE TRIGGER client_maturity_schedules_guard
  BEFORE UPDATE OR DELETE ON client_maturity_schedules
  FOR EACH ROW EXECUTE FUNCTION client_maturity_schedules_guard();

CREATE FUNCTION client_maturity_schedules_refuse_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'client_maturity_schedules rows are never deleted';
END;
$$;

CREATE TRIGGER client_maturity_schedules_no_truncate
  BEFORE TRUNCATE ON client_maturity_schedules
  FOR EACH STATEMENT EXECUTE FUNCTION client_maturity_schedules_refuse_truncate();
