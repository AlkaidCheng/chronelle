-- A revocation instant earlier than the session's creation (an API clock
-- slightly behind the database's) is recorded as the creation instant, so a
-- sign-out immediately after sign-in cannot fail the
-- user_sessions_revoked_after_creation constraint.
CREATE OR REPLACE FUNCTION chronelle_session_revoke(
  token_hash text,
  revoked_at timestamptz,
  request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  revoked user_sessions%ROWTYPE;
BEGIN
  UPDATE user_sessions s SET revoked_at = GREATEST(revoked_at, s.created_at)
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

CREATE OR REPLACE FUNCTION chronelle_sessions_revoke_all(
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
    UPDATE user_sessions s SET revoked_at = GREATEST(revoked_at, s.created_at)
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
