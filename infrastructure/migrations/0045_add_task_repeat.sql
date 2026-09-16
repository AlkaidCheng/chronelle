-- A Task may repeat: a rule (daily, weekdays, weekly, biweekly, monthly,
-- yearly) with an optional last date, repeating from its due. Completing a
-- repeating task through the ordinary update moves its due to the next
-- occurrence and keeps it open; only the last occurrence marks it done.
-- The Task functions carry the rule, assert it with the service's messages,
-- serialize it, and drop it whenever the due goes.
ALTER TABLE tasks ADD COLUMN repeat_rule text;
ALTER TABLE tasks ADD COLUMN repeat_until date;
ALTER TABLE tasks ADD CONSTRAINT tasks_repeat_rule_valid
  CHECK (repeat_rule IS NULL OR repeat_rule IN ('daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'yearly'));
ALTER TABLE tasks ADD CONSTRAINT tasks_repeat_needs_due
  CHECK (repeat_rule IS NULL OR due_on IS NOT NULL OR due_at IS NOT NULL);
ALTER TABLE tasks ADD CONSTRAINT tasks_repeat_until_needs_rule
  CHECK (repeat_until IS NULL OR repeat_rule IS NOT NULL);

-- The calendar date a due falls on: the date itself, or the instant's UTC date.
CREATE FUNCTION chronelle_task_due_date(due_on date, due_at timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(due_on, (due_at AT TIME ZONE 'UTC')::date);
$$;

-- The service's assertTaskRepeat(): a known rule, only with a due; an end
-- only with a rule, on or after the due date.
CREATE FUNCTION chronelle_assert_task_repeat(due_on date, due_at timestamptz, repeat_rule text, repeat_until date)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF repeat_rule IS NOT NULL AND repeat_rule NOT IN ('daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'yearly') THEN
    RAISE EXCEPTION 'repeatRule must be daily, weekdays, weekly, biweekly, monthly, or yearly.' USING ERRCODE = 'PT422';
  END IF;
  IF repeat_rule IS NOT NULL AND due_on IS NULL AND due_at IS NULL THEN
    RAISE EXCEPTION 'repeatRule requires dueOn or dueAt.' USING ERRCODE = 'PT422';
  END IF;
  IF repeat_until IS NOT NULL AND repeat_rule IS NULL THEN
    RAISE EXCEPTION 'repeatUntil requires repeatRule.' USING ERRCODE = 'PT422';
  END IF;
  IF repeat_until IS NOT NULL AND repeat_until < chronelle_task_due_date(due_on, due_at) THEN
    RAISE EXCEPTION 'repeatUntil must be on or after the due date.' USING ERRCODE = 'PT422';
  END IF;
END
$$;

-- The next occurrence after a due date: a day, the next weekday, a week,
-- two weeks, a month, or a year on, the last two clamped to the month's
-- last day (PostgreSQL date arithmetic clamps).
CREATE FUNCTION chronelle_task_next_due_date(due date, repeat_rule text)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  next_due date;
BEGIN
  CASE repeat_rule
    WHEN 'daily' THEN next_due := due + 1;
    WHEN 'weekdays' THEN
      next_due := due + 1;
      WHILE extract(isodow FROM next_due) >= 6 LOOP
        next_due := next_due + 1;
      END LOOP;
    WHEN 'weekly' THEN next_due := due + 7;
    WHEN 'biweekly' THEN next_due := due + 14;
    WHEN 'monthly' THEN next_due := (due + interval '1 month')::date;
    WHEN 'yearly' THEN next_due := (due + interval '1 year')::date;
    ELSE RAISE EXCEPTION 'repeatRule must be daily, weekdays, weekly, biweekly, monthly, or yearly.' USING ERRCODE = 'PT422';
  END CASE;
  RETURN next_due;
END
$$;

-- An instant advances by its UTC date, keeping its UTC time of day.
CREATE FUNCTION chronelle_task_next_due_at(due timestamptz, repeat_rule text)
RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT (
    chronelle_task_next_due_date((due AT TIME ZONE 'UTC')::date, repeat_rule)
    + (due AT TIME ZONE 'UTC')::time
  ) AT TIME ZONE 'UTC';
$$;

-- Completing a repeating task: an update that sets status to done on a task
-- that is not done, and carries no due or repeat change of its own, becomes
-- an update that keeps the task open on its next occurrence, unless that
-- occurrence would fall after repeatUntil. Any other change passes through.
CREATE FUNCTION chronelle_task_repeat_changes(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  current_task tasks%ROWTYPE;
  next_due_on date;
  next_due_at timestamptz;
BEGIN
  IF changes ->> 'status' IS DISTINCT FROM 'done'
     OR changes ? 'dueOn' OR changes ? 'dueAt' OR changes ? 'repeatRule' OR changes ? 'repeatUntil' THEN
    RETURN changes;
  END IF;
  SELECT * INTO current_task FROM tasks t
  WHERE t.workspace_id = workspace_id AND t.object_id = object_id;
  IF NOT FOUND OR current_task.status = 'done' OR current_task.repeat_rule IS NULL THEN
    RETURN changes;
  END IF;
  IF current_task.due_on IS NOT NULL THEN
    next_due_on := chronelle_task_next_due_date(current_task.due_on, current_task.repeat_rule);
    IF current_task.repeat_until IS NOT NULL AND next_due_on > current_task.repeat_until THEN
      RETURN changes;
    END IF;
    RETURN (changes - 'status' - 'completedAt')
      || jsonb_build_object('status', 'todo', 'completedAt', NULL, 'dueOn', next_due_on::text);
  END IF;
  next_due_at := chronelle_task_next_due_at(current_task.due_at, current_task.repeat_rule);
  IF current_task.repeat_until IS NOT NULL AND (next_due_at AT TIME ZONE 'UTC')::date > current_task.repeat_until THEN
    RETURN changes;
  END IF;
  RETURN (changes - 'status' - 'completedAt')
    || jsonb_build_object('status', 'todo', 'completedAt', NULL, 'dueAt', chronelle_iso(next_due_at));
END
$$;

CREATE OR REPLACE FUNCTION chronelle_task_update(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_id uuid,
  expected_version integer,
  changes jsonb,
  command jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql VOLATILE AS $$
  SELECT chronelle_object_update($1, $2, $3, 'task', $4, $5, chronelle_task_repeat_changes($1, $4, $6), $7);
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
  scope_id uuid;
BEGIN
  PERFORM chronelle_assert_task_state(status, due_on, due_at, completed_at);
  PERFORM chronelle_assert_task_duration(due_at, duration_minutes);
  PERFORM chronelle_assert_task_repeat(due_on, due_at, repeat_rule, repeat_until);
  PERFORM chronelle_assert_task_location(location);
  SELECT o.permission_scope_id INTO scope_id FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = object_id;
  PERFORM chronelle_assert_task_parent(workspace_id, object_id, parent_task_id, scope_id);
  PERFORM chronelle_assert_task_assignee(workspace_id, assignee_person_id);
  INSERT INTO tasks (object_id, workspace_id, status, due_on, due_at, duration_minutes, repeat_rule, repeat_until, completed_at, parent_task_id, assignee_person_id, location)
  VALUES (object_id, workspace_id, status, due_on, due_at, duration_minutes, repeat_rule, repeat_until, completed_at, parent_task_id, assignee_person_id, location);
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

-- Apply also serves a revision restore, which never validates: a restored
-- state without a due drops the rule and its end, as one without a due
-- instant drops the duration.
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
      location = CASE WHEN changes ? 'location' THEN changes ->> 'location' ELSE t.location END
  WHERE t.workspace_id = workspace_id AND t.object_id = object_id;
  IF changes ? 'labelIds' THEN
    PERFORM chronelle_task_set_labels(workspace_id, object_id, changes -> 'labelIds');
  END IF;
END
$$;
