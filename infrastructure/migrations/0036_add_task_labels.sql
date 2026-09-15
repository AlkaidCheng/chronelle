-- Labels are workspace-level names a Task may carry any number of. A label
-- is created, renamed, and deleted by workspace owners and editors through
-- the chronelle_label_* functions; a Task's labels are set as a whole through
-- labelIds on the Task functions and serialized in name order.
CREATE TABLE labels (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT labels_name_length CHECK (length(name) BETWEEN 1 AND 40),
  CONSTRAINT labels_name_trimmed CHECK (name = btrim(name))
);
CREATE UNIQUE INDEX labels_workspace_name_idx ON labels (workspace_id, lower(name));

CREATE TABLE task_labels (
  workspace_id uuid NOT NULL,
  task_id uuid NOT NULL REFERENCES tasks(object_id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);
CREATE INDEX task_labels_label_idx ON task_labels (workspace_id, label_id);

-- The label row as the API serializes it.
CREATE FUNCTION chronelle_label_serialize(label labels)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'id', label.id::text,
    'workspaceId', label.workspace_id::text,
    'name', label.name,
    'version', label.version,
    'createdAt', chronelle_iso(label.created_at),
    'updatedAt', chronelle_iso(label.updated_at)
  );
$$;

-- The service's assertLabelName(), with the same messages.
CREATE FUNCTION chronelle_assert_label_name(workspace_id uuid, label_id uuid, name text)
RETURNS void LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
BEGIN
  IF name IS NULL OR name <> btrim(name) OR length(name) < 1 OR length(name) > 40 THEN
    RAISE EXCEPTION 'A label name is 1 to 40 characters without surrounding spaces.' USING ERRCODE = 'PT422';
  END IF;
  IF EXISTS (
    SELECT 1 FROM labels l
    WHERE l.workspace_id = workspace_id AND lower(l.name) = lower(name)
      AND (label_id IS NULL OR l.id <> label_id)
  ) THEN
    RAISE EXCEPTION 'A label with this name already exists.' USING ERRCODE = 'PT409';
  END IF;
END
$$;

CREATE FUNCTION chronelle_label_create(workspace_id uuid, user_id uuid, name text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  created labels%ROWTYPE;
BEGIN
  IF NOT chronelle_can_create(workspace_id, user_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  PERFORM chronelle_assert_label_name(workspace_id, NULL, name);
  INSERT INTO labels (id, workspace_id, name, created_by)
  VALUES (chronelle_uuidv7(), workspace_id, name, user_id)
  RETURNING * INTO created;
  RETURN chronelle_label_serialize(created);
END
$$;

CREATE FUNCTION chronelle_label_update(workspace_id uuid, user_id uuid, label_id uuid, expected_version integer, name text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  current_label labels%ROWTYPE;
BEGIN
  IF NOT chronelle_can_create(workspace_id, user_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT * INTO current_label FROM labels l
  WHERE l.workspace_id = workspace_id AND l.id = label_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT404';
  END IF;
  IF current_label.version <> expected_version THEN
    RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
  END IF;
  PERFORM chronelle_assert_label_name(workspace_id, label_id, name);
  UPDATE labels l SET name = name, version = l.version + 1, updated_at = now()
  WHERE l.id = label_id
  RETURNING * INTO current_label;
  RETURN chronelle_label_serialize(current_label);
END
$$;

CREATE FUNCTION chronelle_label_delete(workspace_id uuid, user_id uuid, label_id uuid, expected_version integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  current_label labels%ROWTYPE;
BEGIN
  IF NOT chronelle_can_create(workspace_id, user_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT * INTO current_label FROM labels l
  WHERE l.workspace_id = workspace_id AND l.id = label_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT404';
  END IF;
  IF current_label.version <> expected_version THEN
    RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
  END IF;
  DELETE FROM labels l WHERE l.id = label_id;
  RETURN chronelle_label_serialize(current_label);
END
$$;

-- A Task's labels in name order, as the API serializes them.
CREATE FUNCTION chronelle_task_label_ids(workspace_id uuid, task_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(l.id::text ORDER BY lower(l.name), l.id), '[]'::jsonb)
  FROM task_labels tl
  JOIN labels l ON l.id = tl.label_id
  WHERE tl.workspace_id = $1 AND tl.task_id = $2;
$$;

-- Replaces a Task's labels with the given set; every id must be a label of
-- the workspace, with the service's message.
CREATE FUNCTION chronelle_task_set_labels(workspace_id uuid, task_id uuid, label_ids jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  ids uuid[];
BEGIN
  IF label_ids IS NULL OR jsonb_typeof(label_ids) <> 'array' THEN
    RAISE EXCEPTION 'labelIds must be a list of label IDs.' USING ERRCODE = 'PT422';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT (value #>> '{}')::uuid), '{}') INTO ids
  FROM jsonb_array_elements(label_ids) AS value;
  IF EXISTS (
    SELECT 1 FROM unnest(ids) AS wanted(id)
    WHERE NOT EXISTS (SELECT 1 FROM labels l WHERE l.workspace_id = workspace_id AND l.id = wanted.id)
  ) THEN
    RAISE EXCEPTION 'labelIds must name labels of this workspace.' USING ERRCODE = 'PT422';
  END IF;
  DELETE FROM task_labels tl WHERE tl.workspace_id = workspace_id AND tl.task_id = task_id;
  INSERT INTO task_labels (workspace_id, task_id, label_id)
  SELECT workspace_id, task_id, wanted.id FROM unnest(ids) AS wanted(id);
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
    'labelIds', chronelle_task_label_ids($1, $2)
  )
  FROM tasks t
  WHERE t.workspace_id = $1 AND t.object_id = $2;
$$;

CREATE OR REPLACE FUNCTION chronelle_task_rows(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'object', to_jsonb(o),
    'task', to_jsonb(t),
    'labels', chronelle_task_label_ids($1, $2)
  )
  FROM objects o
  JOIN tasks t ON t.workspace_id = o.workspace_id AND t.object_id = o.id
  WHERE o.workspace_id = $1 AND o.id = $2;
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
  IF changes ? 'labelIds' THEN
    PERFORM chronelle_task_set_labels(workspace_id, object_id, changes -> 'labelIds');
  END IF;
END
$$;
