ALTER TABLE object_revisions
  ADD COLUMN source_revision_id uuid REFERENCES object_revisions(id) ON DELETE RESTRICT,
  DROP CONSTRAINT object_revisions_mutation_kind_check,
  ADD CONSTRAINT object_revisions_mutation_kind_check CHECK (
    mutation_kind IN ('baseline', 'created', 'updated', 'permission_scope_updated', 'deleted', 'restored')
  ),
  ADD CONSTRAINT object_revisions_source_required CHECK (
    (mutation_kind = 'restored') = (source_revision_id IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION chronelle_validate_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM audit_events a JOIN objects o
      ON o.workspace_id = a.workspace_id AND o.id = a.resource_id
    WHERE a.id = NEW.audit_event_id AND a.workspace_id = NEW.workspace_id
      AND a.resource_id = NEW.object_id AND a.request_id = NEW.request_id
      AND a.actor_type = NEW.actor_type AND a.actor_id IS NOT DISTINCT FROM NEW.actor_id
      AND o.version = NEW.object_version AND o.object_type = NEW.snapshot->>'objectType'
      AND a.action = CASE NEW.mutation_kind
        WHEN 'baseline' THEN 'object.baselined'
        WHEN 'permission_scope_updated' THEN 'object.permission_scope_updated'
        ELSE o.object_type || '.' || NEW.mutation_kind END
      AND (NEW.mutation_kind <> 'restored' OR a.metadata->>'sourceRevisionId' = NEW.source_revision_id::text)
  ) THEN
    RAISE EXCEPTION 'revision must match its canonical version and audit event' USING ERRCODE = '23514';
  END IF;
  IF NEW.mutation_kind = 'restored' AND NOT EXISTS (
    SELECT 1 FROM object_revisions source
    WHERE source.id = NEW.source_revision_id
      AND source.workspace_id = NEW.workspace_id AND source.object_id = NEW.object_id
      AND source.object_version < NEW.object_version
      AND source.snapshot_schema_version = NEW.snapshot_schema_version
  ) THEN
    RAISE EXCEPTION 'restoration source must be an earlier revision of the same object' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
