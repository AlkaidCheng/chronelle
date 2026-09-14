-- Password credentials and emailed verification codes. A password account is
-- a user whose identity provider is 'password' and whose subject is the
-- normalized email; user_credentials holds the hash (computed and checked by
-- the API, never here), the email verification, and the failed-attempt lock.
-- email_verifications holds the digest of each emailed code with its purpose,
-- expiry, attempt count, and consumption. Clocks carry millisecond precision
-- like user_sessions. The functions serve the CloudBase rpc path with the
-- same semantics as the PostgreSQL credential store.
CREATE TABLE user_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  email_verified_at timestamptz(3),
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT user_credentials_password_hash_not_blank
    CHECK (btrim(password_hash) <> ''),
  CONSTRAINT user_credentials_failed_attempts_nonnegative
    CHECK (failed_attempts >= 0),
  CONSTRAINT user_credentials_updated_after_creation
    CHECK (updated_at >= created_at)
);

CREATE TABLE email_verifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at timestamptz(3) NOT NULL,
  consumed_at timestamptz(3),
  CONSTRAINT email_verifications_purpose_valid
    CHECK (purpose IN ('verify_email', 'reset_password')),
  CONSTRAINT email_verifications_code_hash_sha256
    CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT email_verifications_attempts_nonnegative
    CHECK (attempts >= 0),
  CONSTRAINT email_verifications_expires_after_creation
    CHECK (expires_at > created_at),
  CONSTRAINT email_verifications_consumed_after_creation
    CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX email_verifications_open_idx
  ON email_verifications (user_id, purpose)
  WHERE consumed_at IS NULL;

-- Records the password credential of an existing user. Raises PT404 when the
-- user does not exist and PT409 when the user already has one.
CREATE FUNCTION chronelle_password_credential_create(
  user_id uuid,
  password_hash text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  created user_credentials%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = user_id) THEN
    RAISE EXCEPTION 'The user does not exist.' USING ERRCODE = 'PT404';
  END IF;
  INSERT INTO user_credentials (user_id, password_hash)
  VALUES (user_id, password_hash)
  ON CONFLICT ON CONSTRAINT user_credentials_pkey DO NOTHING
  RETURNING * INTO created;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The user already has a password credential.' USING ERRCODE = 'PT409';
  END IF;
  RETURN to_jsonb(created);
END
$$;

-- The password account for a normalized email: {user, credential}, or NULL
-- when no user with the password provider has that subject or the user has
-- no credential.
CREATE FUNCTION chronelle_password_credential_lookup(email text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  owner users%ROWTYPE;
  credential user_credentials%ROWTYPE;
BEGIN
  SELECT * INTO owner FROM users u
  WHERE u.identity_provider = 'password' AND u.provider_subject = email;
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

-- Records the outcome of a password check: success clears the failures and
-- any lock; a failure counts, and the max_attempts-th failure locks the
-- credential for lock_seconds and restarts the count. Returns the credential.
CREATE FUNCTION chronelle_password_attempt_record(
  user_id uuid,
  succeeded boolean,
  observed_at timestamptz,
  max_attempts integer,
  lock_seconds integer
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  updated user_credentials%ROWTYPE;
BEGIN
  IF succeeded THEN
    UPDATE user_credentials c
    SET failed_attempts = 0, locked_until = NULL, updated_at = GREATEST(observed_at, c.created_at)
    WHERE c.user_id = user_id
    RETURNING * INTO updated;
  ELSE
    UPDATE user_credentials c
    SET failed_attempts = CASE WHEN c.failed_attempts + 1 >= max_attempts THEN 0 ELSE c.failed_attempts + 1 END,
        locked_until = CASE WHEN c.failed_attempts + 1 >= max_attempts
                            THEN observed_at + make_interval(secs => lock_seconds)
                            ELSE c.locked_until END,
        updated_at = GREATEST(observed_at, c.created_at)
    WHERE c.user_id = user_id
    RETURNING * INTO updated;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The credential does not exist.' USING ERRCODE = 'PT404';
  END IF;
  RETURN to_jsonb(updated);
END
$$;

-- Marks the email of a password account verified and records
-- credential.email_verified in the personal workspace. Returns the credential.
CREATE FUNCTION chronelle_email_verified(
  user_id uuid,
  verified_at timestamptz,
  request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  updated user_credentials%ROWTYPE;
BEGIN
  UPDATE user_credentials c
  SET email_verified_at = COALESCE(c.email_verified_at, GREATEST(verified_at, c.created_at)),
      updated_at = GREATEST(verified_at, c.created_at)
  WHERE c.user_id = user_id
  RETURNING * INTO updated;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The credential does not exist.' USING ERRCODE = 'PT404';
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  SELECT chronelle_uuidv7(), w.id, 'user', user_id, 'credential.email_verified', NULL, request_id, '{}'::jsonb
  FROM workspaces w WHERE w.personal_owner_id = user_id;
  RETURN to_jsonb(updated);
END
$$;

-- Replaces the password hash after a reset, clears the failure lock, and
-- records credential.password_reset. Returns the credential.
CREATE FUNCTION chronelle_password_hash_update(
  user_id uuid,
  password_hash text,
  updated_at timestamptz,
  request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  updated user_credentials%ROWTYPE;
BEGIN
  UPDATE user_credentials c
  SET password_hash = password_hash, failed_attempts = 0, locked_until = NULL,
      updated_at = GREATEST(updated_at, c.created_at)
  WHERE c.user_id = user_id
  RETURNING * INTO updated;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The credential does not exist.' USING ERRCODE = 'PT404';
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  SELECT chronelle_uuidv7(), w.id, 'user', user_id, 'credential.password_reset', NULL, request_id, '{}'::jsonb
  FROM workspaces w WHERE w.personal_owner_id = user_id;
  RETURN to_jsonb(updated);
END
$$;

-- Issues a verification code for a purpose, ending any open code of the same
-- purpose for the user. Returns the new row.
CREATE FUNCTION chronelle_verification_issue(
  user_id uuid,
  purpose text,
  code_hash text,
  expires_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  issued email_verifications%ROWTYPE;
  issued_at timestamptz := now();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = user_id) THEN
    RAISE EXCEPTION 'The user does not exist.' USING ERRCODE = 'PT404';
  END IF;
  UPDATE email_verifications v SET consumed_at = GREATEST(issued_at, v.created_at)
  WHERE v.user_id = user_id AND v.purpose = purpose AND v.consumed_at IS NULL;
  INSERT INTO email_verifications (id, user_id, purpose, code_hash, created_at, expires_at)
  VALUES (chronelle_uuidv7(), user_id, purpose, code_hash, issued_at, expires_at)
  RETURNING * INTO issued;
  RETURN to_jsonb(issued);
END
$$;

-- Consumes the open code of a purpose when the digest matches. Returns
-- {status}: 'consumed', 'mismatch' (the attempt is counted), 'exhausted'
-- (max_attempts failures already), 'expired', or 'none'.
CREATE FUNCTION chronelle_verification_consume(
  user_id uuid,
  purpose text,
  code_hash text,
  observed_at timestamptz,
  max_attempts integer
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  open email_verifications%ROWTYPE;
BEGIN
  SELECT * INTO open FROM email_verifications v
  WHERE v.user_id = user_id AND v.purpose = purpose AND v.consumed_at IS NULL
  ORDER BY v.created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;
  IF open.expires_at <= observed_at THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;
  IF open.attempts >= max_attempts THEN
    RETURN jsonb_build_object('status', 'exhausted');
  END IF;
  IF open.code_hash <> code_hash THEN
    UPDATE email_verifications v SET attempts = v.attempts + 1 WHERE v.id = open.id;
    RETURN jsonb_build_object('status', 'mismatch');
  END IF;
  UPDATE email_verifications v SET consumed_at = GREATEST(observed_at, v.created_at) WHERE v.id = open.id;
  RETURN jsonb_build_object('status', 'consumed');
END
$$;
