-- Event page layout changes as database functions: saving a new layout
-- version and restoring an earlier one. The layout is an append-only history
-- of page arrays; each call checks edit access on the Event, the version
-- predicate against the latest revision, and writes one audit event and one
-- revision.
--
-- Errors follow the service: PT403 unavailable (including a missing target
-- version on restore), PT422 when the object is not an Event, PT409 stale
-- version.

-- Appends one layout revision. For an update, pages carries the validated
-- layout and restored_from_version is null; for a restore, pages is null and
-- restored_from_version names the source version (0 for the empty layout),
-- which is read after the version predicate so a stale request is a
-- conflict before a missing source is unavailable.
CREATE FUNCTION chronelle_event_layout_write(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  event_id uuid,
  expected_version integer,
  pages jsonb,
  restored_from_version integer
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  current_version integer;
  next_version integer;
  layout jsonb := pages;
  audit_id uuid := chronelle_uuidv7();
  written_at timestamptz := now();
BEGIN
  IF NOT chronelle_can_edit(workspace_id, user_id, event_id) OR EXISTS (
    SELECT 1 FROM objects o WHERE o.workspace_id = workspace_id AND o.id = event_id AND o.deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  PERFORM 1 FROM objects o WHERE o.workspace_id = workspace_id AND o.id = event_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM events e WHERE e.workspace_id = workspace_id AND e.object_id = event_id) THEN
    RAISE EXCEPTION 'Page layouts belong to Events.' USING ERRCODE = 'PT422';
  END IF;
  SELECT COALESCE(max(r.version), 0) INTO current_version FROM event_page_revisions r
  WHERE r.workspace_id = workspace_id AND r.event_id = event_id;
  IF current_version <> expected_version THEN
    RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
  END IF;
  IF restored_from_version IS NOT NULL THEN
    IF restored_from_version > 0 THEN
      SELECT r.pages INTO layout FROM event_page_revisions r
      WHERE r.workspace_id = workspace_id AND r.event_id = event_id AND r.version = restored_from_version;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
      END IF;
    ELSE
      layout := '[]'::jsonb;
    END IF;
  END IF;
  next_version := current_version + 1;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
  VALUES (audit_id, workspace_id, 'user', user_id,
          CASE WHEN restored_from_version IS NULL THEN 'event.layout_updated' ELSE 'event.layout_restored' END,
          event_id, request_id,
          jsonb_build_object('previousVersion', current_version, 'version', next_version)
            || CASE WHEN restored_from_version IS NULL THEN '{}'::jsonb
                    ELSE jsonb_build_object('restoredFromVersion', restored_from_version) END,
          written_at);
  INSERT INTO event_page_revisions (workspace_id, event_id, version, pages, audit_event_id, created_at)
  VALUES (workspace_id, event_id, next_version, layout, audit_id, written_at);
  RETURN jsonb_build_object('eventId', event_id::text, 'version', next_version, 'pages', layout,
                            'updatedAt', chronelle_iso(written_at));
END
$$;

-- EventLayoutService.update(): the pages are validated by the application
-- before the call. Returns {eventId, version, pages, updatedAt}.
CREATE FUNCTION chronelle_event_layout_update(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  event_id uuid,
  expected_version integer,
  pages jsonb
)
RETURNS jsonb LANGUAGE sql VOLATILE AS $$
  SELECT chronelle_event_layout_write($1, $2, $3, $4, $5, $6, NULL);
$$;

-- EventLayoutService.restore(): the pages of the target version, or the
-- empty layout for version 0, become the next version.
CREATE FUNCTION chronelle_event_layout_restore(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  event_id uuid,
  expected_version integer,
  target_version integer
)
RETURNS jsonb LANGUAGE sql VOLATILE AS $$
  SELECT chronelle_event_layout_write($1, $2, $3, $4, $5, NULL, $6);
$$;
