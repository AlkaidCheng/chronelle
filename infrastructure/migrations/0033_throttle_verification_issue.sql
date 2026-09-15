-- Verification codes are issued at most once per min_interval_seconds and
-- max_per_window times per window_seconds for a user and purpose, counting
-- every code issued in the window whether or not it was consumed. A refused
-- issue returns {throttled: true, retryAfterSeconds}; an accepted one returns
-- {throttled: false, verification} with the row, ending any open code of the
-- same purpose as before. The previous signature is dropped so the rpc
-- route resolves one function by parameter names.
DROP FUNCTION chronelle_verification_issue(uuid, text, text, timestamptz);

CREATE FUNCTION chronelle_verification_issue(
  user_id uuid,
  purpose text,
  code_hash text,
  expires_at timestamptz,
  min_interval_seconds integer DEFAULT 0,
  window_seconds integer DEFAULT 0,
  max_per_window integer DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  issued email_verifications%ROWTYPE;
  issued_at timestamptz := now();
  latest timestamptz;
  recent integer;
  retry_after integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = user_id) THEN
    RAISE EXCEPTION 'The user does not exist.' USING ERRCODE = 'PT404';
  END IF;
  IF min_interval_seconds > 0 THEN
    SELECT max(v.created_at) INTO latest FROM email_verifications v
    WHERE v.user_id = user_id AND v.purpose = purpose;
    IF latest IS NOT NULL
       AND latest + make_interval(secs => min_interval_seconds) > issued_at THEN
      retry_after := ceil(extract(epoch FROM latest + make_interval(secs => min_interval_seconds) - issued_at));
      RETURN jsonb_build_object('throttled', true, 'retryAfterSeconds', GREATEST(retry_after, 1));
    END IF;
  END IF;
  IF window_seconds > 0 AND max_per_window > 0 THEN
    SELECT count(*) INTO recent FROM email_verifications v
    WHERE v.user_id = user_id AND v.purpose = purpose
      AND v.created_at > issued_at - make_interval(secs => window_seconds);
    IF recent >= max_per_window THEN
      SELECT min(v.created_at) INTO latest FROM email_verifications v
      WHERE v.user_id = user_id AND v.purpose = purpose
        AND v.created_at > issued_at - make_interval(secs => window_seconds);
      retry_after := ceil(extract(epoch FROM latest + make_interval(secs => window_seconds) - issued_at));
      RETURN jsonb_build_object('throttled', true, 'retryAfterSeconds', GREATEST(retry_after, 1));
    END IF;
  END IF;
  UPDATE email_verifications v SET consumed_at = GREATEST(issued_at, v.created_at)
  WHERE v.user_id = user_id AND v.purpose = purpose AND v.consumed_at IS NULL;
  INSERT INTO email_verifications (id, user_id, purpose, code_hash, created_at, expires_at)
  VALUES (chronelle_uuidv7(), user_id, purpose, code_hash, issued_at, expires_at)
  RETURNING * INTO issued;
  RETURN jsonb_build_object('throttled', false, 'verification', to_jsonb(issued));
END
$$;
