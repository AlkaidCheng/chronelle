-- Creating an account asks for the email, the password, and the username;
-- the name and the display preferences are asked once, on the Welcome
-- step after the email is confirmed. `onboarded_at` records that step: null
-- while it is due. A password account is created without it and completes
-- it from the Welcome step through chronelle_account_update; an account
-- from any other provider brings its name and counts as completed at
-- creation, as does every account that exists today. Sign-in takes a
-- username as well as an email.
ALTER TABLE users ADD COLUMN onboarded_at timestamptz;
UPDATE users SET onboarded_at = created_at;

-- The sign-in creates the account with its username: the one sign-up
-- chose, else one from the name. A password account has the Welcome step
-- ahead; any other account counts as completed. An account that exists
-- keeps its own.
CREATE OR REPLACE FUNCTION chronelle_identity_sign_in(
  identity_provider text,
  provider_subject text,
  email text,
  display_name text,
  username text,
  request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  signed_in users%ROWTYPE;
  personal workspaces%ROWTYPE;
  created_workspace boolean := false;
  attempt integer;
BEGIN
  -- A concurrent first sign-in of the same identity, or of another taking
  -- the same username, conflicts on insert: the identity is read again,
  -- and a username taken meanwhile is assigned again.
  SELECT * INTO signed_in FROM users u
  WHERE u.identity_provider = identity_provider AND u.provider_subject = provider_subject;
  FOR attempt IN 1..3 LOOP
    EXIT WHEN signed_in.id IS NOT NULL;
    INSERT INTO users (id, identity_provider, provider_subject, email, display_name, username, onboarded_at)
    VALUES (chronelle_uuidv7(), identity_provider, provider_subject, email, display_name,
            chronelle_username_assign(display_name, username),
            CASE WHEN identity_provider = 'password' THEN NULL ELSE now() END)
    ON CONFLICT DO NOTHING
    RETURNING * INTO signed_in;
    IF NOT FOUND THEN
      SELECT * INTO signed_in FROM users u
      WHERE u.identity_provider = identity_provider AND u.provider_subject = provider_subject;
    END IF;
  END LOOP;
  IF signed_in.id IS NULL THEN
    RAISE EXCEPTION 'Identity persistence did not return a user.' USING ERRCODE = 'PT500';
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

-- Sets the name, the discovery switches, and the Welcome step's completion;
-- each key present in the patch replaces the stored value. The username is
-- not changed here: it is chosen once, at sign-up, and a change needs its
-- own flow. The account is returned as the next session read shows it.
CREATE OR REPLACE FUNCTION chronelle_account_update(user_id uuid, patch jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  updated users%ROWTYPE;
  name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = user_id) THEN
    RAISE EXCEPTION 'The user does not exist.' USING ERRCODE = 'PT404';
  END IF;
  IF patch ? 'username' THEN
    RAISE EXCEPTION 'The username cannot be changed.' USING ERRCODE = 'PT422';
  END IF;
  IF patch ? 'displayName' THEN
    IF jsonb_typeof(patch->'displayName') <> 'string' THEN
      RAISE EXCEPTION 'displayName is text.' USING ERRCODE = 'PT422';
    END IF;
    name := btrim(patch->>'displayName');
    IF name = '' OR length(name) > 120 THEN
      RAISE EXCEPTION 'displayName is 1 to 120 characters.' USING ERRCODE = 'PT422';
    END IF;
  END IF;
  IF (patch ? 'findByName' AND jsonb_typeof(patch->'findByName') <> 'boolean')
     OR (patch ? 'findByEmail' AND jsonb_typeof(patch->'findByEmail') <> 'boolean') THEN
    RAISE EXCEPTION 'A discovery switch is true or false.' USING ERRCODE = 'PT422';
  END IF;
  IF patch ? 'onboarded' AND (patch->'onboarded') <> 'true'::jsonb THEN
    RAISE EXCEPTION 'onboarded is true.' USING ERRCODE = 'PT422';
  END IF;
  UPDATE users u SET
    display_name = COALESCE(name, u.display_name),
    find_by_name = CASE WHEN patch ? 'findByName' THEN (patch->>'findByName')::boolean ELSE u.find_by_name END,
    find_by_email = CASE WHEN patch ? 'findByEmail' THEN (patch->>'findByEmail')::boolean ELSE u.find_by_email END,
    onboarded_at = CASE WHEN patch ? 'onboarded' THEN COALESCE(u.onboarded_at, now()) ELSE u.onboarded_at END,
    updated_at = now()
  WHERE u.id = user_id
  RETURNING * INTO updated;
  RETURN to_jsonb(updated);
END
$$;

-- The password account behind a sign-in: by email when the login holds an
-- "@", else by username without regard to case.
DROP FUNCTION chronelle_password_credential_lookup(text);
CREATE FUNCTION chronelle_password_credential_lookup(login text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  owner users%ROWTYPE;
  credential user_credentials%ROWTYPE;
BEGIN
  IF position('@' IN login) > 0 THEN
    SELECT * INTO owner FROM users u
    WHERE u.identity_provider = 'password' AND u.provider_subject = login;
  ELSE
    SELECT * INTO owner FROM users u
    WHERE u.identity_provider = 'password' AND lower(u.username) = lower(login);
  END IF;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO credential FROM user_credentials c WHERE c.user_id = owner.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('user', to_jsonb(owner), 'credential', to_jsonb(credential));
END
$$;
