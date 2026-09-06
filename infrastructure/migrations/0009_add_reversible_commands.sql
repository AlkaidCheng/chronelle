CREATE TABLE command_stacks (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  undo_ids uuid[] NOT NULL DEFAULT '{}',
  redo_ids uuid[] NOT NULL DEFAULT '{}',
  expected_versions jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(expected_versions) = 'object'),
  PRIMARY KEY (workspace_id, user_id),
  CHECK (cardinality(undo_ids) + cardinality(redo_ids) <= 50)
);

CREATE TABLE reversible_commands (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, id)
);

CREATE TABLE command_changes (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  command_id uuid NOT NULL,
  object_id uuid NOT NULL,
  before_version integer NOT NULL CHECK (before_version > 0),
  after_version integer NOT NULL CHECK (after_version = before_version + 1),
  PRIMARY KEY (workspace_id, user_id, command_id, object_id),
  FOREIGN KEY (workspace_id, user_id, command_id)
    REFERENCES reversible_commands(workspace_id, user_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, object_id, before_version)
    REFERENCES object_revisions(workspace_id, object_id, object_version) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, object_id, after_version)
    REFERENCES object_revisions(workspace_id, object_id, object_version) ON DELETE RESTRICT
);

CREATE TABLE command_receipts (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  command_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  audit_event_id uuid NOT NULL UNIQUE REFERENCES audit_events(id) ON DELETE RESTRICT,
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  PRIMARY KEY (workspace_id, user_id, operation_id),
  FOREIGN KEY (workspace_id, user_id, command_id)
    REFERENCES reversible_commands(workspace_id, user_id, id) ON DELETE RESTRICT
);

CREATE FUNCTION chronelle_reject_command_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'command history is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER reversible_commands_append_only BEFORE UPDATE OR DELETE ON reversible_commands
FOR EACH ROW EXECUTE FUNCTION chronelle_reject_command_mutation();
CREATE TRIGGER reversible_commands_no_truncate BEFORE TRUNCATE ON reversible_commands
FOR EACH STATEMENT EXECUTE FUNCTION chronelle_reject_command_mutation();
CREATE TRIGGER command_changes_append_only BEFORE UPDATE OR DELETE ON command_changes
FOR EACH ROW EXECUTE FUNCTION chronelle_reject_command_mutation();
CREATE TRIGGER command_changes_no_truncate BEFORE TRUNCATE ON command_changes
FOR EACH STATEMENT EXECUTE FUNCTION chronelle_reject_command_mutation();
CREATE TRIGGER command_receipts_append_only BEFORE UPDATE OR DELETE ON command_receipts
FOR EACH ROW EXECUTE FUNCTION chronelle_reject_command_mutation();
CREATE TRIGGER command_receipts_no_truncate BEFORE TRUNCATE ON command_receipts
FOR EACH STATEMENT EXECUTE FUNCTION chronelle_reject_command_mutation();
