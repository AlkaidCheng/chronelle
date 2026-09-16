-- Tasks and Reminders take a place in manual order: `rank`, eleven digits
-- with an optional fraction and no trailing zero, so text order is numeric
-- order and a database sorts it with a plain comparison. A new record goes
-- last (a thousand past the workspace's highest integer part) unless the
-- caller sends a rank; a record dropped between two others takes their
-- midpoint, which the client computes, and no other record moves. Existing
-- records are numbered by creation order. The rank is content the service
-- validates and serializes but never restores from history.
ALTER TABLE tasks ADD COLUMN rank text;
ALTER TABLE reminders ADD COLUMN rank text;

WITH numbered AS (
  SELECT t.object_id, row_number() OVER (PARTITION BY t.workspace_id ORDER BY o.created_at, o.id) AS n
  FROM tasks t JOIN objects o ON o.workspace_id = t.workspace_id AND o.id = t.object_id
)
UPDATE tasks t SET rank = lpad((numbered.n * 1000)::text, 11, '0')
FROM numbered WHERE numbered.object_id = t.object_id;

WITH numbered AS (
  SELECT r.object_id, row_number() OVER (PARTITION BY r.workspace_id ORDER BY o.created_at, o.id) AS n
  FROM reminders r JOIN objects o ON o.workspace_id = r.workspace_id AND o.id = r.object_id
)
UPDATE reminders r SET rank = lpad((numbered.n * 1000)::text, 11, '0')
FROM numbered WHERE numbered.object_id = r.object_id;

-- The column default only serves rows written outside the write functions
-- and the service, which always compute the next rank; such rows tie.
ALTER TABLE tasks ALTER COLUMN rank SET NOT NULL, ALTER COLUMN rank SET DEFAULT '00000001000';
ALTER TABLE reminders ALTER COLUMN rank SET NOT NULL, ALTER COLUMN rank SET DEFAULT '00000001000';
ALTER TABLE tasks ADD CONSTRAINT tasks_rank_valid CHECK (rank ~ '^[0-9]{11}(\.[0-9]*[1-9])?$');
ALTER TABLE reminders ADD CONSTRAINT reminders_rank_valid CHECK (rank ~ '^[0-9]{11}(\.[0-9]*[1-9])?$');

-- The service's assertRank(): the shape above.
CREATE FUNCTION chronelle_assert_rank(rank text)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF rank IS NULL OR rank !~ '^[0-9]{11}(\.[0-9]*[1-9])?$' THEN
    RAISE EXCEPTION 'rank is a position in manual order.' USING ERRCODE = 'PT422';
  END IF;
END
$$;

-- The rank after the workspace's last: rankAfter() in the shared package.
CREATE FUNCTION chronelle_next_task_rank(workspace_id uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT lpad((COALESCE(MAX(split_part(t.rank, '.', 1)::bigint), 0) + 1000)::text, 11, '0')
  FROM tasks t WHERE t.workspace_id = $1;
$$;

CREATE FUNCTION chronelle_next_reminder_rank(workspace_id uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT lpad((COALESCE(MAX(split_part(r.rank, '.', 1)::bigint), 0) + 1000)::text, 11, '0')
  FROM reminders r WHERE r.workspace_id = $1;
$$;

CREATE OR REPLACE FUNCTION chronelle_task_serialize(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT chronelle_serialize_object($1, $2) || jsonb_build_object(
    'objectType', 'task',
    'status', t.status,
    'dueOn', t.due_on::text,
    'dueAt', chronelle_iso(t.due_at),
    'durationMinutes', t.duration_minutes,
    'repeatRule', t.repeat_rule,
    'repeatUntil', t.repeat_until::text,
    'completedAt', chronelle_iso(t.completed_at),
    'parentTaskId', t.parent_task_id::text,
    'assigneeId', t.assignee_person_id::text,
    'location', t.location,
    'rank', t.rank,
    'labelIds', chronelle_task_label_ids($1, $2)
  )
  FROM tasks t
  WHERE t.workspace_id = $1 AND t.object_id = $2;
$$;

CREATE OR REPLACE FUNCTION chronelle_task_insert(workspace_id uuid, object_id uuid, input jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  status text := COALESCE(input ->> 'status', 'todo');
  due_on date := chronelle_calendar_date(input -> 'dueOn');
  due_at timestamptz := chronelle_instant(input -> 'dueAt', 'dueAt');
  duration_minutes integer := (input ->> 'durationMinutes')::integer;
  repeat_rule text := input ->> 'repeatRule';
  repeat_until date := chronelle_calendar_date(input -> 'repeatUntil');
  completed_at timestamptz := chronelle_instant(input -> 'completedAt', 'completedAt');
  parent_task_id uuid := (input ->> 'parentTaskId')::uuid;
  assignee_person_id uuid := (input ->> 'assigneeId')::uuid;
  location text := input ->> 'location';
  rank text := COALESCE(input ->> 'rank', chronelle_next_task_rank(workspace_id));
  scope_id uuid;
BEGIN
  PERFORM chronelle_assert_task_state(status, due_on, due_at, completed_at);
  PERFORM chronelle_assert_task_duration(due_at, duration_minutes);
  PERFORM chronelle_assert_task_repeat(due_on, due_at, repeat_rule, repeat_until);
  PERFORM chronelle_assert_task_location(location);
  PERFORM chronelle_assert_rank(rank);
  SELECT o.permission_scope_id INTO scope_id FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = object_id;
  PERFORM chronelle_assert_task_parent(workspace_id, object_id, parent_task_id, scope_id);
  PERFORM chronelle_assert_task_assignee(workspace_id, assignee_person_id);
  INSERT INTO tasks (object_id, workspace_id, status, due_on, due_at, duration_minutes, repeat_rule, repeat_until, completed_at, parent_task_id, assignee_person_id, location, rank)
  VALUES (object_id, workspace_id, status, due_on, due_at, duration_minutes, repeat_rule, repeat_until, completed_at, parent_task_id, assignee_person_id, location, rank);
  IF input ? 'labelIds' THEN
    PERFORM chronelle_task_set_labels(workspace_id, object_id, input -> 'labelIds');
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION chronelle_task_validate(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  current_task tasks%ROWTYPE;
  next_due_on date;
  next_due_at timestamptz;
  scope_id uuid;
BEGIN
  SELECT * INTO current_task FROM tasks t
  WHERE t.workspace_id = workspace_id AND t.object_id = object_id;
  next_due_on := CASE WHEN changes ? 'dueOn' THEN chronelle_calendar_date(changes -> 'dueOn') ELSE current_task.due_on END;
  next_due_at := CASE WHEN changes ? 'dueAt' THEN chronelle_instant(changes -> 'dueAt', 'dueAt') ELSE current_task.due_at END;
  PERFORM chronelle_assert_task_state(
    COALESCE(changes ->> 'status', current_task.status),
    next_due_on,
    next_due_at,
    CASE WHEN changes ? 'completedAt' THEN chronelle_instant(changes -> 'completedAt', 'completedAt') ELSE current_task.completed_at END
  );
  PERFORM chronelle_assert_task_duration(
    next_due_at,
    CASE WHEN changes ? 'durationMinutes' THEN (changes ->> 'durationMinutes')::integer ELSE current_task.duration_minutes END
  );
  -- Clearing the rule clears its end, as apply does.
  PERFORM chronelle_assert_task_repeat(
    next_due_on,
    next_due_at,
    CASE WHEN changes ? 'repeatRule' THEN changes ->> 'repeatRule' ELSE current_task.repeat_rule END,
    CASE
      WHEN changes ? 'repeatRule' AND changes ->> 'repeatRule' IS NULL THEN NULL
      WHEN changes ? 'repeatUntil' THEN chronelle_calendar_date(changes -> 'repeatUntil')
      ELSE current_task.repeat_until END
  );
  IF changes ? 'rank' THEN
    PERFORM chronelle_assert_rank(changes ->> 'rank');
  END IF;
  IF changes ? 'parentTaskId' AND (changes ->> 'parentTaskId')::uuid IS DISTINCT FROM current_task.parent_task_id THEN
    SELECT o.permission_scope_id INTO scope_id FROM objects o
    WHERE o.workspace_id = workspace_id AND o.id = object_id;
    PERFORM chronelle_assert_task_parent(workspace_id, object_id, (changes ->> 'parentTaskId')::uuid, scope_id);
  END IF;
  IF changes ? 'assigneeId' AND (changes ->> 'assigneeId')::uuid IS DISTINCT FROM current_task.assignee_person_id THEN
    PERFORM chronelle_assert_task_assignee(workspace_id, (changes ->> 'assigneeId')::uuid);
  END IF;
  IF changes ? 'location' THEN
    PERFORM chronelle_assert_task_location(changes ->> 'location');
  END IF;
END
$$;

-- Apply also serves a revision restore, which never carries a rank.
CREATE OR REPLACE FUNCTION chronelle_task_apply(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  next_due_on date;
  next_due_at timestamptz;
BEGIN
  SELECT
    CASE WHEN changes ? 'dueOn' THEN chronelle_calendar_date(changes -> 'dueOn') ELSE t.due_on END,
    CASE WHEN changes ? 'dueAt' THEN chronelle_instant(changes -> 'dueAt', 'dueAt') ELSE t.due_at END
  INTO next_due_on, next_due_at
  FROM tasks t WHERE t.workspace_id = workspace_id AND t.object_id = object_id;
  UPDATE tasks t
  SET status = COALESCE(changes ->> 'status', t.status),
      due_on = next_due_on,
      due_at = next_due_at,
      duration_minutes = CASE
        WHEN next_due_at IS NULL THEN NULL
        WHEN changes ? 'durationMinutes' THEN (changes ->> 'durationMinutes')::integer
        ELSE t.duration_minutes END,
      repeat_rule = CASE
        WHEN next_due_on IS NULL AND next_due_at IS NULL THEN NULL
        WHEN changes ? 'repeatRule' THEN changes ->> 'repeatRule'
        ELSE t.repeat_rule END,
      repeat_until = CASE
        WHEN next_due_on IS NULL AND next_due_at IS NULL THEN NULL
        WHEN changes ? 'repeatRule' AND changes ->> 'repeatRule' IS NULL THEN NULL
        WHEN changes ? 'repeatUntil' THEN chronelle_calendar_date(changes -> 'repeatUntil')
        ELSE t.repeat_until END,
      completed_at = CASE WHEN changes ? 'completedAt' THEN chronelle_instant(changes -> 'completedAt', 'completedAt') ELSE t.completed_at END,
      parent_task_id = CASE WHEN changes ? 'parentTaskId' THEN (changes ->> 'parentTaskId')::uuid ELSE t.parent_task_id END,
      assignee_person_id = CASE WHEN changes ? 'assigneeId' THEN (changes ->> 'assigneeId')::uuid ELSE t.assignee_person_id END,
      location = CASE WHEN changes ? 'location' THEN changes ->> 'location' ELSE t.location END,
      rank = CASE WHEN changes ? 'rank' THEN changes ->> 'rank' ELSE t.rank END
  WHERE t.workspace_id = workspace_id AND t.object_id = object_id;
  IF changes ? 'labelIds' THEN
    PERFORM chronelle_task_set_labels(workspace_id, object_id, changes -> 'labelIds');
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION chronelle_reminder_serialize(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT chronelle_serialize_object($1, $2) || jsonb_build_object(
    'objectType', 'reminder',
    'remindAt', chronelle_iso(r.remind_at),
    'status', r.status,
    'rank', r.rank
  )
  FROM reminders r
  WHERE r.workspace_id = $1 AND r.object_id = $2;
$$;

CREATE OR REPLACE FUNCTION chronelle_reminder_insert(workspace_id uuid, object_id uuid, input jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  remind_at timestamptz := chronelle_instant(input -> 'remindAt', 'remindAt');
  status text := COALESCE(input ->> 'status', 'pending');
  rank text := COALESCE(input ->> 'rank', chronelle_next_reminder_rank(workspace_id));
BEGIN
  PERFORM chronelle_assert_reminder_state(remind_at, status);
  PERFORM chronelle_assert_rank(rank);
  INSERT INTO reminders (object_id, workspace_id, remind_at, status, rank)
  VALUES (object_id, workspace_id, remind_at, status, rank);
END
$$;

CREATE OR REPLACE FUNCTION chronelle_reminder_validate(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  current_reminder reminders%ROWTYPE;
BEGIN
  SELECT * INTO current_reminder FROM reminders r
  WHERE r.workspace_id = workspace_id AND r.object_id = object_id;
  PERFORM chronelle_assert_reminder_state(
    COALESCE(chronelle_instant(changes -> 'remindAt', 'remindAt'), current_reminder.remind_at),
    COALESCE(changes ->> 'status', current_reminder.status)
  );
  IF changes ? 'rank' THEN
    PERFORM chronelle_assert_rank(changes ->> 'rank');
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION chronelle_reminder_apply(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
BEGIN
  UPDATE reminders r
  SET remind_at = COALESCE(chronelle_instant(changes -> 'remindAt', 'remindAt'), r.remind_at),
      status = COALESCE(changes ->> 'status', r.status),
      rank = CASE WHEN changes ? 'rank' THEN changes ->> 'rank' ELSE r.rank END
  WHERE r.workspace_id = workspace_id AND r.object_id = object_id;
END
$$;
