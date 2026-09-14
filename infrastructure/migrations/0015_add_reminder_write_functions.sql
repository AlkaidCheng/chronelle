-- Reminder create and update as database functions on the shared object
-- write core of migration 0013. The family supplies the typed steps the core
-- resolves by name; authorization, the objects row, the version predicate,
-- the audit event, and the revision snapshot are the core's.

-- The service validates remindAt; the status set mirrors the table's check
-- constraint so an unknown status fails as an invalid state rather than a
-- constraint violation.
CREATE FUNCTION chronelle_assert_reminder_state(remind_at timestamptz, status text)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF remind_at IS NULL THEN
    RAISE EXCEPTION 'remindAt must be a valid date.' USING ERRCODE = 'PT422';
  END IF;
  IF status IS NULL OR status NOT IN ('pending', 'triggered', 'dismissed', 'cancelled') THEN
    RAISE EXCEPTION 'status must be pending, triggered, dismissed, or cancelled.' USING ERRCODE = 'PT422';
  END IF;
END
$$;

CREATE FUNCTION chronelle_reminder_serialize(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT chronelle_serialize_object($1, $2) || jsonb_build_object(
    'objectType', 'reminder',
    'remindAt', chronelle_iso(r.remind_at),
    'status', r.status
  )
  FROM reminders r
  WHERE r.workspace_id = $1 AND r.object_id = $2;
$$;

CREATE FUNCTION chronelle_reminder_rows(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('object', to_jsonb(o), 'reminder', to_jsonb(r))
  FROM objects o
  JOIN reminders r ON r.workspace_id = o.workspace_id AND r.object_id = o.id
  WHERE o.workspace_id = $1 AND o.id = $2;
$$;

CREATE FUNCTION chronelle_reminder_insert(workspace_id uuid, object_id uuid, input jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  remind_at timestamptz := chronelle_instant(input -> 'remindAt', 'remindAt');
  status text := COALESCE(input ->> 'status', 'pending');
BEGIN
  PERFORM chronelle_assert_reminder_state(remind_at, status);
  INSERT INTO reminders (object_id, workspace_id, remind_at, status)
  VALUES (object_id, workspace_id, remind_at, status);
END
$$;

CREATE FUNCTION chronelle_reminder_validate(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  current_reminder reminders%ROWTYPE;
BEGIN
  SELECT * INTO current_reminder FROM reminders r
  WHERE r.workspace_id = workspace_id AND r.object_id = object_id;
  PERFORM chronelle_assert_reminder_state(
    COALESCE(chronelle_instant(changes -> 'remindAt', 'remindAt'), current_reminder.remind_at),
    COALESCE(changes ->> 'status', current_reminder.status)
  );
END
$$;

CREATE FUNCTION chronelle_reminder_apply(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
BEGIN
  UPDATE reminders r
  SET remind_at = COALESCE(chronelle_instant(changes -> 'remindAt', 'remindAt'), r.remind_at),
      status = COALESCE(changes ->> 'status', r.status)
  WHERE r.workspace_id = workspace_id AND r.object_id = object_id;
END
$$;

CREATE FUNCTION chronelle_reminder_create(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  input jsonb
)
RETURNS jsonb LANGUAGE sql VOLATILE AS $$
  SELECT chronelle_object_create($1, $2, $3, 'reminder', $4);
$$;

CREATE FUNCTION chronelle_reminder_update(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_id uuid,
  expected_version integer,
  changes jsonb,
  command jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql VOLATILE AS $$
  SELECT chronelle_object_update($1, $2, $3, 'reminder', $4, $5, $6, $7);
$$;
