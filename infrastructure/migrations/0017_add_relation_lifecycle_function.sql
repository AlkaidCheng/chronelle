-- Relation removal and recovery as one database function, completing the
-- relation family started by chronelle_relation_create in migration 0016.
-- Removal stamps the caller's instant; recovery clears it; both advance the
-- version under a compare-and-set predicate and write one audit row.
--
-- Errors follow the service: PT403 unavailable, PT409 stale version or an
-- active relation already occupying the triple on recovery, PT400 when the
-- relation is already in the requested state.
CREATE FUNCTION chronelle_relation_lifecycle(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  relation_id uuid,
  expected_version integer,
  deleted_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  current_relation object_relations%ROWTYPE;
  saved object_relations%ROWTYPE;
BEGIN
  SELECT * INTO current_relation FROM object_relations r
  WHERE r.workspace_id = workspace_id AND r.id = relation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF NOT chronelle_can_edit(workspace_id, user_id, current_relation.source_object_id)
     OR EXISTS (
       SELECT 1 FROM objects o
       WHERE o.workspace_id = workspace_id AND o.id = current_relation.source_object_id AND o.deleted_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF deleted_at IS NULL AND NOT chronelle_can_view(workspace_id, user_id, current_relation.target_object_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF current_relation.version <> expected_version THEN
    RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
  END IF;
  IF (current_relation.deleted_at IS NULL) = (deleted_at IS NULL) THEN
    RAISE EXCEPTION 'The relationship is already in the requested state.' USING ERRCODE = 'PT400';
  END IF;

  BEGIN
    UPDATE object_relations r
    SET deleted_at = deleted_at, version = r.version + 1
    WHERE r.workspace_id = workspace_id AND r.id = relation_id AND r.version = expected_version
    RETURNING * INTO saved;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'The active relationship already exists.' USING ERRCODE = 'PT409';
  END;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), workspace_id, 'user', user_id,
          CASE WHEN deleted_at IS NULL THEN 'relation.recovered' ELSE 'relation.deleted' END,
          current_relation.source_object_id, request_id,
          jsonb_build_object('relationId', relation_id::text, 'relationType', current_relation.relation_type,
                             'targetObjectId', current_relation.target_object_id::text,
                             'previousVersion', expected_version, 'version', saved.version));
  RETURN to_jsonb(saved);
END
$$;
