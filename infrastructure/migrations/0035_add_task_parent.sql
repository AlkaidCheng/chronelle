-- A Task may be a subtask of one other Task, one level deep: a parent has no
-- parent of its own, a task with subtasks cannot become one, and a subtask
-- shares its parent's permission scope. The Task functions carry
-- parentTaskId and assert these rules with the service's messages.
ALTER TABLE tasks ADD COLUMN parent_task_id uuid;
ALTER TABLE tasks ADD CONSTRAINT tasks_parent_task_fk
  FOREIGN KEY (parent_task_id) REFERENCES tasks(object_id) ON DELETE RESTRICT;
ALTER TABLE tasks ADD CONSTRAINT tasks_parent_not_self
  CHECK (parent_task_id IS NULL OR parent_task_id <> object_id);
CREATE INDEX tasks_parent_task_idx ON tasks (workspace_id, parent_task_id)
  WHERE parent_task_id IS NOT NULL;

-- The service's assertTaskParent(), in the same order with the same messages.
CREATE FUNCTION chronelle_assert_task_parent(workspace_id uuid, object_id uuid, parent_task_id uuid, scope_id uuid)
RETURNS void LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  parent_scope uuid;
  parent_parent uuid;
BEGIN
  IF parent_task_id IS NULL THEN
    RETURN;
  END IF;
  IF parent_task_id = object_id THEN
    RAISE EXCEPTION 'A task cannot be its own parent.' USING ERRCODE = 'PT422';
  END IF;
  SELECT o.permission_scope_id, t.parent_task_id INTO parent_scope, parent_parent
  FROM objects o
  JOIN tasks t ON t.workspace_id = o.workspace_id AND t.object_id = o.id
  WHERE o.workspace_id = workspace_id AND o.id = parent_task_id AND o.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'parentTaskId must name a live task in this workspace.' USING ERRCODE = 'PT422';
  END IF;
  IF parent_parent IS NOT NULL THEN
    RAISE EXCEPTION 'A subtask cannot have subtasks of its own.' USING ERRCODE = 'PT422';
  END IF;
  IF EXISTS (SELECT 1 FROM tasks t WHERE t.workspace_id = workspace_id AND t.parent_task_id = object_id) THEN
    RAISE EXCEPTION 'A task with subtasks cannot become a subtask.' USING ERRCODE = 'PT422';
  END IF;
  IF parent_scope <> scope_id THEN
    RAISE EXCEPTION 'A subtask shares its parent''s permission scope.' USING ERRCODE = 'PT422';
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
    'parentTaskId', t.parent_task_id::text
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
  scope_id uuid;
BEGIN
  PERFORM chronelle_assert_task_state(status, due_on, due_at, completed_at);
  SELECT o.permission_scope_id INTO scope_id FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = object_id;
  PERFORM chronelle_assert_task_parent(workspace_id, object_id, parent_task_id, scope_id);
  INSERT INTO tasks (object_id, workspace_id, status, due_on, due_at, completed_at, parent_task_id)
  VALUES (object_id, workspace_id, status, due_on, due_at, completed_at, parent_task_id);
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
      parent_task_id = CASE WHEN changes ? 'parentTaskId' THEN (changes ->> 'parentTaskId')::uuid ELSE t.parent_task_id END
  WHERE t.workspace_id = workspace_id AND t.object_id = object_id;
END
$$;
