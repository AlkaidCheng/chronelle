-- Object soft deletion and trash recovery as database functions. Each call
-- applies the service's authorization, the version predicate, the state
-- rule, the audit event, and the revision snapshot in one transaction.
-- Documents gain the serializer and rows they need so every canonical type
-- can be deleted and recovered.
--
-- Errors follow the service: PT403 unavailable, PT409 stale version,
-- PT422 with the service's message for an object that is not in Trash or
-- whose canonical scope is still in Trash, PT500 missing revision baseline.

-- Delete requires an Owner: membership, or an active owner grant on the
-- object or its live canonical scope. Deleted objects are not deletable; a
-- missing object yields false.
CREATE FUNCTION chronelle_can_delete(workspace_id uuid, user_id uuid, object_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM objects o
    WHERE o.workspace_id = $1 AND o.id = $3 AND o.deleted_at IS NULL
      AND (
        EXISTS (
          SELECT 1 FROM workspace_members m
          WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.role = 'owner'
        ) OR EXISTS (
          SELECT 1 FROM resource_grants g
          WHERE g.workspace_id = $1
            AND g.principal_type = 'user'
            AND g.principal_id = $2
            AND g.role = 'owner'
            AND (g.expires_at IS NULL OR g.expires_at > now())
            AND g.resource_id = o.id
        ) OR EXISTS (
          SELECT 1 FROM resource_grants g
          JOIN objects scope ON scope.workspace_id = g.workspace_id AND scope.id = g.resource_id
          WHERE g.workspace_id = $1
            AND g.principal_type = 'user'
            AND g.principal_id = $2
            AND g.role = 'owner'
            AND (g.expires_at IS NULL OR g.expires_at > now())
            AND g.resource_id = o.permission_scope_id
            AND scope.deleted_at IS NULL
        )
      )
  );
$$;

-- Recovery reaches tombstones: an Owner through membership, or an active
-- owner grant on the object or its canonical scope, whatever their state.
CREATE FUNCTION chronelle_can_recover(workspace_id uuid, user_id uuid, object_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM objects o
    WHERE o.workspace_id = $1 AND o.id = $3
      AND (
        EXISTS (
          SELECT 1 FROM workspace_members m
          WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.role = 'owner'
        ) OR EXISTS (
          SELECT 1 FROM resource_grants g
          WHERE g.workspace_id = $1
            AND g.principal_type = 'user'
            AND g.principal_id = $2
            AND g.role = 'owner'
            AND g.resource_id IN (o.id, o.permission_scope_id)
            AND (g.expires_at IS NULL OR g.expires_at > now())
        )
      )
  );
$$;

CREATE FUNCTION chronelle_document_serialize(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT chronelle_serialize_object($1, $2) || jsonb_build_object(
    'objectType', 'document',
    'storageProvider', d.storage_provider,
    'originalFilename', d.original_filename,
    'mimeType', d.mime_type,
    'sizeBytes', d.size_bytes::text,
    'checksumSha256', d.checksum_sha256,
    'encryptionMode', d.encryption_mode
  )
  FROM documents d
  WHERE d.workspace_id = $1 AND d.object_id = $2;
$$;

CREATE FUNCTION chronelle_document_rows(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'object', to_jsonb(o),
    'document', to_jsonb(d) || jsonb_build_object('size_bytes', d.size_bytes::text)
  )
  FROM objects o
  JOIN documents d ON d.workspace_id = o.workspace_id AND d.object_id = o.id
  WHERE o.workspace_id = $1 AND o.id = $2;
$$;

-- The revision snapshot of any canonical type: the serialized resource, plus
-- the storage key for documents, exactly as the service records it.
CREATE FUNCTION chronelle_object_snapshot(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  object_type text;
  snapshot jsonb;
BEGIN
  SELECT o.object_type INTO object_type FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = object_id;
  EXECUTE format('SELECT chronelle_%I_serialize($1, $2)', object_type) INTO snapshot USING workspace_id, object_id;
  IF object_type = 'document' THEN
    snapshot := snapshot || (
      SELECT jsonb_build_object('storageKey', d.storage_key) FROM documents d
      WHERE d.workspace_id = workspace_id AND d.object_id = object_id
    );
  END IF;
  RETURN snapshot;
END
$$;

-- The rows of any canonical type for the adapter.
CREATE FUNCTION chronelle_object_rows(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  object_type text;
  rows jsonb;
BEGIN
  SELECT o.object_type INTO object_type FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = object_id;
  EXECUTE format('SELECT chronelle_%I_rows($1, $2)', object_type) INTO rows USING workspace_id, object_id;
  RETURN rows;
END
$$;

-- EventPlanningObjectService.softDelete(): the caller's instant stamps
-- deleted_at and updated_at. Returns {id, version, deletedAt}.
CREATE FUNCTION chronelle_object_delete(
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
  RETURN jsonb_build_object('id', object_id::text, 'version', saved.version, 'deletedAt', chronelle_iso(deleted_at));
END
$$;

-- ObjectRecoveryService.recover(): back from Trash under the version
-- predicate, refused while the canonical scope is still in Trash. Returns
-- the object's rows.
CREATE FUNCTION chronelle_object_recover(
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
  UPDATE objects o
  SET deleted_at = NULL, updated_at = written_at, version = o.version + 1
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
  RETURN chronelle_object_rows(workspace_id, object_id);
END
$$;
