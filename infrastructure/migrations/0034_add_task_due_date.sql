-- A Task is due on a date, at an instant, or not at all. due_on holds a
-- calendar date with no time of day; due_at keeps the timed form. At most
-- one is set. The Task functions read and write both fields and serialize
-- dueOn beside dueAt; the assertion gains the date so both backends refuse
-- the same states with the same messages.
ALTER TABLE tasks ADD COLUMN due_on date;
ALTER TABLE tasks ADD CONSTRAINT tasks_due_single_form
  CHECK (due_on IS NULL OR due_at IS NULL);

DROP FUNCTION chronelle_assert_task_state(text, timestamptz, timestamptz);

CREATE FUNCTION chronelle_assert_task_state(status text, due_on date, due_at timestamptz, completed_at timestamptz)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF status IS NULL OR status NOT IN ('todo', 'in_progress', 'done', 'cancelled') THEN
    RAISE EXCEPTION 'status must be todo, in_progress, done, or cancelled.' USING ERRCODE = 'PT422';
  END IF;
  IF due_on IS NOT NULL AND due_at IS NOT NULL THEN
    RAISE EXCEPTION 'dueOn and dueAt cannot both be set.' USING ERRCODE = 'PT422';
  END IF;
  IF (status = 'done') <> (completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'completedAt must be set exactly when status is done.' USING ERRCODE = 'PT422';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION chronelle_task_serialize(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT chronelle_serialize_object($1, $2) || jsonb_build_object(
    'objectType', 'task',
    'status', t.status,
    'dueOn', t.due_on::text,
    'dueAt', chronelle_iso(t.due_at),
    'completedAt', chronelle_iso(t.completed_at)
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
  completed_at timestamptz := chronelle_instant(input -> 'completedAt', 'completedAt');
BEGIN
  PERFORM chronelle_assert_task_state(status, due_on, due_at, completed_at);
  INSERT INTO tasks (object_id, workspace_id, status, due_on, due_at, completed_at)
  VALUES (object_id, workspace_id, status, due_on, due_at, completed_at);
END
$$;

CREATE OR REPLACE FUNCTION chronelle_task_validate(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  current_task tasks%ROWTYPE;
BEGIN
  SELECT * INTO current_task FROM tasks t
  WHERE t.workspace_id = workspace_id AND t.object_id = object_id;
  PERFORM chronelle_assert_task_state(
    COALESCE(changes ->> 'status', current_task.status),
    CASE WHEN changes ? 'dueOn' THEN chronelle_calendar_date(changes -> 'dueOn') ELSE current_task.due_on END,
    CASE WHEN changes ? 'dueAt' THEN chronelle_instant(changes -> 'dueAt', 'dueAt') ELSE current_task.due_at END,
    CASE WHEN changes ? 'completedAt' THEN chronelle_instant(changes -> 'completedAt', 'completedAt') ELSE current_task.completed_at END
  );
END
$$;

CREATE OR REPLACE FUNCTION chronelle_task_apply(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
BEGIN
  UPDATE tasks t
  SET status = COALESCE(changes ->> 'status', t.status),
      due_on = CASE WHEN changes ? 'dueOn' THEN chronelle_calendar_date(changes -> 'dueOn') ELSE t.due_on END,
      due_at = CASE WHEN changes ? 'dueAt' THEN chronelle_instant(changes -> 'dueAt', 'dueAt') ELSE t.due_at END,
      completed_at = CASE WHEN changes ? 'completedAt' THEN chronelle_instant(changes -> 'completedAt', 'completedAt') ELSE t.completed_at END
  WHERE t.workspace_id = workspace_id AND t.object_id = object_id;
END
$$;

CREATE OR REPLACE FUNCTION chronelle_command_content(object_type text, snapshot jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE object_type
    WHEN 'event' THEN jsonb_build_object(
      'displayName', snapshot -> 'displayName',
      'customProperties', snapshot -> 'customProperties',
      'startsOn', snapshot -> 'startsOn',
      'endsOn', snapshot -> 'endsOn',
      'startsAt', snapshot -> 'startsAt',
      'endsAt', snapshot -> 'endsAt',
      'timezone', snapshot -> 'timezone',
      'isAllDay', snapshot -> 'isAllDay')
    WHEN 'task' THEN jsonb_build_object(
      'displayName', snapshot -> 'displayName',
      'customProperties', snapshot -> 'customProperties',
      'status', snapshot -> 'status',
      'dueOn', snapshot -> 'dueOn',
      'dueAt', snapshot -> 'dueAt',
      'completedAt', snapshot -> 'completedAt')
  END;
$$;
