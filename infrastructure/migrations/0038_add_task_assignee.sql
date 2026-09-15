-- A Task may be assigned to one Person of its workspace as the one
-- responsible for it. The Task functions carry assigneeId, assert that it
-- names a live Person with the service's message, and serialize it; names
-- join at read time through the People collection.
ALTER TABLE tasks ADD COLUMN assignee_person_id uuid;
ALTER TABLE tasks ADD CONSTRAINT tasks_assignee_person_fk
  FOREIGN KEY (assignee_person_id) REFERENCES persons(object_id) ON DELETE RESTRICT;
CREATE INDEX tasks_assignee_person_idx ON tasks (workspace_id, assignee_person_id)
  WHERE assignee_person_id IS NOT NULL;

-- The service's assertTaskAssignee(): null, or a live Person of the workspace.
CREATE FUNCTION chronelle_assert_task_assignee(workspace_id uuid, assignee_person_id uuid)
RETURNS void LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
BEGIN
  IF assignee_person_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM objects o
    JOIN persons p ON p.workspace_id = o.workspace_id AND p.object_id = o.id
    WHERE o.workspace_id = workspace_id AND o.id = assignee_person_id AND o.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'assigneeId must name a live person in this workspace.' USING ERRCODE = 'PT422';
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
    'completedAt', chronelle_iso(t.completed_at),
    'parentTaskId', t.parent_task_id::text,
    'assigneeId', t.assignee_person_id::text,
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
  completed_at timestamptz := chronelle_instant(input -> 'completedAt', 'completedAt');
  parent_task_id uuid := (input ->> 'parentTaskId')::uuid;
  assignee_person_id uuid := (input ->> 'assigneeId')::uuid;
  scope_id uuid;
BEGIN
  PERFORM chronelle_assert_task_state(status, due_on, due_at, completed_at);
  SELECT o.permission_scope_id INTO scope_id FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = object_id;
  PERFORM chronelle_assert_task_parent(workspace_id, object_id, parent_task_id, scope_id);
  PERFORM chronelle_assert_task_assignee(workspace_id, assignee_person_id);
  INSERT INTO tasks (object_id, workspace_id, status, due_on, due_at, completed_at, parent_task_id, assignee_person_id)
  VALUES (object_id, workspace_id, status, due_on, due_at, completed_at, parent_task_id, assignee_person_id);
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
  scope_id uuid;
BEGIN
  SELECT * INTO current_task FROM tasks t
  WHERE t.workspace_id = workspace_id AND t.object_id = object_id;
  PERFORM chronelle_assert_task_state(
    COALESCE(changes ->> 'status', current_task.status),
    CASE WHEN changes ? 'dueOn' THEN chronelle_calendar_date(changes -> 'dueOn') ELSE current_task.due_on END,
    CASE WHEN changes ? 'dueAt' THEN chronelle_instant(changes -> 'dueAt', 'dueAt') ELSE current_task.due_at END,
    CASE WHEN changes ? 'completedAt' THEN chronelle_instant(changes -> 'completedAt', 'completedAt') ELSE current_task.completed_at END
  );
  IF changes ? 'parentTaskId' AND (changes ->> 'parentTaskId')::uuid IS DISTINCT FROM current_task.parent_task_id THEN
    SELECT o.permission_scope_id INTO scope_id FROM objects o
    WHERE o.workspace_id = workspace_id AND o.id = object_id;
    PERFORM chronelle_assert_task_parent(workspace_id, object_id, (changes ->> 'parentTaskId')::uuid, scope_id);
  END IF;
  IF changes ? 'assigneeId' AND (changes ->> 'assigneeId')::uuid IS DISTINCT FROM current_task.assignee_person_id THEN
    PERFORM chronelle_assert_task_assignee(workspace_id, (changes ->> 'assigneeId')::uuid);
  END IF;
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
      completed_at = CASE WHEN changes ? 'completedAt' THEN chronelle_instant(changes -> 'completedAt', 'completedAt') ELSE t.completed_at END,
      parent_task_id = CASE WHEN changes ? 'parentTaskId' THEN (changes ->> 'parentTaskId')::uuid ELSE t.parent_task_id END,
      assignee_person_id = CASE WHEN changes ? 'assigneeId' THEN (changes ->> 'assigneeId')::uuid ELSE t.assignee_person_id END
  WHERE t.workspace_id = workspace_id AND t.object_id = object_id;
  IF changes ? 'labelIds' THEN
    PERFORM chronelle_task_set_labels(workspace_id, object_id, changes -> 'labelIds');
  END IF;
END
$$;
