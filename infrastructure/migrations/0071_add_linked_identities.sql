-- One Chronelle user may sign in through several external providers. The
-- provider/subject pair is canonical here; the two legacy columns on users
-- remain only for rolling compatibility with an API version deployed before
-- this migration.
CREATE TABLE user_identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  subject text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT user_identities_provider_not_blank CHECK (btrim(provider) <> ''),
  CONSTRAINT user_identities_subject_not_blank CHECK (btrim(subject) <> ''),
  CONSTRAINT user_identities_provider_subject_unique UNIQUE (provider, subject),
  CONSTRAINT user_identities_user_provider_unique UNIQUE (user_id, provider)
);

INSERT INTO user_identities (id, user_id, provider, subject, created_at, last_used_at)
SELECT chronelle_uuidv7(), id, identity_provider, provider_subject, created_at, updated_at
FROM users;

-- An external bearer proof is consumed once. Only its SHA-256 digest is
-- retained; expires_at indexes future bounded-retention cleanup.
CREATE TABLE identity_exchanges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  proof_hash text NOT NULL,
  purpose text NOT NULL,
  consumed_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at timestamptz(3) NOT NULL,
  CONSTRAINT identity_exchanges_provider_not_blank CHECK (btrim(provider) <> ''),
  CONSTRAINT identity_exchanges_proof_hash_sha256 CHECK (proof_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT identity_exchanges_purpose_valid CHECK (purpose IN ('sign_in', 'link')),
  CONSTRAINT identity_exchanges_expiry_valid CHECK (expires_at > consumed_at),
  CONSTRAINT identity_exchanges_provider_proof_unique UNIQUE (provider, proof_hash)
);

CREATE INDEX identity_exchanges_expiry_idx ON identity_exchanges (expires_at);

-- Existing sign-in paths now resolve and touch the normalized identity. A new
-- account still fills the legacy columns so an old API can run during a
-- rolling deployment; every current lookup is through user_identities.
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
  SELECT u.* INTO signed_in FROM user_identities i
  JOIN users u ON u.id = i.user_id
  WHERE i.provider = identity_provider AND i.subject = provider_subject;

  FOR attempt IN 1..3 LOOP
    EXIT WHEN signed_in.id IS NOT NULL;
    INSERT INTO users (id, identity_provider, provider_subject, email, display_name, username, onboarded_at)
    VALUES (chronelle_uuidv7(), identity_provider, provider_subject, email, display_name,
            chronelle_username_assign(display_name, username),
            CASE WHEN identity_provider = 'password' THEN NULL ELSE now() END)
    ON CONFLICT DO NOTHING
    RETURNING * INTO signed_in;
    IF signed_in.id IS NOT NULL THEN
      INSERT INTO user_identities (id, user_id, provider, subject)
      VALUES (chronelle_uuidv7(), signed_in.id, identity_provider, provider_subject)
      ON CONFLICT ON CONSTRAINT user_identities_provider_subject_unique DO NOTHING;
    ELSE
      SELECT u.* INTO signed_in FROM user_identities i
      JOIN users u ON u.id = i.user_id
      WHERE i.provider = identity_provider AND i.subject = provider_subject;
    END IF;
  END LOOP;
  IF signed_in.id IS NULL THEN
    RAISE EXCEPTION 'Identity persistence did not return a user.' USING ERRCODE = 'PT500';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_identities i
    WHERE i.user_id = signed_in.id AND i.provider = identity_provider AND i.subject = provider_subject
  ) THEN
    RAISE EXCEPTION 'Identity persistence did not link the user.' USING ERRCODE = 'PT500';
  END IF;
  UPDATE user_identities i SET last_used_at = GREATEST(now(), i.created_at)
  WHERE i.user_id = signed_in.id AND i.provider = identity_provider AND i.subject = provider_subject;

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

-- A durable Chronelle session already proves the user id. Workspace
-- resolution no longer converts that user back into one arbitrarily chosen
-- external identity.
CREATE FUNCTION chronelle_user_session_resolve(
  user_id uuid,
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
  SELECT * INTO signed_in FROM users u WHERE u.id = user_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT w.id INTO personal_id FROM workspaces w
  WHERE w.personal_owner_id = signed_in.id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  requested_id := coalesce(requested_workspace_id, personal_id);
  IF object_id IS NOT NULL THEN
    SELECT o.workspace_id INTO object_workspace_id FROM objects o WHERE o.id = object_id;
  END IF;

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

CREATE OR REPLACE FUNCTION chronelle_identity_session_resolve(
  identity_provider text,
  provider_subject text,
  requested_workspace_id uuid,
  object_id uuid,
  observed_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  linked_user_id uuid;
BEGIN
  SELECT i.user_id INTO linked_user_id FROM user_identities i
  WHERE i.provider = identity_provider AND i.subject = provider_subject;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN chronelle_user_session_resolve(
    linked_user_id,
    requested_workspace_id,
    object_id,
    observed_at
  );
END
$$;

CREATE OR REPLACE FUNCTION chronelle_password_credential_lookup(login text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  owner users%ROWTYPE;
  credential user_credentials%ROWTYPE;
BEGIN
  IF position('@' IN login) > 0 THEN
    SELECT u.* INTO owner FROM user_identities i
    JOIN users u ON u.id = i.user_id
    WHERE i.provider = 'password' AND i.subject = login;
  ELSE
    SELECT u.* INTO owner FROM users u
    JOIN user_identities i ON i.user_id = u.id AND i.provider = 'password'
    WHERE lower(u.username) = lower(login);
  END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO credential FROM user_credentials c WHERE c.user_id = owner.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('user', to_jsonb(owner), 'credential', to_jsonb(credential));
END
$$;

-- A verified CloudBase proof becomes one Chronelle session atomically. An
-- unlinked identity and a reused, invalid, or expired proof intentionally
-- share the same failure.
CREATE FUNCTION chronelle_wechat_exchange(
  identity_provider text,
  provider_subject text,
  proof_hash text,
  proof_expires_at timestamptz,
  session_token_hash text,
  session_expires_at timestamptz,
  observed_at timestamptz,
  request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  signed_in users%ROWTYPE;
  personal workspaces%ROWTYPE;
  created_session user_sessions%ROWTYPE;
  consumed identity_exchanges%ROWTYPE;
BEGIN
  IF proof_expires_at <= observed_at OR session_expires_at <= observed_at THEN
    RAISE EXCEPTION 'The identity proof is unavailable.' USING ERRCODE = 'PT401';
  END IF;

  SELECT u.* INTO signed_in FROM user_identities i
  JOIN users u ON u.id = i.user_id
  WHERE i.provider = identity_provider AND i.subject = provider_subject
  FOR UPDATE OF i;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The identity proof is unavailable.' USING ERRCODE = 'PT401';
  END IF;

  INSERT INTO identity_exchanges (id, user_id, provider, proof_hash, purpose, consumed_at, expires_at)
  VALUES (chronelle_uuidv7(), signed_in.id, identity_provider, proof_hash, 'sign_in', observed_at, proof_expires_at)
  ON CONFLICT ON CONSTRAINT identity_exchanges_provider_proof_unique DO NOTHING
  RETURNING * INTO consumed;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The identity proof is unavailable.' USING ERRCODE = 'PT401';
  END IF;

  SELECT * INTO personal FROM workspaces w WHERE w.personal_owner_id = signed_in.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The identity proof is unavailable.' USING ERRCODE = 'PT401';
  END IF;

  INSERT INTO user_sessions (id, user_id, token_hash, identity_provider, expires_at)
  VALUES (chronelle_uuidv7(), signed_in.id, session_token_hash, identity_provider, session_expires_at)
  RETURNING * INTO created_session;
  UPDATE user_identities i SET last_used_at = GREATEST(observed_at, i.created_at)
  WHERE i.user_id = signed_in.id AND i.provider = identity_provider AND i.subject = provider_subject;

  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), personal.id, 'user', signed_in.id,
          'identity.wechat_signed_in', NULL, request_id,
          jsonb_build_object('identityProvider', identity_provider, 'sessionId', created_session.id::text));

  RETURN jsonb_build_object('user', to_jsonb(signed_in), 'workspace', to_jsonb(personal));
END
$$;

-- Linking is explicit and authenticated by an existing Chronelle session.
-- Neither email nor display name participates in the decision.
CREATE FUNCTION chronelle_wechat_identity_link(
  user_id uuid,
  identity_provider text,
  provider_subject text,
  proof_hash text,
  proof_expires_at timestamptz,
  observed_at timestamptz,
  request_id uuid
)
RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  personal_id uuid;
  existing_user_id uuid;
  existing_subject text;
  consumed identity_exchanges%ROWTYPE;
BEGIN
  IF proof_expires_at <= observed_at THEN
    RAISE EXCEPTION 'The identity proof is unavailable.' USING ERRCODE = 'PT401';
  END IF;
  SELECT w.id INTO personal_id FROM workspaces w WHERE w.personal_owner_id = user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The identity proof is unavailable.' USING ERRCODE = 'PT401';
  END IF;

  INSERT INTO identity_exchanges (id, user_id, provider, proof_hash, purpose, consumed_at, expires_at)
  VALUES (chronelle_uuidv7(), user_id, identity_provider, proof_hash, 'link', observed_at, proof_expires_at)
  ON CONFLICT ON CONSTRAINT identity_exchanges_provider_proof_unique DO NOTHING
  RETURNING * INTO consumed;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The identity proof is unavailable.' USING ERRCODE = 'PT401';
  END IF;

  INSERT INTO user_identities (id, user_id, provider, subject, last_used_at)
  VALUES (chronelle_uuidv7(), user_id, identity_provider, provider_subject, observed_at)
  ON CONFLICT DO NOTHING;

  SELECT i.user_id INTO existing_user_id FROM user_identities i
  WHERE i.provider = identity_provider AND i.subject = provider_subject;
  IF NOT FOUND OR existing_user_id <> user_id THEN
    RAISE EXCEPTION 'The identity proof is unavailable.' USING ERRCODE = 'PT401';
  END IF;
  SELECT i.subject INTO existing_subject FROM user_identities i
  WHERE i.user_id = user_id AND i.provider = identity_provider;
  IF NOT FOUND OR existing_subject <> provider_subject THEN
    RAISE EXCEPTION 'The identity proof is unavailable.' USING ERRCODE = 'PT401';
  END IF;
  UPDATE user_identities i SET last_used_at = GREATEST(observed_at, i.created_at)
  WHERE i.user_id = user_id AND i.provider = identity_provider AND i.subject = provider_subject;

  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), personal_id, 'user', user_id,
          'identity.linked', NULL, request_id,
          jsonb_build_object('identityProvider', identity_provider));
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION chronelle_user_session_resolve(uuid, uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_wechat_exchange(text, text, text, timestamptz, text, timestamptz, timestamptz, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_wechat_identity_link(uuid, text, text, text, timestamptz, timestamptz, uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION chronelle_user_session_resolve(uuid, uuid, uuid, timestamptz) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION chronelle_wechat_exchange(text, text, text, timestamptz, text, timestamptz, timestamptz, uuid) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION chronelle_wechat_identity_link(uuid, text, text, text, timestamptz, timestamptz, uuid) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION chronelle_user_session_resolve(uuid, uuid, uuid, timestamptz) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION chronelle_wechat_exchange(text, text, text, timestamptz, text, timestamptz, timestamptz, uuid) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION chronelle_wechat_identity_link(uuid, text, text, text, timestamptz, timestamptz, uuid) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION chronelle_user_session_resolve(uuid, uuid, uuid, timestamptz) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION chronelle_wechat_exchange(text, text, text, timestamptz, text, timestamptz, timestamptz, uuid) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION chronelle_wechat_identity_link(uuid, text, text, text, timestamptz, timestamptz, uuid) TO service_role';
  END IF;
END
$$;
