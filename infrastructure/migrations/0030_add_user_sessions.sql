-- Durable sessions: one row per issued credential, holding only the SHA-256
-- digest of the opaque token, so a session survives an API restart, can be
-- revoked, and can be listed per user. The functions serve the CloudBase rpc
-- path with the same semantics as the PostgreSQL session store. The clocks
-- carry millisecond precision so that a comparison made in the API and one
-- made here agree on the same instants.
CREATE TABLE user_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  identity_provider text NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at timestamptz(3) NOT NULL,
  last_seen_at timestamptz(3) NOT NULL DEFAULT now(),
  revoked_at timestamptz(3),
  CONSTRAINT user_sessions_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT user_sessions_token_hash_sha256
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT user_sessions_identity_provider_not_blank
    CHECK (btrim(identity_provider) <> ''),
  CONSTRAINT user_sessions_expires_after_creation
    CHECK (expires_at > created_at),
  CONSTRAINT user_sessions_last_seen_after_creation
    CHECK (last_seen_at >= created_at),
  CONSTRAINT user_sessions_revoked_after_creation
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX user_sessions_user_active_idx
  ON user_sessions (user_id)
  WHERE revoked_at IS NULL;

-- Records a session for a user. Raises PT404 when the user does not exist.
CREATE FUNCTION chronelle_session_create(
  user_id uuid,
  token_hash text,
  identity_provider text,
  expires_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  created user_sessions%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = user_id) THEN
    RAISE EXCEPTION 'The user does not exist.' USING ERRCODE = 'PT404';
  END IF;
  INSERT INTO user_sessions (id, user_id, token_hash, identity_provider, expires_at)
  VALUES (chronelle_uuidv7(), user_id, token_hash, identity_provider, expires_at)
  RETURNING * INTO created;
  RETURN to_jsonb(created);
END
$$;

-- The session and its user for a token digest, or NULL when no live session
-- carries it (unknown, expired at observed_at, or revoked). A live session's
-- last_seen_at moves to observed_at once it is older than touch_after_seconds,
-- so a busy session is not rewritten on every request.
CREATE FUNCTION chronelle_session_resolve(
  token_hash text,
  observed_at timestamptz,
  touch_after_seconds integer
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  live user_sessions%ROWTYPE;
  owner users%ROWTYPE;
BEGIN
  SELECT * INTO live FROM user_sessions s
  WHERE s.token_hash = token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > observed_at;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF live.last_seen_at + make_interval(secs => touch_after_seconds) <= observed_at THEN
    UPDATE user_sessions s SET last_seen_at = observed_at
    WHERE s.id = live.id
    RETURNING * INTO live;
  END IF;
  SELECT * INTO owner FROM users u WHERE u.id = live.user_id;
  RETURN jsonb_build_object('session', to_jsonb(live), 'user', to_jsonb(owner));
END
$$;

-- Revokes the live session carrying a token digest and records
-- session.revoked in the user's personal workspace. Returns
-- {revoked: boolean}; an unknown, expired, or already revoked token revokes
-- nothing and records nothing.
CREATE FUNCTION chronelle_session_revoke(
  token_hash text,
  revoked_at timestamptz,
  request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  revoked user_sessions%ROWTYPE;
BEGIN
  UPDATE user_sessions s SET revoked_at = revoked_at
  WHERE s.token_hash = token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > revoked_at
  RETURNING * INTO revoked;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('revoked', false);
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  SELECT chronelle_uuidv7(), w.id, 'user', revoked.user_id, 'session.revoked', NULL, request_id,
         jsonb_build_object('sessionId', revoked.id, 'scope', 'current')
  FROM workspaces w WHERE w.personal_owner_id = revoked.user_id;
  RETURN jsonb_build_object('revoked', true);
END
$$;

-- Revokes every live session of a user and records one session.revoked
-- event with the count. Returns {revoked: integer}.
CREATE FUNCTION chronelle_sessions_revoke_all(
  user_id uuid,
  revoked_at timestamptz,
  request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  revoked_count integer;
BEGIN
  WITH revoked AS (
    UPDATE user_sessions s SET revoked_at = revoked_at
    WHERE s.user_id = user_id
      AND s.revoked_at IS NULL
      AND s.expires_at > revoked_at
    RETURNING s.id
  )
  SELECT count(*) INTO revoked_count FROM revoked;
  IF revoked_count > 0 THEN
    INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
    SELECT chronelle_uuidv7(), w.id, 'user', user_id, 'session.revoked', NULL, request_id,
           jsonb_build_object('scope', 'all', 'count', revoked_count)
    FROM workspaces w WHERE w.personal_owner_id = user_id;
  END IF;
  RETURN jsonb_build_object('revoked', revoked_count);
END
$$;
