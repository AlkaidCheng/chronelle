ALTER TABLE object_relations
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);

CREATE FUNCTION chronelle_validate_relation_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version <> OLD.version + 1 OR
     (NEW.id, NEW.workspace_id, NEW.source_object_id, NEW.target_object_id,
      NEW.relation_type, NEW.created_by, NEW.created_at) IS DISTINCT FROM
     (OLD.id, OLD.workspace_id, OLD.source_object_id, OLD.target_object_id,
      OLD.relation_type, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'relation changes must advance version and preserve identity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER object_relations_versioned
BEFORE UPDATE ON object_relations
FOR EACH ROW EXECUTE FUNCTION chronelle_validate_relation_version();

CREATE INDEX objects_trash_cursor_idx ON objects (workspace_id, id DESC)
  WHERE deleted_at IS NOT NULL;
CREATE INDEX object_relations_removed_cursor_idx ON object_relations (workspace_id, source_object_id, id DESC)
  WHERE deleted_at IS NOT NULL;
CREATE INDEX object_relations_removed_target_cursor_idx ON object_relations (workspace_id, target_object_id, id DESC)
  WHERE deleted_at IS NOT NULL;

ALTER TABLE object_revisions
  DROP CONSTRAINT object_revisions_mutation_kind_check,
  ADD CONSTRAINT object_revisions_mutation_kind_check CHECK (
    mutation_kind IN ('baseline', 'created', 'updated', 'permission_scope_updated', 'deleted', 'restored', 'recovered')
  );
