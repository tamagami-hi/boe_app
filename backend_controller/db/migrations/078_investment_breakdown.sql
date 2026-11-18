CREATE TABLE client_growth_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL,
  user_id uuid NOT NULL,
  fund_id uuid NOT NULL,
  target_kind text NOT NULL,
  target_sip_schedule_id uuid NULL,
  target_allocation_id uuid NULL,
  amount_paise bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_growth_parts_entry_fk FOREIGN KEY (entry_id, user_id, fund_id)
    REFERENCES client_value_entries (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT client_growth_parts_sip_fk FOREIGN KEY (target_sip_schedule_id, user_id, fund_id)
    REFERENCES admin_sip_schedules (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT client_growth_parts_allocation_fk FOREIGN KEY (target_allocation_id, user_id, fund_id)
    REFERENCES investment_allocations (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT client_growth_parts_target CHECK (
    (target_kind = 'sip' AND target_sip_schedule_id IS NOT NULL AND target_allocation_id IS NULL)
    OR (target_kind = 'one_time' AND target_allocation_id IS NOT NULL AND target_sip_schedule_id IS NULL)
  ),
  CONSTRAINT client_growth_parts_amount CHECK (amount_paise <> 0)
);

CREATE UNIQUE INDEX client_growth_parts_sip_uk
  ON client_growth_parts (entry_id, target_sip_schedule_id) WHERE target_kind = 'sip';
CREATE UNIQUE INDEX client_growth_parts_one_time_uk
  ON client_growth_parts (entry_id, target_allocation_id) WHERE target_kind = 'one_time';
CREATE INDEX client_growth_parts_user_idx ON client_growth_parts (user_id, fund_id);

CREATE TABLE client_earlier_growth_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  fund_id uuid NOT NULL,
  cutoff_entry_id uuid NOT NULL,
  total_paise bigint NOT NULL,
  confirmed_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT client_earlier_growth_splits_identity_uk UNIQUE (id, user_id, fund_id),
  CONSTRAINT client_earlier_growth_splits_cutoff_fk FOREIGN KEY (cutoff_entry_id, user_id, fund_id)
    REFERENCES client_value_entries (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT client_earlier_growth_splits_request_id CHECK (btrim(request_id) <> '')
);

CREATE INDEX client_earlier_growth_splits_latest_idx
  ON client_earlier_growth_splits (user_id, fund_id, created_at DESC, id DESC);

CREATE TABLE client_earlier_growth_split_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  split_id uuid NOT NULL,
  user_id uuid NOT NULL,
  fund_id uuid NOT NULL,
  target_kind text NOT NULL,
  target_sip_schedule_id uuid NULL,
  target_allocation_id uuid NULL,
  amount_paise bigint NOT NULL,
  CONSTRAINT client_earlier_growth_split_parts_split_fk FOREIGN KEY (split_id, user_id, fund_id)
    REFERENCES client_earlier_growth_splits (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT client_earlier_growth_split_parts_sip_fk FOREIGN KEY (target_sip_schedule_id, user_id, fund_id)
    REFERENCES admin_sip_schedules (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT client_earlier_growth_split_parts_allocation_fk FOREIGN KEY (target_allocation_id, user_id, fund_id)
    REFERENCES investment_allocations (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT client_earlier_growth_split_parts_target CHECK (
    (target_kind = 'sip' AND target_sip_schedule_id IS NOT NULL AND target_allocation_id IS NULL)
    OR (target_kind = 'one_time' AND target_allocation_id IS NOT NULL AND target_sip_schedule_id IS NULL)
  ),
  CONSTRAINT client_earlier_growth_split_parts_amount CHECK (amount_paise <> 0)
);

CREATE UNIQUE INDEX client_earlier_growth_split_parts_sip_uk
  ON client_earlier_growth_split_parts (split_id, target_sip_schedule_id) WHERE target_kind = 'sip';
CREATE UNIQUE INDEX client_earlier_growth_split_parts_one_time_uk
  ON client_earlier_growth_split_parts (split_id, target_allocation_id) WHERE target_kind = 'one_time';

CREATE TABLE client_earlier_growth_split_entries (
  split_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  user_id uuid NOT NULL,
  fund_id uuid NOT NULL,
  CONSTRAINT client_earlier_growth_split_entries_pk PRIMARY KEY (split_id, entry_id),
  CONSTRAINT client_earlier_growth_split_entries_split_fk FOREIGN KEY (split_id, user_id, fund_id)
    REFERENCES client_earlier_growth_splits (id, user_id, fund_id) ON DELETE RESTRICT,
  CONSTRAINT client_earlier_growth_split_entries_entry_fk FOREIGN KEY (entry_id, user_id, fund_id)
    REFERENCES client_value_entries (id, user_id, fund_id) ON DELETE RESTRICT
);

CREATE FUNCTION investment_breakdown_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER client_growth_parts_append_only
  BEFORE UPDATE OR DELETE ON client_growth_parts
  FOR EACH ROW EXECUTE FUNCTION investment_breakdown_append_only();
CREATE TRIGGER client_growth_parts_no_truncate
  BEFORE TRUNCATE ON client_growth_parts
  FOR EACH STATEMENT EXECUTE FUNCTION investment_breakdown_append_only();
CREATE TRIGGER client_earlier_growth_splits_append_only
  BEFORE UPDATE OR DELETE ON client_earlier_growth_splits
  FOR EACH ROW EXECUTE FUNCTION investment_breakdown_append_only();
CREATE TRIGGER client_earlier_growth_splits_no_truncate
  BEFORE TRUNCATE ON client_earlier_growth_splits
  FOR EACH STATEMENT EXECUTE FUNCTION investment_breakdown_append_only();
CREATE TRIGGER client_earlier_growth_split_parts_append_only
  BEFORE UPDATE OR DELETE ON client_earlier_growth_split_parts
  FOR EACH ROW EXECUTE FUNCTION investment_breakdown_append_only();
CREATE TRIGGER client_earlier_growth_split_parts_no_truncate
  BEFORE TRUNCATE ON client_earlier_growth_split_parts
  FOR EACH STATEMENT EXECUTE FUNCTION investment_breakdown_append_only();
CREATE TRIGGER client_earlier_growth_split_entries_append_only
  BEFORE UPDATE OR DELETE ON client_earlier_growth_split_entries
  FOR EACH ROW EXECUTE FUNCTION investment_breakdown_append_only();
CREATE TRIGGER client_earlier_growth_split_entries_no_truncate
  BEFORE TRUNCATE ON client_earlier_growth_split_entries
  FOR EACH STATEMENT EXECUTE FUNCTION investment_breakdown_append_only();

CREATE FUNCTION client_growth_parts_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM client_value_entries e WHERE e.id = NEW.entry_id AND e.entry_type = 'growth_adjustment'
  ) THEN
    RAISE EXCEPTION 'growth parts belong to growth adjustment entries only' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER client_growth_parts_guard
  BEFORE INSERT ON client_growth_parts
  FOR EACH ROW EXECUTE FUNCTION client_growth_parts_guard();

CREATE FUNCTION client_growth_parts_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entry_delta bigint;
  parts_total numeric;
BEGIN
  SELECT value_delta_paise INTO entry_delta FROM client_value_entries WHERE id = NEW.entry_id;
  SELECT sum(amount_paise) INTO parts_total FROM client_growth_parts WHERE entry_id = NEW.entry_id;
  IF parts_total IS DISTINCT FROM entry_delta::numeric THEN
    RAISE EXCEPTION 'growth parts of entry % sum to %, not its % paise', NEW.entry_id, parts_total, entry_delta
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER client_growth_parts_balanced
  AFTER INSERT ON client_growth_parts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION client_growth_parts_balanced();

CREATE FUNCTION client_earlier_growth_split_entries_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM client_value_entries e WHERE e.id = NEW.entry_id AND e.entry_type = 'growth_adjustment'
  ) OR EXISTS (SELECT 1 FROM client_growth_parts p WHERE p.entry_id = NEW.entry_id) THEN
    RAISE EXCEPTION 'an earlier-growth split covers untargeted growth adjustment entries only'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER client_earlier_growth_split_entries_guard
  BEFORE INSERT ON client_earlier_growth_split_entries
  FOR EACH ROW EXECUTE FUNCTION client_earlier_growth_split_entries_guard();

CREATE FUNCTION client_earlier_growth_split_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_split uuid := coalesce(to_jsonb(NEW) ->> 'split_id', to_jsonb(NEW) ->> 'id')::uuid;
  split_total bigint;
  split_cutoff uuid;
  parts_total numeric;
  entries_total numeric;
BEGIN
  SELECT total_paise, cutoff_entry_id INTO split_total, split_cutoff
    FROM client_earlier_growth_splits WHERE id = target_split;
  SELECT coalesce(sum(amount_paise), 0) INTO parts_total
    FROM client_earlier_growth_split_parts WHERE split_id = target_split;
  SELECT coalesce(sum(e.value_delta_paise), 0) INTO entries_total
    FROM client_earlier_growth_split_entries s
    JOIN client_value_entries e ON e.id = s.entry_id
    WHERE s.split_id = target_split;
  IF parts_total <> split_total::numeric OR entries_total <> split_total::numeric THEN
    RAISE EXCEPTION 'earlier-growth split % does not balance: total %, parts %, covered %',
      target_split, split_total, parts_total, entries_total
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM client_earlier_growth_split_entries WHERE split_id = target_split AND entry_id = split_cutoff
  ) THEN
    RAISE EXCEPTION 'earlier-growth split % does not cover its cutoff entry', target_split
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER client_earlier_growth_splits_balanced
  AFTER INSERT ON client_earlier_growth_splits
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION client_earlier_growth_split_balanced();
CREATE CONSTRAINT TRIGGER client_earlier_growth_split_parts_balanced
  AFTER INSERT ON client_earlier_growth_split_parts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION client_earlier_growth_split_balanced();
CREATE CONSTRAINT TRIGGER client_earlier_growth_split_entries_balanced
  AFTER INSERT ON client_earlier_growth_split_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION client_earlier_growth_split_balanced();
