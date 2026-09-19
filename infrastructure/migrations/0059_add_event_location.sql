-- A schedule item (an Event) may name where it happens as text (location),
-- as a Task does since 0039, until the Places family gives it something to
-- reference. The Event functions carry it, assert its shape with the
-- service's message, and serialize it; the content commands restore it
-- with the rest of an Event's content.
ALTER TABLE events ADD COLUMN location text;
ALTER TABLE events ADD CONSTRAINT events_location_valid
  CHECK (location IS NULL OR (location = btrim(location) AND length(location) BETWEEN 1 AND 240));

-- The service's assertEventLocation(): null, or 1 to 240 trimmed characters.
CREATE FUNCTION chronelle_assert_event_location(location text)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF location IS NOT NULL AND (location <> btrim(location) OR length(location) < 1 OR length(location) > 240) THEN
    RAISE EXCEPTION 'location is 1 to 240 characters without surrounding spaces.' USING ERRCODE = 'PT422';
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
    'location', e.location
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
BEGIN
  PERFORM chronelle_assert_event_state(starts_at, ends_at, timezone, starts_on, ends_on);
  PERFORM chronelle_assert_event_location(location);
  INSERT INTO events (object_id, workspace_id, starts_at, ends_at, starts_on, ends_on, timezone, is_all_day, location)
  VALUES (object_id, workspace_id, starts_at, ends_at, starts_on, ends_on, timezone,
          COALESCE((input ->> 'isAllDay')::boolean, false), location);
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
      location = CASE WHEN changes ? 'location' THEN changes ->> 'location' ELSE e.location END
  WHERE e.workspace_id = workspace_id AND e.object_id = object_id;
END
$$;

-- The content a reversible command carries for an Event includes the place.
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
      'location', snapshot -> 'location')
    WHEN 'task' THEN jsonb_build_object(
      'displayName', snapshot -> 'displayName',
      'customProperties', snapshot -> 'customProperties',
      'status', snapshot -> 'status',
      'dueOn', snapshot -> 'dueOn',
      'dueAt', snapshot -> 'dueAt',
      'completedAt', snapshot -> 'completedAt')
  END;
$$;
