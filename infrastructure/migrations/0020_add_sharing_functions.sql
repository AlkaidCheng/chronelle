-- Sharing and permission-scope changes as database functions: granting a
-- role to a user by email, revoking a grant, and moving an object to another
-- canonical scope. Each call applies the service's authorization, the state
-- rules, the audit event, and (for the scope change) the revision snapshot in
-- one transaction.
--
-- Errors follow the service: PT403 unavailable, PT404 unknown or ambiguous
-- principal, PT400 invalid share, PT409 stale version, PT422 invalid scope
-- change, PT500 missing revision baseline.

-- Share is an Owner action on a live object, like delete.
CREATE FUNCTION chronelle_can_share(workspace_id uuid, user_id uuid, object_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT chronelle_can_delete($1, $2, $3);
$$;

-- ResourceGrantService.share(): one grant per (resource, principal), refreshed
-- in place; the acting user cannot be the grantee. Returns the grant row with
-- the principal's id, display name, and email.
CREATE FUNCTION chronelle_resource_share(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  resource_id uuid,
  principal_email text,
  role text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  principal users%ROWTYPE;
  principal_count integer;
  grant_row resource_grants%ROWTYPE;
BEGIN
  IF NOT chronelle_can_share(workspace_id, user_id, resource_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT count(*) INTO principal_count FROM users u WHERE u.email = principal_email;
  IF principal_count <> 1 THEN
    RAISE EXCEPTION 'The requested user is unavailable.' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO principal FROM users u WHERE u.email = principal_email;
  IF principal.id = user_id THEN
    RAISE EXCEPTION 'A resource cannot be shared with the acting user.' USING ERRCODE = 'PT400';
  END IF;
  IF role NOT IN ('owner', 'editor', 'viewer') THEN
    RAISE EXCEPTION 'role must be owner, editor, or viewer.' USING ERRCODE = 'PT422';
  END IF;

  INSERT INTO resource_grants (id, workspace_id, resource_id, principal_type, principal_id, role, granted_by)
  VALUES (chronelle_uuidv7(), workspace_id, resource_id, 'user', principal.id, role, user_id)
  ON CONFLICT ON CONSTRAINT resource_grants_principal_unique
  DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, expires_at = NULL
  RETURNING * INTO grant_row;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), workspace_id, 'user', user_id, 'resource.shared', resource_id, request_id,
          jsonb_build_object('grantId', grant_row.id::text, 'principalId', principal.id::text, 'role', grant_row.role));
  RETURN to_jsonb(grant_row) || jsonb_build_object(
    'principal', jsonb_build_object('id', principal.id::text, 'displayName', principal.display_name, 'email', principal.email)
  );
END
$$;

-- ResourceGrantService.revoke(): the grant must exist on a live workspace
-- object and the caller must be an Owner of that object, tombstones
-- included. Returns {id, revokedAt} with the caller's instant.
CREATE FUNCTION chronelle_resource_share_revoke(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  grant_id uuid,
  revoked_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  grant_row resource_grants%ROWTYPE;
BEGIN
  SELECT g.* INTO grant_row FROM resource_grants g
  JOIN objects o ON o.workspace_id = g.workspace_id AND o.id = g.resource_id
  WHERE g.workspace_id = workspace_id AND g.id = grant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF NOT chronelle_can_recover(workspace_id, user_id, grant_row.resource_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  DELETE FROM resource_grants g WHERE g.workspace_id = workspace_id AND g.id = grant_id;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), workspace_id, 'user', user_id, 'resource.share_revoked', grant_row.resource_id, request_id,
          jsonb_build_object('grantId', grant_id::text));
  RETURN jsonb_build_object('id', grant_id::text, 'revokedAt', chronelle_iso(revoked_at));
END
$$;

-- EventPlanningObjectService.updatePermissionScope(): an Owner of the object
-- moves it to itself or to a self-scoped Event they can share, under the
-- version predicate, with the permission_scope_updated revision. Returns
-- the object's rows.
CREATE FUNCTION chronelle_object_scope_update(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_id uuid,
  expected_version integer,
  permission_scope_id uuid,
  updated_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  current_object objects%ROWTYPE;
  scope objects%ROWTYPE;
  saved objects%ROWTYPE;
  audit_id uuid := chronelle_uuidv7();
  written_at timestamptz := now();
BEGIN
  IF NOT chronelle_can_share(workspace_id, user_id, object_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT * INTO current_object FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = object_id
  FOR UPDATE;
  IF current_object.version <> expected_version THEN
    RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
  END IF;
  IF current_object.permission_scope_id = permission_scope_id THEN
    RAISE EXCEPTION 'permissionScopeId must change the current permission scope.' USING ERRCODE = 'PT422';
  END IF;
  IF permission_scope_id <> object_id THEN
    IF NOT chronelle_can_share(workspace_id, user_id, permission_scope_id) THEN
      RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
    END IF;
    SELECT * INTO scope FROM objects o
    WHERE o.workspace_id = workspace_id AND o.id = permission_scope_id;
    IF scope.object_type <> 'event' OR scope.permission_scope_id <> scope.id THEN
      RAISE EXCEPTION 'permissionScopeId must reference a self-scoped Event.' USING ERRCODE = 'PT422';
    END IF;
  END IF;

  UPDATE objects o
  SET permission_scope_id = permission_scope_id, updated_at = updated_at, version = o.version + 1
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
  VALUES (audit_id, workspace_id, 'user', user_id, 'object.permission_scope_updated', object_id, request_id,
          jsonb_build_object('permissionScopeId', permission_scope_id::text,
                             'previousPermissionScopeId', current_object.permission_scope_id::text,
                             'previousVersion', expected_version, 'version', saved.version), written_at);
  INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
  VALUES (chronelle_uuidv7(), workspace_id, object_id, saved.version, 'permission_scope_updated', NULL,
          'user', user_id, request_id, audit_id, 1, chronelle_object_snapshot(workspace_id, object_id), written_at);
  RETURN chronelle_object_rows(workspace_id, object_id);
END
$$;
