-- Identity sign-in as a database function: the user for an authenticated
-- identity, their personal workspace, and their Owner membership of it,
-- created on first sign-in and left in place afterwards, with the audit
-- event WorkspaceIdentityService writes, all in one transaction. Returns
-- {user, workspace, createdWorkspace} with the two rows as the tables hold
-- them.
CREATE FUNCTION chronelle_identity_sign_in(
  identity_provider text,
  provider_subject text,
  email text,
  display_name text,
  request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  signed_in users%ROWTYPE;
  personal workspaces%ROWTYPE;
  created_workspace boolean := false;
BEGIN
  INSERT INTO users (id, identity_provider, provider_subject, email, display_name)
  VALUES (chronelle_uuidv7(), identity_provider, provider_subject, email, display_name)
  ON CONFLICT ON CONSTRAINT users_provider_identity_unique DO NOTHING
  RETURNING * INTO signed_in;
  IF NOT FOUND THEN
    SELECT * INTO signed_in FROM users u
    WHERE u.identity_provider = identity_provider AND u.provider_subject = provider_subject;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Identity persistence did not return a user.' USING ERRCODE = 'PT500';
    END IF;
  END IF;

  INSERT INTO workspaces (id, display_name, created_by, personal_owner_id)
  VALUES (chronelle_uuidv7(), signed_in.display_name || '''s workspace', signed_in.id, signed_in.id)
  ON CONFLICT ON CONSTRAINT workspaces_personal_owner_unique DO NOTHING
  RETURNING * INTO personal;
  IF FOUND THEN
    created_workspace := true;
  ELSE
    SELECT * INTO personal FROM workspaces w WHERE w.personal_owner_id = signed_in.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Identity persistence did not return a personal workspace.' USING ERRCODE = 'PT500';
    END IF;
  END IF;

  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (personal.id, signed_in.id, 'owner')
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner';

  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), personal.id, 'user', signed_in.id,
          CASE WHEN created_workspace THEN 'workspace.personal_created' ELSE 'identity.signed_in' END,
          NULL, request_id, jsonb_build_object('identityProvider', identity_provider));

  RETURN jsonb_build_object(
    'user', to_jsonb(signed_in),
    'workspace', to_jsonb(personal),
    'createdWorkspace', created_workspace);
END
$$;
