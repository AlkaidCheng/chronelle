CREATE TABLE object_revisions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  object_id uuid NOT NULL,
  object_version integer NOT NULL CHECK (object_version > 0),
  mutation_kind text NOT NULL CHECK (
    mutation_kind IN ('baseline', 'created', 'updated', 'permission_scope_updated', 'deleted')
  ),
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'assistant', 'service_account', 'system')),
  actor_id uuid,
  request_id uuid NOT NULL,
  audit_event_id uuid NOT NULL UNIQUE REFERENCES audit_events(id) ON DELETE RESTRICT,
  snapshot_schema_version integer NOT NULL CHECK (snapshot_schema_version > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT object_revisions_actor_valid CHECK (
    (actor_type = 'system' AND actor_id IS NULL)
    OR (actor_type <> 'system' AND actor_id IS NOT NULL)
  ),
  CONSTRAINT object_revisions_object_workspace_fk
    FOREIGN KEY (workspace_id, object_id) REFERENCES objects(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT object_revisions_version_unique UNIQUE (workspace_id, object_id, object_version),
  CONSTRAINT object_revisions_snapshot_identity CHECK ((
    snapshot ?& ARRAY['id', 'workspaceId', 'version', 'objectType']
    AND snapshot->>'id' = object_id::text
    AND snapshot->>'workspaceId' = workspace_id::text
    AND (snapshot->>'version')::integer = object_version
  ) IS TRUE)
);

CREATE FUNCTION chronelle_reject_revision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'object_revisions is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER object_revisions_append_only
BEFORE UPDATE OR DELETE ON object_revisions
FOR EACH ROW EXECUTE FUNCTION chronelle_reject_revision_mutation();

CREATE TRIGGER object_revisions_no_truncate
BEFORE TRUNCATE ON object_revisions
FOR EACH STATEMENT EXECUTE FUNCTION chronelle_reject_revision_mutation();

CREATE FUNCTION chronelle_validate_revision()
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
  ) THEN
    RAISE EXCEPTION 'revision must match its canonical version and audit event' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER object_revisions_validate
BEFORE INSERT ON object_revisions
FOR EACH ROW EXECUTE FUNCTION chronelle_validate_revision();
