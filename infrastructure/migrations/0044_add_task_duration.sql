-- A Task due at an instant may say how long it takes (durationMinutes, 1 to
-- 1440); a date-only or undated task has no duration. The Task functions
-- carry it, assert the rule with the service's messages, serialize it, and
-- drop it whenever the due instant goes, so a restored revision without a
-- time cannot keep one.
ALTER TABLE tasks ADD COLUMN duration_minutes integer;
ALTER TABLE tasks ADD CONSTRAINT tasks_duration_valid
  CHECK (duration_minutes IS NULL OR (duration_minutes BETWEEN 1 AND 1440));
ALTER TABLE tasks ADD CONSTRAINT tasks_duration_needs_time
  CHECK (duration_minutes IS NULL OR due_at IS NOT NULL);

-- The service's assertTaskDuration(): null, or 1 to 1440 minutes with a due instant.
CREATE FUNCTION chronelle_assert_task_duration(due_at timestamptz, duration_minutes integer)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF duration_minutes IS NOT NULL AND (duration_minutes < 1 OR duration_minutes > 1440) THEN
    RAISE EXCEPTION 'durationMinutes is 1 to 1440 minutes.' USING ERRCODE = 'PT422';
  END IF;
  IF duration_minutes IS NOT NULL AND due_at IS NULL THEN
    RAISE EXCEPTION 'durationMinutes requires dueAt.' USING ERRCODE = 'PT422';
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
    'durationMinutes', t.duration_minutes,
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
  completed_at timestamptz := chronelle_instant(input -> 'completedAt', 'completedAt');
  parent_task_id uuid := (input ->> 'parentTaskId')::uuid;
  assignee_person_id uuid := (input ->> 'assigneeId')::uuid;
  location text := input ->> 'location';
  scope_id uuid;
BEGIN
  PERFORM chronelle_assert_task_state(status, due_on, due_at, completed_at);
  PERFORM chronelle_assert_task_duration(due_at, duration_minutes);
  PERFORM chronelle_assert_task_location(location);
  SELECT o.permission_scope_id INTO scope_id FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = object_id;
  PERFORM chronelle_assert_task_parent(workspace_id, object_id, parent_task_id, scope_id);
  PERFORM chronelle_assert_task_assignee(workspace_id, assignee_person_id);
  INSERT INTO tasks (object_id, workspace_id, status, due_on, due_at, duration_minutes, completed_at, parent_task_id, assignee_person_id, location)
  VALUES (object_id, workspace_id, status, due_on, due_at, duration_minutes, completed_at, parent_task_id, assignee_person_id, location);
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
  next_due_at timestamptz;
  scope_id uuid;
BEGIN
  SELECT * INTO current_task FROM tasks t
  WHERE t.workspace_id = workspace_id AND t.object_id = object_id;
  next_due_at := CASE WHEN changes ? 'dueAt' THEN chronelle_instant(changes -> 'dueAt', 'dueAt') ELSE current_task.due_at END;
  PERFORM chronelle_assert_task_state(
    COALESCE(changes ->> 'status', current_task.status),
    CASE WHEN changes ? 'dueOn' THEN chronelle_calendar_date(changes -> 'dueOn') ELSE current_task.due_on END,
    next_due_at,
    CASE WHEN changes ? 'completedAt' THEN chronelle_instant(changes -> 'completedAt', 'completedAt') ELSE current_task.completed_at END
  );
  PERFORM chronelle_assert_task_duration(
    next_due_at,
    CASE WHEN changes ? 'durationMinutes' THEN (changes ->> 'durationMinutes')::integer ELSE current_task.duration_minutes END
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
-- state without a due instant drops the duration rather than keeping one.
CREATE OR REPLACE FUNCTION chronelle_task_apply(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
BEGIN
  UPDATE tasks t
  SET status = COALESCE(changes ->> 'status', t.status),
      due_on = CASE WHEN changes ? 'dueOn' THEN chronelle_calendar_date(changes -> 'dueOn') ELSE t.due_on END,
      due_at = CASE WHEN changes ? 'dueAt' THEN chronelle_instant(changes -> 'dueAt', 'dueAt') ELSE t.due_at END,
      duration_minutes = CASE
        WHEN (CASE WHEN changes ? 'dueAt' THEN chronelle_instant(changes -> 'dueAt', 'dueAt') ELSE t.due_at END) IS NULL THEN NULL
        WHEN changes ? 'durationMinutes' THEN (changes ->> 'durationMinutes')::integer
        ELSE t.duration_minutes END,
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
