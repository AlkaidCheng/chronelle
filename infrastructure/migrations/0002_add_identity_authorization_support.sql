ALTER TABLE workspaces
  ADD COLUMN personal_owner_id uuid;

ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_personal_owner_fk
    FOREIGN KEY (personal_owner_id)
    REFERENCES users(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT workspaces_personal_owner_unique
    UNIQUE (personal_owner_id),
  ADD CONSTRAINT workspaces_personal_owner_is_creator
    CHECK (personal_owner_id IS NULL OR personal_owner_id = created_by);

CREATE INDEX resource_grants_principal_workspace_idx
  ON resource_grants (
    principal_type,
    principal_id,
    workspace_id,
    expires_at
  );
