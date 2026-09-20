-- Resolve an authenticated identity's workspace in one gateway request.
-- Membership and active grants admit a workspace, not its individual
-- resources; resource authorization still runs on every protected operation.
CREATE FUNCTION chronelle_identity_session_resolve(
  identity_provider text,
  provider_subject text,
  requested_workspace_id uuid,
  object_id uuid,
  observed_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  signed_in users%ROWTYPE;
  personal_id uuid;
  requested_id uuid;
  object_workspace_id uuid;
  resolved workspaces%ROWTYPE;
BEGIN
  SELECT * INTO signed_in FROM users u
  WHERE u.identity_provider = identity_provider
    AND u.provider_subject = provider_subject;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT w.id INTO personal_id FROM workspaces w
  WHERE w.personal_owner_id = signed_in.id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  requested_id := coalesce(requested_workspace_id, personal_id);
  IF object_id IS NOT NULL THEN
    SELECT o.workspace_id INTO object_workspace_id FROM objects o
    WHERE o.id = object_id;
  END IF;

  -- A reachable object's workspace takes precedence over the requested
  -- workspace. An unknown or unreachable object leaves that choice alone.
  SELECT w.* INTO resolved FROM workspaces w
  WHERE w.id IN (requested_id, object_workspace_id)
    AND (
      EXISTS (
        SELECT 1 FROM workspace_members m
        WHERE m.workspace_id = w.id AND m.user_id = signed_in.id
      ) OR EXISTS (
        SELECT 1 FROM resource_grants g
        JOIN objects o ON o.id = g.resource_id AND o.workspace_id = g.workspace_id
        WHERE g.workspace_id = w.id
          AND g.principal_type = 'user' AND g.principal_id = signed_in.id
          AND (g.expires_at IS NULL OR g.expires_at > observed_at)
          AND (o.deleted_at IS NULL OR g.role = 'owner')
      )
    )
  ORDER BY CASE WHEN w.id = object_workspace_id THEN 0 ELSE 1 END
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The requested workspace is unavailable.' USING ERRCODE = 'PT404';
  END IF;

  RETURN jsonb_build_object('user', to_jsonb(signed_in), 'workspace', to_jsonb(resolved));
END
$$;
