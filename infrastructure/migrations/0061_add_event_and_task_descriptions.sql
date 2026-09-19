-- An Event and a Task carry a description: plain text of 1 to 2,000 trimmed
-- characters, null when there is none, the rule a Person's description
-- follows. The Event and Task functions carry it, assert its shape with the
-- service's message, and serialize it; it is restorable content, so the
-- content commands carry it with the rest.
ALTER TABLE events ADD COLUMN description text;
ALTER TABLE events ADD CONSTRAINT events_description_valid
  CHECK (description IS NULL OR (description = btrim(description) AND length(description) BETWEEN 1 AND 2000));
ALTER TABLE tasks ADD COLUMN description text;
ALTER TABLE tasks ADD CONSTRAINT tasks_description_valid
  CHECK (description IS NULL OR (description = btrim(description) AND length(description) BETWEEN 1 AND 2000));

-- The service's assertDescription(): null, or 1 to 2,000 trimmed characters.
CREATE FUNCTION chronelle_assert_description(description text)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF description IS NOT NULL AND (description <> btrim(description) OR length(description) < 1 OR length(description) > 2000) THEN
    RAISE EXCEPTION 'description is 1 to 2000 characters without surrounding spaces.' USING ERRCODE = 'PT422';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION chronelle_serialize_event(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id', o.id::text,
    'workspaceId', o.workspace_id::text,
    'objectType', 'event',
    'displayName', o.display_name,
    'createdBy', o.created_by::text,
    'permissionScopeId', o.permission_scope_id::text,
    'createdAt', chronelle_iso(o.created_at),
    'updatedAt', chronelle_iso(o.updated_at),
    'version', o.version,
    'archivedAt', chronelle_iso(o.archived_at),
    'deletedAt', chronelle_iso(o.deleted_at),
    'customProperties', o.custom_properties,
    'metadata', o.metadata,
    'startsAt', chronelle_iso(e.starts_at),
    'startsOn', e.starts_on::text,
    'endsOn', e.ends_on::text,
    'endsAt', chronelle_iso(e.ends_at),
    'timezone', e.timezone,
    'isAllDay', e.is_all_day,
    'location', e.location,
    'description', e.description
  )
  FROM objects o
  JOIN events e ON e.workspace_id = o.workspace_id AND e.object_id = o.id
  WHERE o.workspace_id = $1 AND o.id = $2;
$$;

CREATE OR REPLACE FUNCTION chronelle_event_insert(workspace_id uuid, object_id uuid, input jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  starts_at timestamptz := chronelle_instant(input -> 'startsAt', 'startsAt');
  ends_at timestamptz := chronelle_instant(input -> 'endsAt', 'endsAt');
  starts_on date := chronelle_calendar_date(input -> 'startsOn');
  ends_on date := chronelle_calendar_date(input -> 'endsOn');
  timezone text := input ->> 'timezone';
  location text := input ->> 'location';
  description text := input ->> 'description';
BEGIN
  PERFORM chronelle_assert_event_state(starts_at, ends_at, timezone, starts_on, ends_on);
  PERFORM chronelle_assert_event_location(location);
  PERFORM chronelle_assert_description(description);
  INSERT INTO events (object_id, workspace_id, starts_at, ends_at, starts_on, ends_on, timezone, is_all_day, location, description)
  VALUES (object_id, workspace_id, starts_at, ends_at, starts_on, ends_on, timezone,
          COALESCE((input ->> 'isAllDay')::boolean, false), location, description);
END
$$;

CREATE OR REPLACE FUNCTION chronelle_event_validate(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  current_event events%ROWTYPE;
BEGIN
  SELECT * INTO current_event FROM events e
  WHERE e.workspace_id = workspace_id AND e.object_id = object_id;
  PERFORM chronelle_assert_event_state(
    CASE WHEN changes ? 'startsAt' THEN chronelle_instant(changes -> 'startsAt', 'startsAt') ELSE current_event.starts_at END,
    CASE WHEN changes ? 'endsAt' THEN chronelle_instant(changes -> 'endsAt', 'endsAt') ELSE current_event.ends_at END,
    CASE WHEN changes ? 'timezone' THEN changes ->> 'timezone' ELSE current_event.timezone END,
    CASE WHEN changes ? 'startsOn' THEN chronelle_calendar_date(changes -> 'startsOn') ELSE current_event.starts_on END,
    CASE WHEN changes ? 'endsOn' THEN chronelle_calendar_date(changes -> 'endsOn') ELSE current_event.ends_on END
  );
  IF changes ? 'location' THEN
    PERFORM chronelle_assert_event_location(changes ->> 'location');
  END IF;
  IF changes ? 'description' THEN
    PERFORM chronelle_assert_description(changes ->> 'description');
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION chronelle_event_apply(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
BEGIN
  UPDATE events e
  SET starts_at = CASE WHEN changes ? 'startsAt' THEN chronelle_instant(changes -> 'startsAt', 'startsAt') ELSE e.starts_at END,
      ends_at = CASE WHEN changes ? 'endsAt' THEN chronelle_instant(changes -> 'endsAt', 'endsAt') ELSE e.ends_at END,
      starts_on = CASE WHEN changes ? 'startsOn' THEN chronelle_calendar_date(changes -> 'startsOn') ELSE e.starts_on END,
      ends_on = CASE WHEN changes ? 'endsOn' THEN chronelle_calendar_date(changes -> 'endsOn') ELSE e.ends_on END,
      timezone = CASE WHEN changes ? 'timezone' THEN changes ->> 'timezone' ELSE e.timezone END,
      is_all_day = CASE WHEN changes ? 'isAllDay' THEN (changes ->> 'isAllDay')::boolean ELSE e.is_all_day END,
      location = CASE WHEN changes ? 'location' THEN changes ->> 'location' ELSE e.location END,
      description = CASE WHEN changes ? 'description' THEN changes ->> 'description' ELSE e.description END
  WHERE e.workspace_id = workspace_id AND e.object_id = object_id;
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
    'repeatRule', t.repeat_rule,
    'repeatUntil', t.repeat_until::text,
    'completedAt', chronelle_iso(t.completed_at),
    'parentTaskId', t.parent_task_id::text,
    'assigneeId', t.assignee_person_id::text,
    'location', t.location,
    'description', t.description,
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
  description text := input ->> 'description';
  rank text := COALESCE(input ->> 'rank', chronelle_next_task_rank(workspace_id));
  scope_id uuid;
BEGIN
  PERFORM chronelle_assert_task_state(status, due_on, due_at, completed_at);
  PERFORM chronelle_assert_task_duration(due_at, duration_minutes);
  PERFORM chronelle_assert_task_repeat(due_on, due_at, repeat_rule, repeat_until);
  PERFORM chronelle_assert_task_location(location);
  PERFORM chronelle_assert_description(description);
  PERFORM chronelle_assert_rank(rank);
  SELECT o.permission_scope_id INTO scope_id FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = object_id;
  PERFORM chronelle_assert_task_parent(workspace_id, object_id, parent_task_id, scope_id);
  PERFORM chronelle_assert_task_assignee(workspace_id, assignee_person_id);
  INSERT INTO tasks (object_id, workspace_id, status, due_on, due_at, duration_minutes, repeat_rule, repeat_until, completed_at, parent_task_id, assignee_person_id, location, description, rank)
  VALUES (object_id, workspace_id, status, due_on, due_at, duration_minutes, repeat_rule, repeat_until, completed_at, parent_task_id, assignee_person_id, location, description, rank);
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
  IF changes ? 'description' THEN
    PERFORM chronelle_assert_description(changes ->> 'description');
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
      description = CASE WHEN changes ? 'description' THEN changes ->> 'description' ELSE t.description END,
      rank = CASE WHEN changes ? 'rank' THEN changes ->> 'rank' ELSE t.rank END
  WHERE t.workspace_id = workspace_id AND t.object_id = object_id;
  IF changes ? 'labelIds' THEN
    PERFORM chronelle_task_set_labels(workspace_id, object_id, changes -> 'labelIds');
  END IF;
END
$$;

-- The content a reversible command carries includes the description.
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
      'isAllDay', snapshot -> 'isAllDay',
      'location', snapshot -> 'location',
      'description', snapshot -> 'description')
    WHEN 'task' THEN jsonb_build_object(
      'displayName', snapshot -> 'displayName',
      'customProperties', snapshot -> 'customProperties',
      'status', snapshot -> 'status',
      'dueOn', snapshot -> 'dueOn',
      'dueAt', snapshot -> 'dueAt',
      'completedAt', snapshot -> 'completedAt',
      'description', snapshot -> 'description')
  END;
$$;
