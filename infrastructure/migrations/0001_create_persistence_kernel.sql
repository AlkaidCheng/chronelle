CREATE TABLE users (
  id uuid PRIMARY KEY,
  identity_provider text NOT NULL,
  provider_subject text NOT NULL,
  email text,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_identity_provider_not_blank
    CHECK (btrim(identity_provider) <> ''),
  CONSTRAINT users_provider_subject_not_blank
    CHECK (btrim(provider_subject) <> ''),
  CONSTRAINT users_display_name_not_blank
    CHECK (btrim(display_name) <> ''),
  CONSTRAINT users_updated_after_creation
    CHECK (updated_at >= created_at),
  CONSTRAINT users_provider_identity_unique
    UNIQUE (identity_provider, provider_subject)
);

CREATE TABLE workspaces (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspaces_display_name_not_blank
    CHECK (btrim(display_name) <> ''),
  CONSTRAINT workspaces_updated_after_creation
    CHECK (updated_at >= created_at)
);

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT workspace_members_role_valid
    CHECK (role IN ('owner', 'editor', 'viewer'))
);

CREATE TABLE objects (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  object_type text NOT NULL,
  display_name text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  permission_scope_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  deleted_at timestamptz,
  custom_properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT objects_workspace_id_unique
    UNIQUE (workspace_id, id),
  CONSTRAINT objects_workspace_id_type_unique
    UNIQUE (workspace_id, id, object_type),
  CONSTRAINT objects_type_valid
    CHECK (object_type IN ('event', 'task', 'expense', 'reminder', 'document')),
  CONSTRAINT objects_display_name_not_blank
    CHECK (btrim(display_name) <> ''),
  CONSTRAINT objects_version_positive
    CHECK (version > 0),
  CONSTRAINT objects_updated_after_creation
    CHECK (updated_at >= created_at),
  CONSTRAINT objects_archived_after_creation
    CHECK (archived_at IS NULL OR archived_at >= created_at),
  CONSTRAINT objects_deleted_after_creation
    CHECK (deleted_at IS NULL OR deleted_at >= created_at),
  CONSTRAINT objects_custom_properties_object
    CHECK (jsonb_typeof(custom_properties) = 'object'),
  CONSTRAINT objects_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT objects_permission_scope_workspace_fk
    FOREIGN KEY (workspace_id, permission_scope_id)
    REFERENCES objects(workspace_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE object_relations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  source_object_id uuid NOT NULL,
  relation_type text NOT NULL,
  target_object_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT object_relations_source_workspace_fk
    FOREIGN KEY (workspace_id, source_object_id)
    REFERENCES objects(workspace_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT object_relations_target_workspace_fk
    FOREIGN KEY (workspace_id, target_object_id)
    REFERENCES objects(workspace_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT object_relations_type_valid
    CHECK (
      relation_type IN (
        'includes',
        'reminds_about',
        'attached_to',
        'related_to'
      )
    ),
  CONSTRAINT object_relations_distinct_endpoints
    CHECK (source_object_id <> target_object_id),
  CONSTRAINT object_relations_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT object_relations_deleted_after_creation
    CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE UNIQUE INDEX object_relations_active_unique
  ON object_relations (
    workspace_id,
    source_object_id,
    relation_type,
    target_object_id
  )
  WHERE deleted_at IS NULL;

CREATE TABLE resource_grants (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  resource_id uuid NOT NULL,
  principal_type text NOT NULL DEFAULT 'user',
  principal_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role text NOT NULL,
  granted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT resource_grants_resource_workspace_fk
    FOREIGN KEY (workspace_id, resource_id)
    REFERENCES objects(workspace_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT resource_grants_principal_type_valid
    CHECK (principal_type = 'user'),
  CONSTRAINT resource_grants_role_valid
    CHECK (role IN ('owner', 'editor', 'viewer')),
  CONSTRAINT resource_grants_expiry_after_creation
    CHECK (expires_at IS NULL OR expires_at > created_at),
  CONSTRAINT resource_grants_principal_unique
    UNIQUE (workspace_id, resource_id, principal_type, principal_id)
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  actor_type text NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  resource_id uuid,
  request_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_resource_workspace_fk
    FOREIGN KEY (workspace_id, resource_id)
    REFERENCES objects(workspace_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT audit_events_actor_type_valid
    CHECK (actor_type IN ('user', 'assistant', 'service_account', 'system')),
  CONSTRAINT audit_events_actor_identity_valid
    CHECK (
      (actor_type = 'system' AND actor_id IS NULL)
      OR (actor_type <> 'system' AND actor_id IS NOT NULL)
    ),
  CONSTRAINT audit_events_action_not_blank
    CHECK (btrim(action) <> ''),
  CONSTRAINT audit_events_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE FUNCTION chronelle_reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION chronelle_reject_audit_event_mutation();

CREATE TABLE events (
  object_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  object_type text NOT NULL DEFAULT 'event',
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  is_all_day boolean NOT NULL DEFAULT false,
  CONSTRAINT events_canonical_object_fk
    FOREIGN KEY (workspace_id, object_id, object_type)
    REFERENCES objects(workspace_id, id, object_type)
    ON DELETE RESTRICT,
  CONSTRAINT events_object_type_valid
    CHECK (object_type = 'event'),
  CONSTRAINT events_end_requires_start
    CHECK (ends_at IS NULL OR starts_at IS NOT NULL),
  CONSTRAINT events_time_order_valid
    CHECK (ends_at IS NULL OR ends_at >= starts_at),
  CONSTRAINT events_timezone_not_blank
    CHECK (timezone IS NULL OR btrim(timezone) <> '')
);

CREATE TABLE tasks (
  object_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  object_type text NOT NULL DEFAULT 'task',
  status text NOT NULL DEFAULT 'todo',
  due_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT tasks_canonical_object_fk
    FOREIGN KEY (workspace_id, object_id, object_type)
    REFERENCES objects(workspace_id, id, object_type)
    ON DELETE RESTRICT,
  CONSTRAINT tasks_object_type_valid
    CHECK (object_type = 'task'),
  CONSTRAINT tasks_status_valid
    CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  CONSTRAINT tasks_completion_matches_status
    CHECK ((status = 'done') = (completed_at IS NOT NULL))
);

CREATE TABLE expenses (
  object_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  object_type text NOT NULL DEFAULT 'expense',
  amount numeric(19, 4) NOT NULL,
  currency text NOT NULL,
  occurred_at timestamptz NOT NULL,
  CONSTRAINT expenses_canonical_object_fk
    FOREIGN KEY (workspace_id, object_id, object_type)
    REFERENCES objects(workspace_id, id, object_type)
    ON DELETE RESTRICT,
  CONSTRAINT expenses_object_type_valid
    CHECK (object_type = 'expense'),
  CONSTRAINT expenses_currency_valid
    CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE TABLE reminders (
  object_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  object_type text NOT NULL DEFAULT 'reminder',
  remind_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  CONSTRAINT reminders_canonical_object_fk
    FOREIGN KEY (workspace_id, object_id, object_type)
    REFERENCES objects(workspace_id, id, object_type)
    ON DELETE RESTRICT,
  CONSTRAINT reminders_object_type_valid
    CHECK (object_type = 'reminder'),
  CONSTRAINT reminders_status_valid
    CHECK (status IN ('pending', 'triggered', 'dismissed', 'cancelled'))
);

CREATE TABLE documents (
  object_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  object_type text NOT NULL DEFAULT 'document',
  storage_provider text NOT NULL,
  storage_key text NOT NULL,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  checksum_sha256 text NOT NULL,
  encryption_mode text NOT NULL DEFAULT 'provider',
  CONSTRAINT documents_canonical_object_fk
    FOREIGN KEY (workspace_id, object_id, object_type)
    REFERENCES objects(workspace_id, id, object_type)
    ON DELETE RESTRICT,
  CONSTRAINT documents_object_type_valid
    CHECK (object_type = 'document'),
  CONSTRAINT documents_storage_provider_not_blank
    CHECK (btrim(storage_provider) <> ''),
  CONSTRAINT documents_storage_key_not_blank
    CHECK (btrim(storage_key) <> ''),
  CONSTRAINT documents_original_filename_not_blank
    CHECK (btrim(original_filename) <> ''),
  CONSTRAINT documents_mime_type_not_blank
    CHECK (btrim(mime_type) <> ''),
  CONSTRAINT documents_size_nonnegative
    CHECK (size_bytes >= 0),
  CONSTRAINT documents_checksum_valid
    CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT documents_encryption_mode_not_blank
    CHECK (btrim(encryption_mode) <> ''),
  CONSTRAINT documents_storage_key_unique
    UNIQUE (storage_provider, storage_key)
);

CREATE INDEX objects_workspace_type_active_idx
  ON objects (workspace_id, object_type, deleted_at);

CREATE INDEX objects_permission_scope_active_idx
  ON objects (workspace_id, permission_scope_id, deleted_at);

CREATE INDEX object_relations_source_idx
  ON object_relations (workspace_id, source_object_id, relation_type, deleted_at);

CREATE INDEX object_relations_target_idx
  ON object_relations (workspace_id, target_object_id, relation_type, deleted_at);

CREATE INDEX resource_grants_resource_principal_idx
  ON resource_grants (
    workspace_id,
    resource_id,
    principal_type,
    principal_id
  );

CREATE INDEX resource_grants_expiry_idx
  ON resource_grants (workspace_id, expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX audit_events_workspace_created_idx
  ON audit_events (workspace_id, created_at DESC);

CREATE INDEX audit_events_resource_created_idx
  ON audit_events (workspace_id, resource_id, created_at DESC)
  WHERE resource_id IS NOT NULL;

CREATE INDEX events_workspace_start_idx
  ON events (workspace_id, starts_at)
  WHERE starts_at IS NOT NULL;

CREATE INDEX tasks_workspace_due_idx
  ON tasks (workspace_id, due_at)
  WHERE due_at IS NOT NULL;

CREATE INDEX expenses_workspace_occurred_idx
  ON expenses (workspace_id, occurred_at DESC);

CREATE INDEX reminders_workspace_due_idx
  ON reminders (workspace_id, status, remind_at);
