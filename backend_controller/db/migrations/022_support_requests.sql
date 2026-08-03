-- 022: investor support requests.
--
-- The app's support screen lets a signed-in investor raise a request and follow
-- its state. Nothing here is money state: a request is a subject, a body, a
-- category, a state and an optional resolution note written by ops.
--
-- Grievance handling is served by published content (the escalation matrix and
-- timelines under `content_items`), and Level 1 of that matrix is this table —
-- so a grievance and a support request are the same record, distinguished only by
-- the category the investor picks.

CREATE TYPE support_request_state AS ENUM ('open', 'in_progress', 'resolved', 'closed');

CREATE TABLE support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Human-quotable handle the investor can cite when following up.
  reference text NOT NULL UNIQUE,
  category text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  state support_request_state NOT NULL DEFAULT 'open',
  -- Ops resolution note, shown to the requester once the request is resolved.
  resolution_note text,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1,

  CONSTRAINT support_requests_subject_present CHECK (btrim(subject) <> ''),
  CONSTRAINT support_requests_body_present CHECK (btrim(body) <> ''),
  CONSTRAINT support_requests_category_present CHECK (btrim(category) <> ''),
  -- A resolved or closed request must say when it was resolved; an open one must not.
  CONSTRAINT support_requests_resolution_shape CHECK (
    (state IN ('resolved', 'closed') AND resolved_at IS NOT NULL)
    OR (state IN ('open', 'in_progress') AND resolved_at IS NULL)
  )
);

-- The investor's own list: newest first, scoped by owner.
CREATE INDEX support_requests_owner_idx ON support_requests (user_id, created_at DESC);

-- The ops queue: open work first, oldest first within a state.
CREATE INDEX support_requests_queue_idx ON support_requests (state, created_at);
