-- R3 probe: single-object Event mutations as PostgreSQL functions, callable
-- through the CloudBase gateway's /rpc route. Each function is one
-- transaction; a raised exception rolls back every row it wrote.
--
-- Applied to staging through the console SQL editor and to disposable test
-- databases by the differential test. Not a migration: the functions carry
-- the probe_ prefix and may be dropped without affecting the schema.
--
-- Error SQLSTATEs use the PTxxx form PostgREST maps to HTTP statuses.

CREATE OR REPLACE FUNCTION chronelle_probe_uuidv7()
RETURNS uuid LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  unix_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  random_bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  bytes bytea;
BEGIN
  bytes := decode(lpad(to_hex(unix_ms), 12, '0'), 'hex') || substring(random_bytes FROM 1 FOR 10);
  bytes := set_byte(bytes, 6, (get_byte(bytes, 6) & 15) | 112);
  bytes := set_byte(bytes, 8, (get_byte(bytes, 8) & 63) | 128);
  RETURN encode(bytes, 'hex')::uuid;
END
$$;

-- Matches Date.prototype.toISOString(): millisecond precision, UTC, trailing Z.
CREATE OR REPLACE FUNCTION chronelle_probe_iso(value timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN value IS NULL THEN NULL
    ELSE to_char(date_trunc('milliseconds', value) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  END;
$$;

-- The same key set and encoding as serializeResource() for an Event.
CREATE OR REPLACE FUNCTION chronelle_probe_serialize_event(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id', o.id::text,
    'workspaceId', o.workspace_id::text,
    'objectType', 'event',
    'displayName', o.display_name,
    'createdBy', o.created_by::text,
    'permissionScopeId', o.permission_scope_id::text,
    'createdAt', chronelle_probe_iso(o.created_at),
    'updatedAt', chronelle_probe_iso(o.updated_at),
    'version', o.version,
    'archivedAt', chronelle_probe_iso(o.archived_at),
    'deletedAt', chronelle_probe_iso(o.deleted_at),
    'customProperties', o.custom_properties,
    'metadata', o.metadata,
    'startsAt', chronelle_probe_iso(e.starts_at),
    'startsOn', e.starts_on::text,
    'endsOn', e.ends_on::text,
    'endsAt', chronelle_probe_iso(e.ends_at),
    'timezone', e.timezone,
    'isAllDay', e.is_all_day
  )
  FROM objects o
  JOIN events e ON e.workspace_id = o.workspace_id AND e.object_id = o.id
  WHERE o.workspace_id = $1 AND o.id = $2;
$$;

-- Workspace owners and editors may create; viewers may not.
CREATE OR REPLACE FUNCTION chronelle_probe_can_create(workspace_id uuid, user_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members m
    WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.role IN ('owner', 'editor')
  );
$$;

-- Edit through membership, or through an active owner/editor grant on the
-- object or its canonical permission scope.
CREATE OR REPLACE FUNCTION chronelle_probe_can_edit(workspace_id uuid, user_id uuid, object_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members m
    WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.role IN ('owner', 'editor')
  ) OR EXISTS (
    SELECT 1
    FROM resource_grants g
    JOIN objects o ON o.workspace_id = g.workspace_id AND o.id = $3
    WHERE g.workspace_id = $1
      AND g.principal_type = 'user'
      AND g.principal_id = $2
      AND g.role IN ('owner', 'editor')
      AND (g.expires_at IS NULL OR g.expires_at > now())
      AND g.resource_id IN (o.id, o.permission_scope_id)
  );
$$;

CREATE OR REPLACE FUNCTION chronelle_probe_create_event(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  display_name text,
  timezone text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  object_id uuid := chronelle_probe_uuidv7();
  audit_id uuid := chronelle_probe_uuidv7();
  written_at timestamptz := now();
  snapshot jsonb;
BEGIN
  IF NOT chronelle_probe_can_create(workspace_id, user_id) THEN
    RAISE EXCEPTION 'The principal may not create in this workspace.' USING ERRCODE = 'PT403';
  END IF;
  INSERT INTO objects (id, workspace_id, object_type, display_name, created_by, permission_scope_id, created_at, updated_at, version)
  VALUES (object_id, workspace_id, 'event', display_name, user_id, object_id, written_at, written_at, 1);
  INSERT INTO events (object_id, workspace_id, timezone)
  VALUES (object_id, workspace_id, timezone);
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
  VALUES (audit_id, workspace_id, 'user', user_id, 'event.created', object_id, request_id,
          jsonb_build_object('permissionScopeId', object_id::text, 'version', 1), written_at);
  snapshot := chronelle_probe_serialize_event(workspace_id, object_id);
  INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
  VALUES (chronelle_probe_uuidv7(), workspace_id, object_id, 1, 'created', NULL,
          'user', user_id, request_id, audit_id, 1, snapshot, written_at);
  RETURN snapshot;
END
$$;

CREATE OR REPLACE FUNCTION chronelle_probe_update_event(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_id uuid,
  expected_version integer,
  display_name text,
  fail_after boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  current_version integer;
  next_version integer;
  audit_id uuid := chronelle_probe_uuidv7();
  written_at timestamptz := now();
  snapshot jsonb;
BEGIN
  SELECT o.version INTO current_version
  FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = object_id
    AND o.object_type = 'event' AND o.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The event does not exist.' USING ERRCODE = 'PT404';
  END IF;
  IF NOT chronelle_probe_can_edit(workspace_id, user_id, object_id) THEN
    RAISE EXCEPTION 'The principal may not edit this event.' USING ERRCODE = 'PT403';
  END IF;
  IF current_version <> expected_version THEN
    RAISE EXCEPTION 'The event changed since it was read (version %).', current_version USING ERRCODE = 'PT409';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM object_revisions r
    WHERE r.workspace_id = workspace_id AND r.object_id = object_id AND r.object_version = expected_version
  ) THEN
    RAISE EXCEPTION 'Object revision baseline is missing.' USING ERRCODE = 'PT500';
  END IF;
  next_version := expected_version + 1;
  UPDATE objects o
  SET display_name = display_name, version = next_version, updated_at = written_at
  WHERE o.workspace_id = workspace_id AND o.id = object_id AND o.version = expected_version;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
  VALUES (audit_id, workspace_id, 'user', user_id, 'event.updated', object_id, request_id,
          jsonb_build_object('previousVersion', expected_version, 'version', next_version), written_at);
  snapshot := chronelle_probe_serialize_event(workspace_id, object_id);
  INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
  VALUES (chronelle_probe_uuidv7(), workspace_id, object_id, next_version, 'updated', NULL,
          'user', user_id, request_id, audit_id, 1, snapshot, written_at);
  IF fail_after THEN
    RAISE EXCEPTION 'Injected failure after every write.' USING ERRCODE = 'PT500';
  END IF;
  RETURN snapshot;
END
$$;
