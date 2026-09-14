-- Task create and update as database functions, and the shared canonical
-- core every single-object family uses: authorization, the objects row,
-- the version predicate, the audit event, and the revision snapshot are
-- implemented once in chronelle_object_create and chronelle_object_update,
-- which dispatch the typed steps by object type. The Event entry points of
-- migration 0012 keep their signatures and behavior but now run on the core.
--
-- A family provides four functions, resolved by name at call time:
--   chronelle_<type>_insert(workspace_id, object_id, input)      typed row from CreateInput
--   chronelle_<type>_validate(workspace_id, object_id, changes)  merged-state rules
--   chronelle_<type>_apply(workspace_id, object_id, changes)     typed row update
--   chronelle_<type>_serialize(workspace_id, object_id)          revision snapshot
--   chronelle_<type>_rows(workspace_id, object_id)               rows for the adapter

-- ---------------------------------------------------------------------------
-- Shared core
-- ---------------------------------------------------------------------------

CREATE FUNCTION chronelle_object_create(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_type text,
  input jsonb
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  object_id uuid := chronelle_uuidv7();
  audit_id uuid := chronelle_uuidv7();
  written_at timestamptz := now();
  scope_id uuid := COALESCE((input ->> 'permissionScopeId')::uuid, object_id);
  snapshot jsonb;
  rows jsonb;
BEGIN
  IF object_type NOT IN ('event', 'task', 'expense', 'reminder') THEN
    RAISE EXCEPTION 'Unsupported object type %.', object_type USING ERRCODE = 'PT422';
  END IF;
  IF input ? 'permissionScopeId' THEN
    IF NOT chronelle_can_edit(workspace_id, user_id, scope_id) THEN
      RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
    END IF;
  ELSIF NOT chronelle_can_create(workspace_id, user_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  INSERT INTO objects (id, workspace_id, object_type, display_name, created_by, permission_scope_id,
                       custom_properties, metadata, created_at, updated_at, version)
  VALUES (object_id, workspace_id, object_type, input ->> 'displayName', user_id, scope_id,
          COALESCE(input -> 'customProperties', '{}'::jsonb), COALESCE(input -> 'metadata', '{}'::jsonb),
          written_at, written_at, 1);
  EXECUTE format('SELECT chronelle_%I_insert($1, $2, $3)', object_type) USING workspace_id, object_id, input;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
  VALUES (audit_id, workspace_id, 'user', user_id, object_type || '.created', object_id, request_id,
          jsonb_build_object('permissionScopeId', scope_id::text, 'version', 1), written_at);
  EXECUTE format('SELECT chronelle_%I_serialize($1, $2)', object_type) INTO snapshot USING workspace_id, object_id;
  INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
  VALUES (chronelle_uuidv7(), workspace_id, object_id, 1, 'created', NULL,
          'user', user_id, request_id, audit_id, 1, snapshot, written_at);
  EXECUTE format('SELECT chronelle_%I_rows($1, $2)', object_type) INTO rows USING workspace_id, object_id;
  RETURN rows;
END
$$;

CREATE FUNCTION chronelle_object_update(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_type text,
  object_id uuid,
  expected_version integer,
  changes jsonb,
  command jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  current_object objects%ROWTYPE;
  next_version integer;
  audit_id uuid := chronelle_uuidv7();
  written_at timestamptz := now();
  audit_metadata jsonb;
  snapshot jsonb;
  rows jsonb;
BEGIN
  IF object_type NOT IN ('event', 'task', 'expense', 'reminder') THEN
    RAISE EXCEPTION 'Unsupported object type %.', object_type USING ERRCODE = 'PT422';
  END IF;
  IF NOT chronelle_can_edit(workspace_id, user_id, object_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT * INTO current_object FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = object_id AND o.object_type = object_type
  FOR UPDATE;
  IF NOT FOUND OR current_object.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  EXECUTE format('SELECT chronelle_%I_validate($1, $2, $3)', object_type) USING workspace_id, object_id, changes;
  IF current_object.version <> expected_version THEN
    RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
  END IF;
  next_version := expected_version + 1;
  UPDATE objects o
  SET display_name = COALESCE(changes ->> 'displayName', o.display_name),
      custom_properties = COALESCE(changes -> 'customProperties', o.custom_properties),
      metadata = COALESCE(changes -> 'metadata', o.metadata),
      updated_at = written_at,
      version = next_version
  WHERE o.workspace_id = workspace_id AND o.id = object_id AND o.version = expected_version;
  EXECUTE format('SELECT chronelle_%I_apply($1, $2, $3)', object_type) USING workspace_id, object_id, changes;
  IF NOT EXISTS (
    SELECT 1 FROM object_revisions r
    WHERE r.workspace_id = workspace_id AND r.object_id = object_id AND r.object_version = expected_version
  ) THEN
    RAISE EXCEPTION 'Object revision baseline is missing; run db:baseline-revisions before serving writes.'
      USING ERRCODE = 'PT500';
  END IF;
  audit_metadata := jsonb_build_object('previousVersion', expected_version, 'version', next_version);
  IF command IS NOT NULL THEN
    audit_metadata := audit_metadata || jsonb_build_object('command', command);
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
  VALUES (audit_id, workspace_id, 'user', user_id, object_type || '.updated', object_id, request_id, audit_metadata, written_at);
  EXECUTE format('SELECT chronelle_%I_serialize($1, $2)', object_type) INTO snapshot USING workspace_id, object_id;
  INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
  VALUES (chronelle_uuidv7(), workspace_id, object_id, next_version, 'updated', NULL,
          'user', user_id, request_id, audit_id, 1, snapshot, written_at);
  EXECUTE format('SELECT chronelle_%I_rows($1, $2)', object_type) INTO rows USING workspace_id, object_id;
  RETURN rows;
END
$$;

-- The canonical columns every family's snapshot starts from.
CREATE FUNCTION chronelle_serialize_object(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id', o.id::text,
    'workspaceId', o.workspace_id::text,
    'objectType', o.object_type,
    'displayName', o.display_name,
    'createdBy', o.created_by::text,
    'permissionScopeId', o.permission_scope_id::text,
    'createdAt', chronelle_iso(o.created_at),
    'updatedAt', chronelle_iso(o.updated_at),
    'version', o.version,
    'archivedAt', chronelle_iso(o.archived_at),
    'deletedAt', chronelle_iso(o.deleted_at),
    'customProperties', o.custom_properties,
    'metadata', o.metadata
  )
  FROM objects o
  WHERE o.workspace_id = $1 AND o.id = $2;
$$;

-- ---------------------------------------------------------------------------
-- Event family on the core (signatures and behavior of migration 0012 kept)
-- ---------------------------------------------------------------------------

CREATE FUNCTION chronelle_event_insert(workspace_id uuid, object_id uuid, input jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  starts_at timestamptz := chronelle_instant(input -> 'startsAt', 'startsAt');
  ends_at timestamptz := chronelle_instant(input -> 'endsAt', 'endsAt');
  starts_on date := chronelle_calendar_date(input -> 'startsOn');
  ends_on date := chronelle_calendar_date(input -> 'endsOn');
  timezone text := input ->> 'timezone';
BEGIN
  PERFORM chronelle_assert_event_state(starts_at, ends_at, timezone, starts_on, ends_on);
  INSERT INTO events (object_id, workspace_id, starts_at, ends_at, starts_on, ends_on, timezone, is_all_day)
  VALUES (object_id, workspace_id, starts_at, ends_at, starts_on, ends_on, timezone,
          COALESCE((input ->> 'isAllDay')::boolean, false));
END
$$;

CREATE FUNCTION chronelle_event_validate(workspace_id uuid, object_id uuid, changes jsonb)
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
END
$$;

CREATE FUNCTION chronelle_event_apply(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
BEGIN
  UPDATE events e
  SET starts_at = CASE WHEN changes ? 'startsAt' THEN chronelle_instant(changes -> 'startsAt', 'startsAt') ELSE e.starts_at END,
      ends_at = CASE WHEN changes ? 'endsAt' THEN chronelle_instant(changes -> 'endsAt', 'endsAt') ELSE e.ends_at END,
      starts_on = CASE WHEN changes ? 'startsOn' THEN chronelle_calendar_date(changes -> 'startsOn') ELSE e.starts_on END,
      ends_on = CASE WHEN changes ? 'endsOn' THEN chronelle_calendar_date(changes -> 'endsOn') ELSE e.ends_on END,
      timezone = CASE WHEN changes ? 'timezone' THEN changes ->> 'timezone' ELSE e.timezone END,
      is_all_day = CASE WHEN changes ? 'isAllDay' THEN (changes ->> 'isAllDay')::boolean ELSE e.is_all_day END
  WHERE e.workspace_id = workspace_id AND e.object_id = object_id;
END
$$;

-- Family-named alias of the migration 0012 serializer, for the core's dispatch.
CREATE FUNCTION chronelle_event_serialize(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT chronelle_serialize_event($1, $2);
$$;

CREATE OR REPLACE FUNCTION chronelle_event_create(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  input jsonb
)
RETURNS jsonb LANGUAGE sql VOLATILE AS $$
  SELECT chronelle_object_create($1, $2, $3, 'event', $4);
$$;

CREATE OR REPLACE FUNCTION chronelle_event_update(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_id uuid,
  expected_version integer,
  changes jsonb,
  command jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql VOLATILE AS $$
  SELECT chronelle_object_update($1, $2, $3, 'event', $4, $5, $6, $7);
$$;

-- ---------------------------------------------------------------------------
-- Task family
-- ---------------------------------------------------------------------------

-- The service's assertTaskState(), in the same order with the same messages.
CREATE FUNCTION chronelle_assert_task_state(status text, due_at timestamptz, completed_at timestamptz)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF status IS NULL OR status NOT IN ('todo', 'in_progress', 'done', 'cancelled') THEN
    RAISE EXCEPTION 'status must be todo, in_progress, done, or cancelled.' USING ERRCODE = 'PT422';
  END IF;
  IF (status = 'done') <> (completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'completedAt must be set exactly when status is done.' USING ERRCODE = 'PT422';
  END IF;
END
$$;

CREATE FUNCTION chronelle_task_serialize(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT chronelle_serialize_object($1, $2) || jsonb_build_object(
    'objectType', 'task',
    'status', t.status,
    'dueAt', chronelle_iso(t.due_at),
    'completedAt', chronelle_iso(t.completed_at)
  )
  FROM tasks t
  WHERE t.workspace_id = $1 AND t.object_id = $2;
$$;

CREATE FUNCTION chronelle_task_rows(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('object', to_jsonb(o), 'task', to_jsonb(t))
  FROM objects o
  JOIN tasks t ON t.workspace_id = o.workspace_id AND t.object_id = o.id
  WHERE o.workspace_id = $1 AND o.id = $2;
$$;

CREATE FUNCTION chronelle_task_insert(workspace_id uuid, object_id uuid, input jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  status text := COALESCE(input ->> 'status', 'todo');
  due_at timestamptz := chronelle_instant(input -> 'dueAt', 'dueAt');
  completed_at timestamptz := chronelle_instant(input -> 'completedAt', 'completedAt');
BEGIN
  PERFORM chronelle_assert_task_state(status, due_at, completed_at);
  INSERT INTO tasks (object_id, workspace_id, status, due_at, completed_at)
  VALUES (object_id, workspace_id, status, due_at, completed_at);
END
$$;

CREATE FUNCTION chronelle_task_validate(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  current_task tasks%ROWTYPE;
BEGIN
  SELECT * INTO current_task FROM tasks t
  WHERE t.workspace_id = workspace_id AND t.object_id = object_id;
  PERFORM chronelle_assert_task_state(
    COALESCE(changes ->> 'status', current_task.status),
    CASE WHEN changes ? 'dueAt' THEN chronelle_instant(changes -> 'dueAt', 'dueAt') ELSE current_task.due_at END,
    CASE WHEN changes ? 'completedAt' THEN chronelle_instant(changes -> 'completedAt', 'completedAt') ELSE current_task.completed_at END
  );
END
$$;

CREATE FUNCTION chronelle_task_apply(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
BEGIN
  UPDATE tasks t
  SET status = COALESCE(changes ->> 'status', t.status),
      due_at = CASE WHEN changes ? 'dueAt' THEN chronelle_instant(changes -> 'dueAt', 'dueAt') ELSE t.due_at END,
      completed_at = CASE WHEN changes ? 'completedAt' THEN chronelle_instant(changes -> 'completedAt', 'completedAt') ELSE t.completed_at END
  WHERE t.workspace_id = workspace_id AND t.object_id = object_id;
END
$$;

CREATE FUNCTION chronelle_task_create(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  input jsonb
)
RETURNS jsonb LANGUAGE sql VOLATILE AS $$
  SELECT chronelle_object_create($1, $2, $3, 'task', $4);
$$;

CREATE FUNCTION chronelle_task_update(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_id uuid,
  expected_version integer,
  changes jsonb,
  command jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql VOLATILE AS $$
  SELECT chronelle_object_update($1, $2, $3, 'task', $4, $5, $6, $7);
$$;
