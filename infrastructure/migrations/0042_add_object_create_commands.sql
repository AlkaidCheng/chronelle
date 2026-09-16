-- A standalone creation may carry a commandId: the same user's repeat of
-- the same input returns the object it created, a different input under
-- the same id is a conflict, so a retry after a lost response cannot
-- duplicate an object. Linked creation already records its commands; this
-- table records the standalone ones, and the write core of migration 0013
-- (as widened by 0037) reads the id and the application's request hash
-- from the input.
CREATE TABLE object_create_commands (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  object_type text NOT NULL,
  object_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, command_id),
  FOREIGN KEY (workspace_id, object_id) REFERENCES objects(workspace_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER object_create_commands_append_only
BEFORE UPDATE OR DELETE ON object_create_commands
FOR EACH ROW EXECUTE FUNCTION chronelle_reject_context_command_mutation();

CREATE TRIGGER object_create_commands_no_truncate
BEFORE TRUNCATE ON object_create_commands
FOR EACH STATEMENT EXECUTE FUNCTION chronelle_reject_context_command_mutation();

CREATE OR REPLACE FUNCTION chronelle_object_create(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_type text,
  input jsonb
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  object_id uuid := chronelle_uuidv7();
  audit_id uuid := chronelle_uuidv7();
  written_at timestamptz := now();
  scope_id uuid := COALESCE((input ->> 'permissionScopeId')::uuid, object_id);
  command_id uuid := (input ->> 'commandId')::uuid;
  request_hash text := input ->> 'requestHash';
  existing object_create_commands%ROWTYPE;
  snapshot jsonb;
  rows jsonb;
BEGIN
  -- A repeated command returns what it created; a different input under the
  -- same command id is a conflict.
  IF command_id IS NOT NULL THEN
    IF request_hash IS NULL THEN
      RAISE EXCEPTION 'A commandId requires its requestHash.' USING ERRCODE = 'PT422';
    END IF;
    SELECT * INTO existing FROM object_create_commands c
    WHERE c.workspace_id = workspace_id AND c.user_id = user_id AND c.command_id = command_id;
    IF FOUND THEN
      IF existing.request_hash <> request_hash THEN
        RAISE EXCEPTION 'The command ID was already used with different input.' USING ERRCODE = 'PT409';
      END IF;
      IF NOT chronelle_can_view(workspace_id, user_id, existing.object_id) THEN
        RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
      END IF;
      RETURN chronelle_object_rows(workspace_id, existing.object_id);
    END IF;
    input := input - 'commandId' - 'requestHash';
  END IF;
  IF object_type NOT IN ('event', 'task', 'expense', 'reminder', 'person') THEN
    RAISE EXCEPTION 'Unsupported object type %.', object_type USING ERRCODE = 'PT422';
  END IF;
  IF input ? 'permissionScopeId' THEN
    IF NOT chronelle_can_edit(workspace_id, user_id, scope_id) THEN
      RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
    END IF;
  ELSIF NOT chronelle_can_create(workspace_id, user_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  INSERT INTO objects (id, workspace_id, object_type, display_name, created_by, permission_scope_id,
                       custom_properties, metadata, created_at, updated_at, version)
  VALUES (object_id, workspace_id, object_type, input ->> 'displayName', user_id, scope_id,
          COALESCE(input -> 'customProperties', '{}'::jsonb), COALESCE(input -> 'metadata', '{}'::jsonb),
          written_at, written_at, 1);
  EXECUTE format('SELECT chronelle_%I_insert($1, $2, $3)', object_type) USING workspace_id, object_id, input;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
  VALUES (audit_id, workspace_id, 'user', user_id, object_type || '.created', object_id, request_id,
          jsonb_build_object('permissionScopeId', scope_id::text, 'version', 1), written_at);
  EXECUTE format('SELECT chronelle_%I_serialize($1, $2)', object_type) INTO snapshot USING workspace_id, object_id;
  INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
  VALUES (chronelle_uuidv7(), workspace_id, object_id, 1, 'created', NULL,
          'user', user_id, request_id, audit_id, 1, snapshot, written_at);
  IF command_id IS NOT NULL THEN
    INSERT INTO object_create_commands (workspace_id, user_id, command_id, request_id, request_hash, object_type, object_id)
    VALUES (workspace_id, user_id, command_id, request_id, request_hash, object_type, object_id);
  END IF;
  EXECUTE format('SELECT chronelle_%I_rows($1, $2)', object_type) INTO rows USING workspace_id, object_id;
  RETURN rows;
END
$$;
