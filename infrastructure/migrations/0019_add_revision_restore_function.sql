-- Revision restore as a database function. The restoration policy, which
-- decides what content of a historical revision may come back, stays in the
-- application; the function applies the selected content under the version
-- predicate through the family apply functions and records the restored
-- revision with its source.
--
-- Errors follow the service: PT403 unavailable (including a source revision
-- that does not belong to the object), PT409 stale version or an object in
-- Trash, PT422 when the source revision is a deleted state, PT500 missing
-- revision baseline.
CREATE FUNCTION chronelle_object_restore(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_id uuid,
  expected_version integer,
  source_revision_id uuid,
  source_version integer,
  content jsonb
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  current_object objects%ROWTYPE;
  source object_revisions%ROWTYPE;
  saved objects%ROWTYPE;
  audit_id uuid := chronelle_uuidv7();
  written_at timestamptz := now();
BEGIN
  IF NOT chronelle_can_edit(workspace_id, user_id, object_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT * INTO current_object FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = object_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF current_object.version <> expected_version THEN
    RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO source FROM object_revisions r
  WHERE r.workspace_id = workspace_id AND r.object_id = object_id
    AND r.id = source_revision_id AND r.object_version = source_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF source.snapshot ->> 'deletedAt' IS NOT NULL THEN
    RAISE EXCEPTION 'A deleted state cannot be restored through content history.' USING ERRCODE = 'PT422';
  END IF;

  UPDATE objects o
  SET display_name = content ->> 'displayName',
      custom_properties = COALESCE(content -> 'customProperties', '{}'::jsonb),
      updated_at = written_at,
      version = o.version + 1
  WHERE o.workspace_id = workspace_id AND o.id = object_id AND o.version = expected_version AND o.deleted_at IS NULL
  RETURNING * INTO saved;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
  END IF;
  -- Expense and Document content is preserved by policy; only the families
  -- with restorable typed fields take the content.
  IF saved.object_type IN ('event', 'task', 'reminder') THEN
    EXECUTE format('SELECT chronelle_%I_apply($1, $2, $3)', saved.object_type) USING workspace_id, object_id, content;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM object_revisions r
    WHERE r.workspace_id = workspace_id AND r.object_id = object_id AND r.object_version = expected_version
  ) THEN
    RAISE EXCEPTION 'Object revision baseline is missing; run db:baseline-revisions before serving writes.'
      USING ERRCODE = 'PT500';
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
  VALUES (audit_id, workspace_id, 'user', user_id, saved.object_type || '.restored', object_id, request_id,
          jsonb_build_object('previousVersion', expected_version, 'sourceVersion', source_version,
                             'version', saved.version, 'sourceRevisionId', source_revision_id::text), written_at);
  INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
  VALUES (chronelle_uuidv7(), workspace_id, object_id, saved.version, 'restored', source_revision_id,
          'user', user_id, request_id, audit_id, 1, chronelle_object_snapshot(workspace_id, object_id), written_at);
  RETURN chronelle_object_rows(workspace_id, object_id);
END
$$;
