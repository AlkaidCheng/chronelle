-- Event create and update as database functions. Each call is one
-- transaction, so a deployment that reaches PostgreSQL only through the
-- CloudBase gateway's rpc route gets the same authorization, version,
-- audit, and revision guarantees as the application service. A TCP
-- deployment carries these functions unused.
--
-- Errors raise PTxxx SQLSTATEs, which the gateway maps to HTTP statuses:
--   PT403 unavailable (missing or not permitted), PT409 version conflict,
--   PT422 invalid state, PT500 missing revision baseline.

CREATE FUNCTION chronelle_uuidv7()
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
CREATE FUNCTION chronelle_iso(value timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN value IS NULL THEN NULL
    ELSE to_char(date_trunc('milliseconds', value) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  END;
$$;

-- The revision snapshot: the same keys and encoding as serializeResource().
CREATE FUNCTION chronelle_serialize_event(workspace_id uuid, object_id uuid)
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
    'isAllDay', e.is_all_day
  )
  FROM objects o
  JOIN events e ON e.workspace_id = o.workspace_id AND e.object_id = o.id
  WHERE o.workspace_id = $1 AND o.id = $2;
$$;

-- The rows the application decodes into an EventResource.
CREATE FUNCTION chronelle_event_rows(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('object', to_jsonb(o), 'event', to_jsonb(e))
  FROM objects o
  JOIN events e ON e.workspace_id = o.workspace_id AND e.object_id = o.id
  WHERE o.workspace_id = $1 AND o.id = $2;
$$;

-- Workspace owners and editors may create; viewers may not.
CREATE FUNCTION chronelle_can_create(workspace_id uuid, user_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members m
    WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.role IN ('owner', 'editor')
  );
$$;

-- Edit through membership, or through an active owner/editor grant on the
-- object or its canonical permission scope. A missing object yields false.
CREATE FUNCTION chronelle_can_edit(workspace_id uuid, user_id uuid, object_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM objects o WHERE o.workspace_id = $1 AND o.id = $3)
  AND (
    EXISTS (
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
    )
  );
$$;

-- The service's assertEventState(), in the same order with the same messages.
CREATE FUNCTION chronelle_assert_event_state(
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  starts_on date,
  ends_on date
)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF ends_on IS NOT NULL AND (starts_on IS NULL OR ends_on < starts_on) THEN
    RAISE EXCEPTION 'Calendar dates must be valid and ordered.' USING ERRCODE = 'PT422';
  END IF;
  IF starts_on IS NOT NULL AND (starts_at IS NOT NULL OR ends_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Use calendar dates or timestamps, not both.' USING ERRCODE = 'PT422';
  END IF;
  IF ends_at IS NOT NULL AND starts_at IS NULL THEN
    RAISE EXCEPTION 'endsAt requires startsAt.' USING ERRCODE = 'PT422';
  END IF;
  IF starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at < starts_at THEN
    RAISE EXCEPTION 'endsAt must not precede startsAt.' USING ERRCODE = 'PT422';
  END IF;
  IF timezone IS NOT NULL THEN
    BEGIN
      IF btrim(timezone) = '' OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = timezone) THEN
        RAISE EXCEPTION USING ERRCODE = 'PT422';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'timezone must be a valid IANA time zone.' USING ERRCODE = 'PT422';
    END;
  END IF;
END
$$;

-- A calendar date from JSON input: exactly YYYY-MM-DD, or the service's message.
CREATE FUNCTION chronelle_calendar_date(value jsonb)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF value IS NULL OR jsonb_typeof(value) = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(value) <> 'string' OR (value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'Calendar dates must be valid and ordered.' USING ERRCODE = 'PT422';
  END IF;
  RETURN (value #>> '{}')::date;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Calendar dates must be valid and ordered.' USING ERRCODE = 'PT422';
END
$$;

-- An instant from JSON input, or the service's message for the named field.
CREATE FUNCTION chronelle_instant(value jsonb, field_name text)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF value IS NULL OR jsonb_typeof(value) = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(value) <> 'string' THEN
    RAISE EXCEPTION '% must be a valid date.', field_name USING ERRCODE = 'PT422';
  END IF;
  RETURN (value #>> '{}')::timestamptz;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION '% must be a valid date.', field_name USING ERRCODE = 'PT422';
END
$$;

-- Creates an Event. `input` carries the CreateEventInput fields by name:
-- displayName, customProperties, metadata, permissionScopeId, startsAt,
-- endsAt, startsOn, endsOn, timezone, isAllDay.
CREATE FUNCTION chronelle_event_create(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  input jsonb
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  object_id uuid := chronelle_uuidv7();
  audit_id uuid := chronelle_uuidv7();
  written_at timestamptz := now();
  scope_id uuid := COALESCE((input ->> 'permissionScopeId')::uuid, object_id);
  starts_at timestamptz := chronelle_instant(input -> 'startsAt', 'startsAt');
  ends_at timestamptz := chronelle_instant(input -> 'endsAt', 'endsAt');
  starts_on date := chronelle_calendar_date(input -> 'startsOn');
  ends_on date := chronelle_calendar_date(input -> 'endsOn');
  timezone text := input ->> 'timezone';
  is_all_day boolean := COALESCE((input ->> 'isAllDay')::boolean, false);
BEGIN
  PERFORM chronelle_assert_event_state(starts_at, ends_at, timezone, starts_on, ends_on);
  IF input ? 'permissionScopeId' THEN
    IF NOT chronelle_can_edit(workspace_id, user_id, scope_id) THEN
      RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
    END IF;
  ELSIF NOT chronelle_can_create(workspace_id, user_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  INSERT INTO objects (id, workspace_id, object_type, display_name, created_by, permission_scope_id,
                       custom_properties, metadata, created_at, updated_at, version)
  VALUES (object_id, workspace_id, 'event', input ->> 'displayName', user_id, scope_id,
          COALESCE(input -> 'customProperties', '{}'::jsonb), COALESCE(input -> 'metadata', '{}'::jsonb),
          written_at, written_at, 1);
  INSERT INTO events (object_id, workspace_id, starts_at, ends_at, starts_on, ends_on, timezone, is_all_day)
  VALUES (object_id, workspace_id, starts_at, ends_at, starts_on, ends_on, timezone, is_all_day);
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
  VALUES (audit_id, workspace_id, 'user', user_id, 'event.created', object_id, request_id,
          jsonb_build_object('permissionScopeId', scope_id::text, 'version', 1), written_at);
  INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
  VALUES (chronelle_uuidv7(), workspace_id, object_id, 1, 'created', NULL,
          'user', user_id, request_id, audit_id, 1, chronelle_serialize_event(workspace_id, object_id), written_at);
  RETURN chronelle_event_rows(workspace_id, object_id);
END
$$;

-- Updates an Event at an expected version. `changes` carries the
-- UpdateEventInput fields present in the request; a key with a null value
-- clears that field, an absent key leaves it unchanged. `command`, when
-- given, is recorded in the audit metadata like the service does.
CREATE FUNCTION chronelle_event_update(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_id uuid,
  expected_version integer,
  changes jsonb,
  command jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  current_object objects%ROWTYPE;
  current_event events%ROWTYPE;
  next_version integer;
  audit_id uuid := chronelle_uuidv7();
  written_at timestamptz := now();
  starts_at timestamptz;
  ends_at timestamptz;
  starts_on date;
  ends_on date;
  timezone text;
  is_all_day boolean;
  audit_metadata jsonb;
BEGIN
  IF NOT chronelle_can_edit(workspace_id, user_id, object_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT * INTO current_object FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = object_id AND o.object_type = 'event'
  FOR UPDATE;
  IF NOT FOUND OR current_object.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT * INTO current_event FROM events e
  WHERE e.workspace_id = workspace_id AND e.object_id = object_id;

  starts_at := CASE WHEN changes ? 'startsAt' THEN chronelle_instant(changes -> 'startsAt', 'startsAt') ELSE current_event.starts_at END;
  ends_at := CASE WHEN changes ? 'endsAt' THEN chronelle_instant(changes -> 'endsAt', 'endsAt') ELSE current_event.ends_at END;
  starts_on := CASE WHEN changes ? 'startsOn' THEN chronelle_calendar_date(changes -> 'startsOn') ELSE current_event.starts_on END;
  ends_on := CASE WHEN changes ? 'endsOn' THEN chronelle_calendar_date(changes -> 'endsOn') ELSE current_event.ends_on END;
  timezone := CASE WHEN changes ? 'timezone' THEN changes ->> 'timezone' ELSE current_event.timezone END;
  is_all_day := CASE WHEN changes ? 'isAllDay' THEN (changes ->> 'isAllDay')::boolean ELSE current_event.is_all_day END;
  PERFORM chronelle_assert_event_state(starts_at, ends_at, timezone, starts_on, ends_on);

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
  UPDATE events e
  SET starts_at = starts_at, ends_at = ends_at, starts_on = starts_on, ends_on = ends_on,
      timezone = timezone, is_all_day = is_all_day
  WHERE e.workspace_id = workspace_id AND e.object_id = object_id;

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
  VALUES (audit_id, workspace_id, 'user', user_id, 'event.updated', object_id, request_id, audit_metadata, written_at);
  INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
  VALUES (chronelle_uuidv7(), workspace_id, object_id, next_version, 'updated', NULL,
          'user', user_id, request_id, audit_id, 1, chronelle_serialize_event(workspace_id, object_id), written_at);
  RETURN chronelle_event_rows(workspace_id, object_id);
END
$$;
