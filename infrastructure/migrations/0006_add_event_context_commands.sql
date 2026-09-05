CREATE TABLE event_context_commands (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  context_object_id uuid NOT NULL,
  object_id uuid NOT NULL,
  relation_id uuid NOT NULL REFERENCES object_relations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, command_id),
  FOREIGN KEY (workspace_id, context_object_id) REFERENCES objects(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, object_id) REFERENCES objects(workspace_id, id) ON DELETE RESTRICT
);

CREATE FUNCTION chronelle_reject_context_command_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'event_context_commands is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER event_context_commands_append_only
BEFORE UPDATE OR DELETE ON event_context_commands
FOR EACH ROW EXECUTE FUNCTION chronelle_reject_context_command_mutation();

CREATE TRIGGER event_context_commands_no_truncate
BEFORE TRUNCATE ON event_context_commands
FOR EACH STATEMENT EXECUTE FUNCTION chronelle_reject_context_command_mutation();
