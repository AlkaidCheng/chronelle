-- Friends belong to the account, not to a workspace: a connection is a
-- mutual link between two accounts, made by one inviting the other and the
-- other accepting. user_connections holds every request with its status;
-- user_invitations holds an invitation sent to an email that has no
-- account yet, with the digest of the token in the sign-up link, and is
-- consumed into a pending connection when that address signs up. Either
-- may carry the workspace Person the invitation was sent from, so the
-- requester's card can be linked to the new friend afterwards. Clocks
-- carry millisecond precision like user_sessions.
--
-- A Person's linked account may now be a friend of a workspace member as
-- well as a member: chronelle_assert_person_state (0037) is replaced in
-- place with that rule and the message the service uses.
--
-- The chronelle_friend_* functions serve the CloudBase rpc path with the
-- semantics of the PostgreSQL friend store: one live connection per pair,
-- one pending invitation per requester and address, a daily cap on
-- invitations, a resend interval, and every change audited in the actor's
-- personal workspace.
CREATE TABLE user_connections (
  id uuid PRIMARY KEY,
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  message text,
  person_id uuid REFERENCES persons(object_id) ON DELETE SET NULL,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  last_sent_at timestamptz(3) NOT NULL DEFAULT now(),
  responded_at timestamptz(3),
  CONSTRAINT user_connections_status_valid
    CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'removed')),
  CONSTRAINT user_connections_distinct_accounts
    CHECK (requester_id <> addressee_id),
  CONSTRAINT user_connections_message_trimmed
    CHECK (message IS NULL OR (message = btrim(message) AND message <> '' AND length(message) <= 500)),
  CONSTRAINT user_connections_person_in_workspace
    CHECK ((person_id IS NULL) = (workspace_id IS NULL)),
  CONSTRAINT user_connections_responded_after_creation
    CHECK (responded_at IS NULL OR responded_at >= created_at)
);
CREATE UNIQUE INDEX user_connections_live_pair_idx
  ON user_connections (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id))
  WHERE status IN ('pending', 'accepted');
CREATE INDEX user_connections_addressee_idx ON user_connections (addressee_id, status);
CREATE INDEX user_connections_requester_idx ON user_connections (requester_id, status);

CREATE TABLE user_invitations (
  id uuid PRIMARY KEY,
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  message text,
  person_id uuid REFERENCES persons(object_id) ON DELETE SET NULL,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  token_digest text NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  last_sent_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at timestamptz(3) NOT NULL,
  consumed_at timestamptz(3),
  consumed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT user_invitations_email_normalized
    CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254 AND position('@' IN email) >= 2),
  CONSTRAINT user_invitations_status_valid
    CHECK (status IN ('pending', 'consumed', 'withdrawn')),
  CONSTRAINT user_invitations_token_digest_sha256
    CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT user_invitations_message_trimmed
    CHECK (message IS NULL OR (message = btrim(message) AND message <> '' AND length(message) <= 500)),
  CONSTRAINT user_invitations_person_in_workspace
    CHECK ((person_id IS NULL) = (workspace_id IS NULL)),
  CONSTRAINT user_invitations_expires_after_creation
    CHECK (expires_at > created_at),
  CONSTRAINT user_invitations_consumed_together
    CHECK ((consumed_at IS NULL) = (consumed_by IS NULL))
);
CREATE UNIQUE INDEX user_invitations_pending_idx
  ON user_invitations (requester_id, email) WHERE status = 'pending';
CREATE UNIQUE INDEX user_invitations_token_idx ON user_invitations (token_digest);

-- A linked account is a member of the workspace or a friend of one, and
-- belongs to one person; an email is a trimmed address. The messages are
-- the service's.
CREATE OR REPLACE FUNCTION chronelle_assert_person_state(workspace_id uuid, object_id uuid, user_id uuid, email text)
RETURNS void LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
BEGIN
  IF user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE m.workspace_id = workspace_id AND m.user_id = user_id
    ) AND NOT EXISTS (
      SELECT 1 FROM user_connections c
      JOIN workspace_members m ON m.workspace_id = workspace_id
      WHERE c.status = 'accepted'
        AND ((c.requester_id = user_id AND c.addressee_id = m.user_id)
          OR (c.addressee_id = user_id AND c.requester_id = m.user_id))
    ) THEN
      RAISE EXCEPTION 'userId must name a member of this workspace or a friend of one.' USING ERRCODE = 'PT422';
    END IF;
    IF EXISTS (
      SELECT 1 FROM persons p
      WHERE p.workspace_id = workspace_id AND p.user_id = user_id AND p.object_id <> object_id
    ) THEN
      RAISE EXCEPTION 'userId is already linked to another person.' USING ERRCODE = 'PT422';
    END IF;
  END IF;
  IF email IS NOT NULL AND (
    email <> btrim(email) OR length(email) < 3 OR length(email) > 254 OR position('@' IN email) < 2
  ) THEN
    RAISE EXCEPTION 'email must be a valid address.' USING ERRCODE = 'PT422';
  END IF;
END
$$;

-- The personal workspace of an account, where its friend events are audited.
CREATE FUNCTION chronelle_friend_home_workspace(user_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  home uuid;
BEGIN
  SELECT w.id INTO home FROM workspaces w WHERE w.personal_owner_id = user_id;
  IF home IS NULL THEN
    RAISE EXCEPTION 'The user does not exist.' USING ERRCODE = 'PT404';
  END IF;
  RETURN home;
END
$$;

-- The address an account is reached at: its email, else the subject a
-- password or development account signed up with.
CREATE FUNCTION chronelle_friend_account_email(account users)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(COALESCE(account.email, account.provider_subject));
$$;

-- A connection as one side sees it: the other account by name and email,
-- the request's message, and when it was made and answered.
CREATE FUNCTION chronelle_friend_connection_json(connection user_connections, viewer_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  other users%ROWTYPE;
BEGIN
  SELECT * INTO other FROM users u
  WHERE u.id = CASE WHEN connection.requester_id = viewer_id THEN connection.addressee_id ELSE connection.requester_id END;
  RETURN jsonb_build_object(
    'id', connection.id::text,
    'status', connection.status,
    'direction', CASE WHEN connection.requester_id = viewer_id THEN 'sent' ELSE 'received' END,
    'userId', other.id::text,
    'displayName', other.display_name,
    'email', chronelle_friend_account_email(other),
    'message', connection.message,
    'personId', connection.person_id::text,
    'workspaceId', connection.workspace_id::text,
    'createdAt', to_jsonb(connection.created_at),
    'respondedAt', to_jsonb(connection.responded_at)
  );
END
$$;

CREATE FUNCTION chronelle_friend_invitation_json(invitation user_invitations)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'id', invitation.id::text,
    'status', invitation.status,
    'email', invitation.email,
    'message', invitation.message,
    'personId', invitation.person_id::text,
    'workspaceId', invitation.workspace_id::text,
    'createdAt', to_jsonb(invitation.created_at),
    'expiresAt', to_jsonb(invitation.expires_at)
  );
$$;

-- Everything one account sees on its Friends page: accepted connections by
-- name, pending requests addressed to it newest first, and what it has sent
-- (pending connections and unexpired pending invitations) newest first.
CREATE FUNCTION chronelle_friend_list(user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  friends jsonb;
  incoming jsonb;
  sent jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = user_id) THEN
    RAISE EXCEPTION 'The user does not exist.' USING ERRCODE = 'PT404';
  END IF;
  SELECT COALESCE(jsonb_agg(item ORDER BY item->>'displayName', item->>'id'), '[]'::jsonb) INTO friends
  FROM (
    SELECT chronelle_friend_connection_json(c, user_id) AS item
    FROM user_connections c
    WHERE c.status = 'accepted' AND (c.requester_id = user_id OR c.addressee_id = user_id)
  ) accepted;
  SELECT COALESCE(jsonb_agg(item ORDER BY item->>'createdAt' DESC, item->>'id'), '[]'::jsonb) INTO incoming
  FROM (
    SELECT chronelle_friend_connection_json(c, user_id) AS item
    FROM user_connections c
    WHERE c.status = 'pending' AND c.addressee_id = user_id
  ) received;
  SELECT COALESCE(jsonb_agg(item ORDER BY item->>'createdAt' DESC, item->>'id'), '[]'::jsonb) INTO sent
  FROM (
    SELECT chronelle_friend_connection_json(c, user_id) || jsonb_build_object('kind', 'connection', 'expiresAt', NULL) AS item
    FROM user_connections c
    WHERE c.status = 'pending' AND c.requester_id = user_id
    UNION ALL
    SELECT chronelle_friend_invitation_json(i) || jsonb_build_object('kind', 'invitation') AS item
    FROM user_invitations i
    WHERE i.status = 'pending' AND i.requester_id = user_id AND i.expires_at > now()
  ) outgoing;
  RETURN jsonb_build_object('friends', friends, 'incoming', incoming, 'sent', sent);
END
$$;

-- Invites an address. When exactly one account has it, a pending
-- connection is made and the account's address and language are returned
-- for the email; otherwise an invitation row keeps the token's digest for
-- the sign-up link. A person of the caller's workspace may be named as the
-- card the invitation comes from: it must be live, viewable by the caller,
-- and unlinked.
CREATE FUNCTION chronelle_friend_invite(
  user_id uuid,
  email text,
  message text,
  person_id uuid,
  workspace_id uuid,
  token_digest text,
  expires_at timestamptz,
  daily_limit integer,
  request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  me users%ROWTYPE;
  recipient users%ROWTYPE;
  recipients integer;
  existing user_connections%ROWTYPE;
  connection user_connections%ROWTYPE;
  invitation user_invitations%ROWTYPE;
  home uuid;
  sent_today integer;
  sent_at timestamptz := now();
BEGIN
  SELECT * INTO me FROM users u WHERE u.id = user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The user does not exist.' USING ERRCODE = 'PT404';
  END IF;
  home := chronelle_friend_home_workspace(user_id);
  IF email IS NULL OR email <> lower(btrim(email)) OR length(email) < 3 OR length(email) > 254 OR position('@' IN email) < 2 THEN
    RAISE EXCEPTION 'email must be a valid address.' USING ERRCODE = 'PT422';
  END IF;
  IF email = chronelle_friend_account_email(me) THEN
    RAISE EXCEPTION 'You cannot invite yourself.' USING ERRCODE = 'PT422';
  END IF;
  IF message IS NOT NULL AND (message <> btrim(message) OR message = '' OR length(message) > 500) THEN
    RAISE EXCEPTION 'message is at most 500 characters.' USING ERRCODE = 'PT422';
  END IF;
  IF (person_id IS NULL) <> (workspace_id IS NULL) THEN
    RAISE EXCEPTION 'personId names a person of the current workspace.' USING ERRCODE = 'PT422';
  END IF;
  IF person_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM persons p
    JOIN objects o ON o.id = p.object_id AND o.workspace_id = p.workspace_id
    WHERE p.object_id = person_id AND p.workspace_id = workspace_id AND p.user_id IS NULL
      AND o.deleted_at IS NULL AND chronelle_can_view(workspace_id, user_id, person_id)
  ) THEN
    RAISE EXCEPTION 'personId must name an unlinked person you can view.' USING ERRCODE = 'PT422';
  END IF;
  IF daily_limit > 0 THEN
    SELECT count(*) INTO sent_today FROM (
      SELECT c.created_at FROM user_connections c
      WHERE c.requester_id = user_id AND c.created_at > sent_at - interval '1 day'
      UNION ALL
      SELECT i.created_at FROM user_invitations i
      WHERE i.requester_id = user_id AND i.created_at > sent_at - interval '1 day'
    ) recent;
    IF sent_today >= daily_limit THEN
      RAISE EXCEPTION 'Too many invitations today.' USING ERRCODE = 'PT429';
    END IF;
  END IF;

  SELECT count(*) INTO recipients FROM users u WHERE chronelle_friend_account_email(u) = email;
  IF recipients > 1 THEN
    RAISE EXCEPTION 'The email belongs to more than one account.' USING ERRCODE = 'PT422';
  END IF;
  IF recipients = 1 THEN
    SELECT * INTO recipient FROM users u WHERE chronelle_friend_account_email(u) = email;
    SELECT * INTO existing FROM user_connections c
    WHERE c.status IN ('pending', 'accepted')
      AND LEAST(c.requester_id, c.addressee_id) = LEAST(user_id, recipient.id)
      AND GREATEST(c.requester_id, c.addressee_id) = GREATEST(user_id, recipient.id);
    IF FOUND THEN
      IF existing.status = 'accepted' THEN
        RAISE EXCEPTION 'You are already friends.' USING ERRCODE = 'PT409';
      ELSIF existing.requester_id = user_id THEN
        RAISE EXCEPTION 'An invitation is already waiting.' USING ERRCODE = 'PT409';
      ELSE
        RAISE EXCEPTION 'This person has already invited you.' USING ERRCODE = 'PT409';
      END IF;
    END IF;
    INSERT INTO user_connections (id, requester_id, addressee_id, status, message, person_id, workspace_id, created_at, last_sent_at)
    VALUES (chronelle_uuidv7(), user_id, recipient.id, 'pending', message, person_id, workspace_id, sent_at, sent_at)
    RETURNING * INTO connection;
    INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
    VALUES (chronelle_uuidv7(), home, 'user', user_id, 'friend.invited', NULL, request_id,
            jsonb_build_object('connectionId', connection.id::text, 'addresseeId', recipient.id::text));
    RETURN jsonb_build_object(
      'kind', 'connection',
      'item', chronelle_friend_connection_json(connection, user_id) || jsonb_build_object('kind', 'connection', 'expiresAt', NULL),
      'recipient', jsonb_build_object('userId', recipient.id::text, 'email', chronelle_friend_account_email(recipient), 'displayName', recipient.display_name, 'locale', recipient.locale),
      'sender', jsonb_build_object('displayName', me.display_name, 'email', chronelle_friend_account_email(me), 'locale', me.locale)
    );
  END IF;

  IF EXISTS (SELECT 1 FROM user_invitations i WHERE i.requester_id = user_id AND i.email = email AND i.status = 'pending') THEN
    RAISE EXCEPTION 'An invitation is already waiting.' USING ERRCODE = 'PT409';
  END IF;
  IF token_digest IS NULL OR token_digest !~ '^[0-9a-f]{64}$' OR expires_at IS NULL OR expires_at <= sent_at THEN
    RAISE EXCEPTION 'The invitation token is invalid.' USING ERRCODE = 'PT422';
  END IF;
  INSERT INTO user_invitations (id, requester_id, email, message, person_id, workspace_id, status, token_digest, created_at, last_sent_at, expires_at)
  VALUES (chronelle_uuidv7(), user_id, email, message, person_id, workspace_id, 'pending', token_digest, sent_at, sent_at, expires_at)
  RETURNING * INTO invitation;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), home, 'user', user_id, 'friend.invitation_sent', NULL, request_id,
          jsonb_build_object('invitationId', invitation.id::text));
  RETURN jsonb_build_object(
    'kind', 'invitation',
    'item', chronelle_friend_invitation_json(invitation) || jsonb_build_object('kind', 'invitation'),
    'recipient', NULL,
    'sender', jsonb_build_object('displayName', me.display_name, 'email', chronelle_friend_account_email(me), 'locale', me.locale)
  );
END
$$;

-- Answers a pending request addressed to the caller.
CREATE FUNCTION chronelle_friend_respond(user_id uuid, connection_id uuid, accept boolean, request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  connection user_connections%ROWTYPE;
  home uuid;
BEGIN
  home := chronelle_friend_home_workspace(user_id);
  SELECT * INTO connection FROM user_connections c
  WHERE c.id = connection_id AND c.addressee_id = user_id AND c.status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The request does not exist.' USING ERRCODE = 'PT404';
  END IF;
  UPDATE user_connections c
  SET status = CASE WHEN accept THEN 'accepted' ELSE 'declined' END,
      responded_at = GREATEST(now(), c.created_at)
  WHERE c.id = connection_id
  RETURNING * INTO connection;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), home, 'user', user_id,
          CASE WHEN accept THEN 'friend.accepted' ELSE 'friend.declined' END, NULL, request_id,
          jsonb_build_object('connectionId', connection.id::text, 'requesterId', connection.requester_id::text));
  RETURN chronelle_friend_connection_json(connection, user_id);
END
$$;

-- Withdraws what the caller sent and is still pending: a connection
-- request, or an invitation to an address without an account.
CREATE FUNCTION chronelle_friend_withdraw(user_id uuid, item_id uuid, request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  connection user_connections%ROWTYPE;
  invitation user_invitations%ROWTYPE;
  home uuid;
BEGIN
  home := chronelle_friend_home_workspace(user_id);
  UPDATE user_connections c
  SET status = 'withdrawn', responded_at = GREATEST(now(), c.created_at)
  WHERE c.id = item_id AND c.requester_id = user_id AND c.status = 'pending'
  RETURNING * INTO connection;
  IF FOUND THEN
    INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
    VALUES (chronelle_uuidv7(), home, 'user', user_id, 'friend.withdrawn', NULL, request_id,
            jsonb_build_object('connectionId', connection.id::text));
    RETURN jsonb_build_object('id', connection.id::text, 'kind', 'connection', 'status', 'withdrawn');
  END IF;
  UPDATE user_invitations i
  SET status = 'withdrawn'
  WHERE i.id = item_id AND i.requester_id = user_id AND i.status = 'pending'
  RETURNING * INTO invitation;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The invitation does not exist.' USING ERRCODE = 'PT404';
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), home, 'user', user_id, 'friend.invitation_withdrawn', NULL, request_id,
          jsonb_build_object('invitationId', invitation.id::text));
  RETURN jsonb_build_object('id', invitation.id::text, 'kind', 'invitation', 'status', 'withdrawn');
END
$$;

-- Ends an accepted connection from either side. Person links made through
-- it stay; they are per workspace and are unlinked from the person editor.
CREATE FUNCTION chronelle_friend_remove(user_id uuid, connection_id uuid, request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  connection user_connections%ROWTYPE;
  home uuid;
BEGIN
  home := chronelle_friend_home_workspace(user_id);
  UPDATE user_connections c
  SET status = 'removed', responded_at = GREATEST(now(), c.created_at)
  WHERE c.id = connection_id AND c.status = 'accepted'
    AND (c.requester_id = user_id OR c.addressee_id = user_id)
  RETURNING * INTO connection;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The friend does not exist.' USING ERRCODE = 'PT404';
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), home, 'user', user_id, 'friend.removed', NULL, request_id,
          jsonb_build_object('connectionId', connection.id::text));
  RETURN jsonb_build_object('id', connection.id::text, 'kind', 'connection', 'status', 'removed');
END
$$;

-- Sends a pending request or invitation again: a connection keeps its row,
-- an invitation takes a fresh token and expiry. Refused inside the resend
-- interval. The recipient's address and language are returned for the email.
CREATE FUNCTION chronelle_friend_resend(
  user_id uuid,
  item_id uuid,
  token_digest text,
  expires_at timestamptz,
  min_interval_seconds integer,
  request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  me users%ROWTYPE;
  recipient users%ROWTYPE;
  connection user_connections%ROWTYPE;
  invitation user_invitations%ROWTYPE;
  home uuid;
  sent_at timestamptz := now();
BEGIN
  SELECT * INTO me FROM users u WHERE u.id = user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The user does not exist.' USING ERRCODE = 'PT404';
  END IF;
  home := chronelle_friend_home_workspace(user_id);
  SELECT * INTO connection FROM user_connections c
  WHERE c.id = item_id AND c.requester_id = user_id AND c.status = 'pending'
  FOR UPDATE;
  IF FOUND THEN
    IF connection.last_sent_at + make_interval(secs => min_interval_seconds) > sent_at THEN
      RAISE EXCEPTION 'Wait before sending again.' USING ERRCODE = 'PT429';
    END IF;
    UPDATE user_connections c SET last_sent_at = sent_at WHERE c.id = item_id RETURNING * INTO connection;
    SELECT * INTO recipient FROM users u WHERE u.id = connection.addressee_id;
    INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
    VALUES (chronelle_uuidv7(), home, 'user', user_id, 'friend.resent', NULL, request_id,
            jsonb_build_object('connectionId', connection.id::text));
    RETURN jsonb_build_object(
      'kind', 'connection',
      'item', chronelle_friend_connection_json(connection, user_id) || jsonb_build_object('kind', 'connection', 'expiresAt', NULL),
      'recipient', jsonb_build_object('userId', recipient.id::text, 'email', chronelle_friend_account_email(recipient), 'displayName', recipient.display_name, 'locale', recipient.locale),
      'sender', jsonb_build_object('displayName', me.display_name, 'email', chronelle_friend_account_email(me), 'locale', me.locale)
    );
  END IF;
  SELECT * INTO invitation FROM user_invitations i
  WHERE i.id = item_id AND i.requester_id = user_id AND i.status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The invitation does not exist.' USING ERRCODE = 'PT404';
  END IF;
  IF invitation.last_sent_at + make_interval(secs => min_interval_seconds) > sent_at THEN
    RAISE EXCEPTION 'Wait before sending again.' USING ERRCODE = 'PT429';
  END IF;
  IF token_digest IS NULL OR token_digest !~ '^[0-9a-f]{64}$' OR expires_at IS NULL OR expires_at <= sent_at THEN
    RAISE EXCEPTION 'The invitation token is invalid.' USING ERRCODE = 'PT422';
  END IF;
  UPDATE user_invitations i
  SET token_digest = token_digest, expires_at = expires_at, last_sent_at = sent_at
  WHERE i.id = item_id
  RETURNING * INTO invitation;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), home, 'user', user_id, 'friend.invitation_resent', NULL, request_id,
          jsonb_build_object('invitationId', invitation.id::text));
  RETURN jsonb_build_object(
    'kind', 'invitation',
    'item', chronelle_friend_invitation_json(invitation) || jsonb_build_object('kind', 'invitation'),
    'recipient', NULL,
    'sender', jsonb_build_object('displayName', me.display_name, 'email', chronelle_friend_account_email(me), 'locale', me.locale)
  );
END
$$;

-- Turns the invitations waiting for a new account into pending requests:
-- the one whose token the sign-up carried, and every unexpired one
-- addressed to the account's email. Each becomes a pending connection from
-- its requester with the message and the person card it came from; a pair
-- that already has a live connection is left as it is. Returns how many
-- requests were made.
CREATE FUNCTION chronelle_friend_invitations_claim(user_id uuid, token_digest text, request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  me users%ROWTYPE;
  invitation user_invitations%ROWTYPE;
  connection user_connections%ROWTYPE;
  claimed integer := 0;
  claimed_at timestamptz := now();
BEGIN
  SELECT * INTO me FROM users u WHERE u.id = user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The user does not exist.' USING ERRCODE = 'PT404';
  END IF;
  FOR invitation IN
    SELECT * FROM user_invitations i
    WHERE i.status = 'pending' AND i.expires_at > claimed_at AND i.requester_id <> user_id
      AND (i.email = chronelle_friend_account_email(me) OR (token_digest IS NOT NULL AND i.token_digest = token_digest))
    ORDER BY i.created_at
    FOR UPDATE
  LOOP
    UPDATE user_invitations i SET status = 'consumed', consumed_at = claimed_at, consumed_by = user_id
    WHERE i.id = invitation.id;
    IF EXISTS (
      SELECT 1 FROM user_connections c
      WHERE c.status IN ('pending', 'accepted')
        AND LEAST(c.requester_id, c.addressee_id) = LEAST(invitation.requester_id, user_id)
        AND GREATEST(c.requester_id, c.addressee_id) = GREATEST(invitation.requester_id, user_id)
    ) THEN
      CONTINUE;
    END IF;
    INSERT INTO user_connections (id, requester_id, addressee_id, status, message, person_id, workspace_id, created_at, last_sent_at)
    VALUES (chronelle_uuidv7(), invitation.requester_id, user_id, 'pending', invitation.message, invitation.person_id, invitation.workspace_id, claimed_at, claimed_at)
    RETURNING * INTO connection;
    INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
    VALUES (chronelle_uuidv7(), chronelle_friend_home_workspace(invitation.requester_id), 'user', user_id, 'friend.invitation_claimed', NULL, request_id,
            jsonb_build_object('invitationId', invitation.id::text, 'connectionId', connection.id::text));
    claimed := claimed + 1;
  END LOOP;
  RETURN jsonb_build_object('claimed', claimed);
END
$$;
