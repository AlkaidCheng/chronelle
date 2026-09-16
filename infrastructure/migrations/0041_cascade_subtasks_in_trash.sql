-- A task takes its live subtasks to Trash with it and brings back the ones
-- that went with it; a subtask cannot be recovered under a parent still in
-- Trash. A tombstone remembers the object whose deletion took it along
-- (deleted_with), so a recovery brings back exactly those. The lifecycle
-- functions of migration 0018 gain the cascade, with one audit event and
-- one revision per subtask, as the service records.
ALTER TABLE objects ADD COLUMN deleted_with uuid;
ALTER TABLE objects ADD CONSTRAINT objects_deleted_with_fk
  FOREIGN KEY (deleted_with) REFERENCES objects(id) ON DELETE RESTRICT;
ALTER TABLE objects ADD CONSTRAINT objects_deleted_with_requires_deletion
  CHECK (deleted_with IS NULL OR deleted_at IS NOT NULL);
CREATE INDEX objects_deleted_with_idx ON objects (workspace_id, deleted_with)
  WHERE deleted_with IS NOT NULL;

CREATE OR REPLACE FUNCTION chronelle_object_delete(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_id uuid,
  expected_version integer,
  deleted_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  saved objects%ROWTYPE;
  subtask objects%ROWTYPE;
  saved_subtask objects%ROWTYPE;
  subtask_audit_id uuid;
  audit_id uuid := chronelle_uuidv7();
  written_at timestamptz := now();
BEGIN
  IF NOT chronelle_can_delete(workspace_id, user_id, object_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  UPDATE objects o
  SET deleted_at = deleted_at, updated_at = deleted_at, version = o.version + 1
  WHERE o.workspace_id = workspace_id AND o.id = object_id AND o.version = expected_version AND o.deleted_at IS NULL
  RETURNING * INTO saved;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM object_revisions r
    WHERE r.workspace_id = workspace_id AND r.object_id = object_id AND r.object_version = expected_version
  ) THEN
    RAISE EXCEPTION 'Object revision baseline is missing; run db:baseline-revisions before serving writes.'
      USING ERRCODE = 'PT500';
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
  VALUES (audit_id, workspace_id, 'user', user_id, saved.object_type || '.deleted', object_id, request_id,
          jsonb_build_object('version', saved.version), written_at);
  INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
  VALUES (chronelle_uuidv7(), workspace_id, object_id, saved.version, 'deleted', NULL,
          'user', user_id, request_id, audit_id, 1, chronelle_object_snapshot(workspace_id, object_id), written_at);
  -- A task takes its live subtasks to Trash with it, at the same instant,
  -- each with its own audit event and revision.
  IF saved.object_type = 'task' THEN
    FOR subtask IN
      SELECT o.* FROM objects o
      JOIN tasks t ON t.workspace_id = o.workspace_id AND t.object_id = o.id
      WHERE o.workspace_id = workspace_id AND t.parent_task_id = object_id AND o.deleted_at IS NULL
      ORDER BY o.id
      FOR UPDATE OF o
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM object_revisions r
        WHERE r.workspace_id = workspace_id AND r.object_id = subtask.id AND r.object_version = subtask.version
      ) THEN
        RAISE EXCEPTION 'Object revision baseline is missing; run db:baseline-revisions before serving writes.'
          USING ERRCODE = 'PT500';
      END IF;
      UPDATE objects o
      SET deleted_at = deleted_at, deleted_with = object_id, updated_at = deleted_at, version = o.version + 1
      WHERE o.workspace_id = workspace_id AND o.id = subtask.id
      RETURNING * INTO saved_subtask;
      subtask_audit_id := chronelle_uuidv7();
      INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
      VALUES (subtask_audit_id, workspace_id, 'user', user_id, 'task.deleted', saved_subtask.id, request_id,
              jsonb_build_object('cascadeFrom', object_id::text, 'version', saved_subtask.version), written_at);
      INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                    actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
      VALUES (chronelle_uuidv7(), workspace_id, saved_subtask.id, saved_subtask.version, 'deleted', NULL,
              'user', user_id, request_id, subtask_audit_id, 1, chronelle_object_snapshot(workspace_id, saved_subtask.id), written_at);
    END LOOP;
  END IF;
  RETURN jsonb_build_object('id', object_id::text, 'version', saved.version, 'deletedAt', chronelle_iso(deleted_at));
END
$$;

CREATE OR REPLACE FUNCTION chronelle_object_recover(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_id uuid,
  expected_version integer
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  current_object objects%ROWTYPE;
  saved objects%ROWTYPE;
  subtask objects%ROWTYPE;
  saved_subtask objects%ROWTYPE;
  subtask_audit_id uuid;
  audit_id uuid := chronelle_uuidv7();
  written_at timestamptz := now();
BEGIN
  IF NOT chronelle_can_recover(workspace_id, user_id, object_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT * INTO current_object FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = object_id
  FOR UPDATE;
  IF current_object.version <> expected_version THEN
    RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
  END IF;
  IF current_object.deleted_at IS NULL THEN
    RAISE EXCEPTION 'The object is not in Trash.' USING ERRCODE = 'PT422';
  END IF;
  IF current_object.permission_scope_id <> current_object.id AND NOT EXISTS (
    SELECT 1 FROM objects scope
    WHERE scope.workspace_id = workspace_id AND scope.id = current_object.permission_scope_id AND scope.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Restore the canonical permission scope first. Recovery does not change permissions.'
      USING ERRCODE = 'PT422';
  END IF;
  -- A subtask cannot come back under a parent that is still in Trash.
  IF current_object.object_type = 'task' AND EXISTS (
    SELECT 1 FROM tasks t
    JOIN objects parent ON parent.workspace_id = t.workspace_id AND parent.id = t.parent_task_id
    WHERE t.workspace_id = workspace_id AND t.object_id = object_id AND parent.deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Restore the parent task first.' USING ERRCODE = 'PT422';
  END IF;
  UPDATE objects o
  SET deleted_at = NULL, deleted_with = NULL, updated_at = written_at, version = o.version + 1
  WHERE o.workspace_id = workspace_id AND o.id = object_id AND o.version = expected_version AND o.deleted_at IS NOT NULL
  RETURNING * INTO saved;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM object_revisions r
    WHERE r.workspace_id = workspace_id AND r.object_id = object_id AND r.object_version = expected_version
  ) THEN
    RAISE EXCEPTION 'Object revision baseline is missing; run db:baseline-revisions before serving writes.'
      USING ERRCODE = 'PT500';
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
  VALUES (audit_id, workspace_id, 'user', user_id, saved.object_type || '.recovered', object_id, request_id,
          jsonb_build_object('previousVersion', expected_version, 'deletedAt', chronelle_iso(current_object.deleted_at),
                             'version', saved.version), written_at);
  INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
  VALUES (chronelle_uuidv7(), workspace_id, object_id, saved.version, 'recovered', NULL,
          'user', user_id, request_id, audit_id, 1, chronelle_object_snapshot(workspace_id, object_id), written_at);
  -- The subtasks that went to Trash with the task come back with it; those
  -- trashed on their own stay.
  IF saved.object_type = 'task' THEN
    FOR subtask IN
      SELECT o.* FROM objects o
      JOIN tasks t ON t.workspace_id = o.workspace_id AND t.object_id = o.id
      WHERE o.workspace_id = workspace_id AND t.parent_task_id = object_id AND o.deleted_with = object_id
      ORDER BY o.id
      FOR UPDATE OF o
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM object_revisions r
        WHERE r.workspace_id = workspace_id AND r.object_id = subtask.id AND r.object_version = subtask.version
      ) THEN
        RAISE EXCEPTION 'Object revision baseline is missing; run db:baseline-revisions before serving writes.'
          USING ERRCODE = 'PT500';
      END IF;
      UPDATE objects o
      SET deleted_at = NULL, deleted_with = NULL, updated_at = written_at, version = o.version + 1
      WHERE o.workspace_id = workspace_id AND o.id = subtask.id
      RETURNING * INTO saved_subtask;
      subtask_audit_id := chronelle_uuidv7();
      INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
      VALUES (subtask_audit_id, workspace_id, 'user', user_id, 'task.recovered', saved_subtask.id, request_id,
              jsonb_build_object('cascadeFrom', object_id::text, 'previousVersion', saved_subtask.version - 1,
                                 'deletedAt', chronelle_iso(current_object.deleted_at), 'version', saved_subtask.version), written_at);
      INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                    actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
      VALUES (chronelle_uuidv7(), workspace_id, saved_subtask.id, saved_subtask.version, 'recovered', NULL,
              'user', user_id, request_id, subtask_audit_id, 1, chronelle_object_snapshot(workspace_id, saved_subtask.id), written_at);
    END LOOP;
  END IF;
  RETURN chronelle_object_rows(workspace_id, object_id);
END
$$;
