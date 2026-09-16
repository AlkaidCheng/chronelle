-- A share may name a Person of the workspace instead of an account email:
-- the person's linked account receives the role, else the one account whose
-- email is the person's. chronelle_resource_share (migration 0020) is
-- redefined with the grantee as either argument; the email path, the grant,
-- and the audit event are unchanged, and a share by person records the
-- person in the audit metadata.
--
-- Errors follow the service: PT403 unavailable, PT404 unknown or ambiguous
-- principal (also a person the caller cannot view or with no reachable
-- account), PT400 invalid share.
DROP FUNCTION chronelle_resource_share(uuid, uuid, uuid, uuid, text, text);

CREATE FUNCTION chronelle_resource_share(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  resource_id uuid,
  role text,
  principal_email text DEFAULT NULL,
  person_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  person_row persons%ROWTYPE;
  grantee_email text := principal_email;
  principal users%ROWTYPE;
  principal_count integer;
  grant_row resource_grants%ROWTYPE;
BEGIN
  IF NOT chronelle_can_share(workspace_id, user_id, resource_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF (principal_email IS NULL) = (person_id IS NULL) THEN
    RAISE EXCEPTION 'Name exactly one of principalEmail and personId.' USING ERRCODE = 'PT400';
  END IF;
  IF person_id IS NOT NULL THEN
    SELECT p.* INTO person_row FROM persons p
    WHERE p.workspace_id = workspace_id AND p.object_id = person_id
      AND chronelle_can_view(workspace_id, user_id, person_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The requested user is unavailable.' USING ERRCODE = 'PT404';
    END IF;
    IF person_row.user_id IS NOT NULL THEN
      SELECT * INTO principal FROM users u WHERE u.id = person_row.user_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'The requested user is unavailable.' USING ERRCODE = 'PT404';
      END IF;
    ELSIF person_row.email IS NOT NULL THEN
      grantee_email := lower(person_row.email);
    ELSE
      RAISE EXCEPTION 'The requested user is unavailable.' USING ERRCODE = 'PT404';
    END IF;
  END IF;
  IF principal.id IS NULL THEN
    SELECT count(*) INTO principal_count FROM users u WHERE u.email = grantee_email;
    IF principal_count <> 1 THEN
      RAISE EXCEPTION 'The requested user is unavailable.' USING ERRCODE = 'PT404';
    END IF;
    SELECT * INTO principal FROM users u WHERE u.email = grantee_email;
  END IF;
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
          jsonb_build_object('grantId', grant_row.id::text, 'principalId', principal.id::text, 'role', grant_row.role)
            || CASE WHEN person_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('personId', person_id::text) END);
  RETURN to_jsonb(grant_row) || jsonb_build_object(
    'principal', jsonb_build_object('id', principal.id::text, 'displayName', principal.display_name, 'email', principal.email)
  );
END
$$;
