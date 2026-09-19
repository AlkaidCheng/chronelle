-- An invitation is a link. Every invitation carries a token (kept on the
-- row so the link can be copied again; its digest still keys the lookups),
-- and an email is an optional way to deliver it: `channel` records whether
-- the invitation was emailed or made as a link, and `email` may be null for
-- a link made for a card without an address or for someone new. A pending
-- invitation is unique per requester and address, and per requester and
-- card.
--
-- The link opens the claim page, where Accept is explicit: the invitation
-- is peeked by its digest without a session, and accepted by a signed-in
-- account, which reconciles the friendship (made, or kept when it already
-- stood, a pending request either way resolved into it), applies the shares
-- queued on the invitation unless the account already holds the record
-- with the same or a higher role or the record is in Trash, and consumes
-- the link. The sign-up claim (0052) no longer consumes the link the
-- sign-up carried: that link stays open for the claim page; the other
-- invitations addressed to the new account's email still become requests.
--
-- chronelle_friend_invite and chronelle_friend_resend (0051) take the token
-- as well as its digest and are replaced with the new signatures;
-- chronelle_friend_invitation_json (0051) and chronelle_friend_invitations_claim
-- (0052) are replaced in place. chronelle_friend_link rotates the token.
--
-- Errors follow the services: PT404 unknown item, PT409 a conflicting
-- state, PT422 invalid input, PT429 the daily cap or the resend interval.
ALTER TABLE user_invitations
  ALTER COLUMN email DROP NOT NULL,
  ADD COLUMN channel text NOT NULL DEFAULT 'email',
  ADD COLUMN token text,
  ADD CONSTRAINT user_invitations_channel_valid
    CHECK (channel IN ('email', 'link')),
  ADD CONSTRAINT user_invitations_emailed_when_addressed
    CHECK (channel = 'link' OR email IS NOT NULL),
  ADD CONSTRAINT user_invitations_token_shape
    CHECK (token IS NULL OR token ~ '^[A-Za-z0-9_-]{16,128}$');
ALTER TABLE user_invitations ALTER COLUMN channel DROP DEFAULT;
CREATE UNIQUE INDEX user_invitations_pending_person_idx
  ON user_invitations (requester_id, workspace_id, person_id)
  WHERE status = 'pending' AND person_id IS NOT NULL;

CREATE OR REPLACE FUNCTION chronelle_friend_invitation_json(invitation user_invitations)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'id', invitation.id::text,
    'status', invitation.status,
    'email', invitation.email,
    'channel', invitation.channel,
    'token', invitation.token,
    'message', invitation.message,
    'personId', invitation.person_id::text,
    'workspaceId', invitation.workspace_id::text,
    'createdAt', to_jsonb(invitation.created_at),
    'expiresAt', to_jsonb(invitation.expires_at)
  );
$$;

-- The role an account holds on an object: the highest of its membership
-- in the workspace, an unexpired grant on the object, and an unexpired
-- grant on the object's live canonical scope; null when it holds none.
CREATE FUNCTION chronelle_role_rank(role text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE role WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END;
$$;

CREATE FUNCTION chronelle_held_role(workspace_id uuid, user_id uuid, object_id uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT held.role FROM (
    SELECT m.role FROM workspace_members m
    WHERE m.workspace_id = $1 AND m.user_id = $2
    UNION ALL
    SELECT g.role FROM resource_grants g
    WHERE g.workspace_id = $1 AND g.principal_type = 'user' AND g.principal_id = $2
      AND (g.expires_at IS NULL OR g.expires_at > now()) AND g.resource_id = $3
    UNION ALL
    SELECT g.role FROM resource_grants g
    JOIN objects o ON o.workspace_id = $1 AND o.id = $3
    JOIN objects scope ON scope.workspace_id = g.workspace_id AND scope.id = g.resource_id
    WHERE g.workspace_id = $1 AND g.principal_type = 'user' AND g.principal_id = $2
      AND (g.expires_at IS NULL OR g.expires_at > now())
      AND g.resource_id = o.permission_scope_id AND scope.deleted_at IS NULL
  ) held
  ORDER BY chronelle_role_rank(held.role) DESC
  LIMIT 1;
$$;

-- Invites someone: by email, or as a link. An address that exactly one
-- account has makes a pending request to that account, whichever channel
-- was asked for. Otherwise an invitation row keeps the token and its
-- digest: emailed when the channel is email (an address is then required),
-- or handed on by the caller when it is a link (the address, when given,
-- is kept so it can be emailed later). A person of the caller's workspace
-- may be named as the card the invitation comes from: it must be live,
-- viewable by the caller, and unlinked, with no invitation still waiting.
DROP FUNCTION chronelle_friend_invite(uuid, text, text, uuid, uuid, text, timestamptz, integer, uuid);
CREATE FUNCTION chronelle_friend_invite(
  user_id uuid,
  email text,
  message text,
  person_id uuid,
  workspace_id uuid,
  channel text,
  token text,
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
  recipients integer := 0;
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
  IF channel IS NULL OR channel NOT IN ('email', 'link') THEN
    RAISE EXCEPTION 'channel must be email or link.' USING ERRCODE = 'PT422';
  END IF;
  IF channel = 'email' AND email IS NULL THEN
    RAISE EXCEPTION 'Give an email to send the invitation to.' USING ERRCODE = 'PT422';
  END IF;
  IF email IS NOT NULL AND (email <> lower(btrim(email)) OR length(email) < 3 OR length(email) > 254 OR position('@' IN email) < 2) THEN
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

  IF email IS NOT NULL THEN
    SELECT count(*) INTO recipients FROM users u WHERE chronelle_friend_account_email(u) = email;
  END IF;
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
      'item', chronelle_friend_connection_json(connection, user_id) || jsonb_build_object('kind', 'connection', 'channel', NULL, 'token', NULL, 'expiresAt', NULL),
      'recipient', jsonb_build_object('userId', recipient.id::text, 'email', chronelle_friend_account_email(recipient), 'displayName', recipient.display_name, 'locale', recipient.locale),
      'sender', jsonb_build_object('displayName', me.display_name, 'email', chronelle_friend_account_email(me), 'locale', me.locale)
    );
  END IF;

  IF email IS NOT NULL AND EXISTS (SELECT 1 FROM user_invitations i WHERE i.requester_id = user_id AND i.email = email AND i.status = 'pending') THEN
    RAISE EXCEPTION 'An invitation is already waiting.' USING ERRCODE = 'PT409';
  END IF;
  IF person_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM user_invitations i
    WHERE i.requester_id = user_id AND i.workspace_id = workspace_id AND i.person_id = person_id AND i.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'An invitation is already waiting.' USING ERRCODE = 'PT409';
  END IF;
  IF token IS NULL OR token !~ '^[A-Za-z0-9_-]{16,128}$' OR token_digest IS NULL OR token_digest !~ '^[0-9a-f]{64}$' OR expires_at IS NULL OR expires_at <= sent_at THEN
    RAISE EXCEPTION 'The invitation token is invalid.' USING ERRCODE = 'PT422';
  END IF;
  INSERT INTO user_invitations (id, requester_id, email, channel, message, person_id, workspace_id, status, token, token_digest, created_at, last_sent_at, expires_at)
  VALUES (chronelle_uuidv7(), user_id, email, channel, message, person_id, workspace_id, 'pending', token, token_digest, sent_at, sent_at, expires_at)
  RETURNING * INTO invitation;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), home, 'user', user_id,
          CASE WHEN channel = 'email' THEN 'friend.invitation_sent' ELSE 'friend.invitation_linked' END, NULL, request_id,
          jsonb_build_object('invitationId', invitation.id::text));
  RETURN jsonb_build_object(
    'kind', 'invitation',
    'item', chronelle_friend_invitation_json(invitation) || jsonb_build_object('kind', 'invitation'),
    'recipient', NULL,
    'sender', jsonb_build_object('displayName', me.display_name, 'email', chronelle_friend_account_email(me), 'locale', me.locale)
  );
END
$$;

-- Gives a pending invitation the caller sent a fresh token and expiry,
-- refused inside the resend interval. The row is returned for the email
-- when it has an address. Shared by resend and link.
CREATE FUNCTION chronelle_friend_invitation_rotate(
  user_id uuid,
  item_id uuid,
  token text,
  token_digest text,
  expires_at timestamptz,
  min_interval_seconds integer,
  emailed boolean,
  sent_at timestamptz
)
RETURNS user_invitations LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  invitation user_invitations%ROWTYPE;
BEGIN
  SELECT * INTO invitation FROM user_invitations i
  WHERE i.id = item_id AND i.requester_id = user_id AND i.status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The invitation does not exist.' USING ERRCODE = 'PT404';
  END IF;
  IF emailed AND invitation.email IS NULL THEN
    RAISE EXCEPTION 'The invitation has no address to send to.' USING ERRCODE = 'PT422';
  END IF;
  IF invitation.last_sent_at + make_interval(secs => min_interval_seconds) > sent_at THEN
    RAISE EXCEPTION 'Wait before sending again.' USING ERRCODE = 'PT429';
  END IF;
  IF token IS NULL OR token !~ '^[A-Za-z0-9_-]{16,128}$' OR token_digest IS NULL OR token_digest !~ '^[0-9a-f]{64}$' OR expires_at IS NULL OR expires_at <= sent_at THEN
    RAISE EXCEPTION 'The invitation token is invalid.' USING ERRCODE = 'PT422';
  END IF;
  UPDATE user_invitations i
  SET token = token, token_digest = token_digest, expires_at = expires_at, last_sent_at = sent_at,
      channel = CASE WHEN emailed THEN 'email' ELSE i.channel END
  WHERE i.id = item_id
  RETURNING * INTO invitation;
  RETURN invitation;
END
$$;

-- Sends a pending request or invitation again: a connection keeps its
-- row, an invitation takes a fresh token and expiry and counts as emailed
-- from then on (an invitation without an address cannot be sent). Refused
-- inside the resend interval. The recipient's address and language are
-- returned for the email.
DROP FUNCTION chronelle_friend_resend(uuid, uuid, text, timestamptz, integer, uuid);
CREATE FUNCTION chronelle_friend_resend(
  user_id uuid,
  item_id uuid,
  token text,
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
      'item', chronelle_friend_connection_json(connection, user_id) || jsonb_build_object('kind', 'connection', 'channel', NULL, 'token', NULL, 'expiresAt', NULL),
      'recipient', jsonb_build_object('userId', recipient.id::text, 'email', chronelle_friend_account_email(recipient), 'displayName', recipient.display_name, 'locale', recipient.locale),
      'sender', jsonb_build_object('displayName', me.display_name, 'email', chronelle_friend_account_email(me), 'locale', me.locale)
    );
  END IF;
  invitation := chronelle_friend_invitation_rotate(user_id, item_id, token, token_digest, expires_at, min_interval_seconds, true, sent_at);
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

-- New link: a pending invitation the caller sent takes a fresh token and
-- expiry, so the link handed out before stops working. Refused inside the
-- resend interval. The row is returned for the email that goes out again
-- when the invitation has an address.
CREATE FUNCTION chronelle_friend_link(
  user_id uuid,
  item_id uuid,
  token text,
  token_digest text,
  expires_at timestamptz,
  min_interval_seconds integer,
  request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  me users%ROWTYPE;
  invitation user_invitations%ROWTYPE;
  home uuid;
  sent_at timestamptz := now();
BEGIN
  SELECT * INTO me FROM users u WHERE u.id = user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The user does not exist.' USING ERRCODE = 'PT404';
  END IF;
  home := chronelle_friend_home_workspace(user_id);
  invitation := chronelle_friend_invitation_rotate(user_id, item_id, token, token_digest, expires_at, min_interval_seconds, false, sent_at);
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), home, 'user', user_id, 'friend.invitation_renewed', NULL, request_id,
          jsonb_build_object('invitationId', invitation.id::text));
  RETURN jsonb_build_object(
    'kind', 'invitation',
    'item', chronelle_friend_invitation_json(invitation) || jsonb_build_object('kind', 'invitation'),
    'recipient', NULL,
    'sender', jsonb_build_object('displayName', me.display_name, 'email', chronelle_friend_account_email(me), 'locale', me.locale)
  );
END
$$;

-- Turns the invitations addressed to a new account's email into requests,
-- as before, except the one whose link the sign-up carried: that link stays
-- open, and the claim page accepts it explicitly. The shares waiting on a
-- claimed invitation move to the request it becomes as in 0052.
CREATE OR REPLACE FUNCTION chronelle_friend_invitations_claim(user_id uuid, token_digest text, request_id uuid)
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
      AND i.email = chronelle_friend_account_email(me)
      AND (token_digest IS NULL OR i.token_digest <> token_digest)
    ORDER BY i.created_at
    FOR UPDATE
  LOOP
    UPDATE user_invitations i SET status = 'consumed', consumed_at = claimed_at, consumed_by = user_id
    WHERE i.id = invitation.id;
    SELECT c.* INTO connection FROM user_connections c
    WHERE c.status IN ('pending', 'accepted')
      AND LEAST(c.requester_id, c.addressee_id) = LEAST(invitation.requester_id, user_id)
      AND GREATEST(c.requester_id, c.addressee_id) = GREATEST(invitation.requester_id, user_id)
    FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO user_connections (id, requester_id, addressee_id, status, message, person_id, workspace_id, created_at, last_sent_at)
      VALUES (chronelle_uuidv7(), invitation.requester_id, user_id, 'pending', invitation.message, invitation.person_id, invitation.workspace_id, claimed_at, claimed_at)
      RETURNING * INTO connection;
      INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
      VALUES (chronelle_uuidv7(), chronelle_friend_home_workspace(invitation.requester_id), 'user', user_id, 'friend.invitation_claimed', NULL, request_id,
              jsonb_build_object('invitationId', invitation.id::text, 'connectionId', connection.id::text));
      claimed := claimed + 1;
    END IF;
    UPDATE pending_shares p SET status = 'lapsed', resolved_at = GREATEST(claimed_at, p.created_at)
    WHERE p.invitation_id = invitation.id AND p.status = 'pending'
      AND EXISTS (
        SELECT 1 FROM pending_shares q
        WHERE q.status = 'pending' AND q.connection_id = connection.id
          AND q.workspace_id = p.workspace_id AND q.resource_id = p.resource_id
      );
    UPDATE pending_shares p SET connection_id = connection.id
    WHERE p.invitation_id = invitation.id AND p.status = 'pending';
    PERFORM chronelle_pending_shares_settle(connection, user_id, request_id);
  END LOOP;
  RETURN jsonb_build_object('claimed', claimed);
END
$$;

-- What the claim page shows before anyone signs in: who invited, the note,
-- the records waiting to be shared (live ones, by name and role), when the
-- link expires, and whether it is still open, used, withdrawn, or expired.
CREATE FUNCTION chronelle_friend_invitation_peek(token_digest text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  invitation user_invitations%ROWTYPE;
  requester users%ROWTYPE;
  queued jsonb;
BEGIN
  SELECT * INTO invitation FROM user_invitations i WHERE i.token_digest = token_digest;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The invitation does not exist.' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO requester FROM users u WHERE u.id = invitation.requester_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('resourceId', o.id::text, 'displayName', o.display_name, 'role', p.role)
                            ORDER BY p.created_at, p.id), '[]'::jsonb) INTO queued
  FROM pending_shares p
  JOIN objects o ON o.workspace_id = p.workspace_id AND o.id = p.resource_id
  WHERE p.invitation_id = invitation.id AND p.status = 'pending' AND o.deleted_at IS NULL;
  RETURN jsonb_build_object(
    'requester', jsonb_build_object('displayName', requester.display_name, 'username', requester.username),
    'message', invitation.message,
    'queued', queued,
    'expiresAt', to_jsonb(invitation.expires_at),
    'status', CASE invitation.status
                WHEN 'consumed' THEN 'used'
                WHEN 'withdrawn' THEN 'withdrawn'
                ELSE CASE WHEN invitation.expires_at > now() THEN 'open' ELSE 'expired' END
              END
  );
END
$$;

-- Accept, by a signed-in account, of the invitation a link opens. The
-- caller's own link is refused; a used, withdrawn, or expired one too.
-- The friendship is made when none stands (a pending request either way
-- becomes the accepted connection, and the shares waiting on it settle as
-- for an accepted request), or kept as it is. Each share queued on the
-- invitation is granted to the caller by the account that queued it, while
-- that account can still share the record (so a record in Trash is
-- skipped), unless the caller already holds the record with the same or a
-- higher role, which is reported instead. The link is consumed. The person
-- card the invitation came from is linked by the service, as for an
-- accepted request.
CREATE FUNCTION chronelle_friend_invitation_accept(user_id uuid, token_digest text, request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  me users%ROWTYPE;
  invitation user_invitations%ROWTYPE;
  connection user_connections%ROWTYPE;
  pending pending_shares%ROWTYPE;
  record_name text;
  held text;
  grant_row resource_grants%ROWTYPE;
  friendship text;
  shared jsonb := '[]'::jsonb;
  already jsonb := '[]'::jsonb;
  home uuid;
  accepted_at timestamptz := now();
BEGIN
  SELECT * INTO me FROM users u WHERE u.id = user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The user does not exist.' USING ERRCODE = 'PT404';
  END IF;
  home := chronelle_friend_home_workspace(user_id);
  SELECT * INTO invitation FROM user_invitations i WHERE i.token_digest = token_digest FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The invitation does not exist.' USING ERRCODE = 'PT404';
  END IF;
  IF invitation.requester_id = user_id THEN
    RAISE EXCEPTION 'This is your own invitation link.' USING ERRCODE = 'PT422';
  END IF;
  IF invitation.status = 'consumed' THEN
    RAISE EXCEPTION 'This invitation was already accepted.' USING ERRCODE = 'PT409';
  END IF;
  IF invitation.status <> 'pending' THEN
    RAISE EXCEPTION 'This invitation is no longer open.' USING ERRCODE = 'PT409';
  END IF;
  IF invitation.expires_at <= accepted_at THEN
    RAISE EXCEPTION 'This invitation has expired.' USING ERRCODE = 'PT409';
  END IF;
  UPDATE user_invitations i SET status = 'consumed', consumed_at = accepted_at, consumed_by = user_id
  WHERE i.id = invitation.id;

  SELECT c.* INTO connection FROM user_connections c
  WHERE c.status IN ('pending', 'accepted')
    AND LEAST(c.requester_id, c.addressee_id) = LEAST(invitation.requester_id, user_id)
    AND GREATEST(c.requester_id, c.addressee_id) = GREATEST(invitation.requester_id, user_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO user_connections (id, requester_id, addressee_id, status, message, person_id, workspace_id, created_at, last_sent_at, responded_at)
    VALUES (chronelle_uuidv7(), invitation.requester_id, user_id, 'accepted', invitation.message, invitation.person_id, invitation.workspace_id, accepted_at, accepted_at, accepted_at)
    RETURNING * INTO connection;
    friendship := 'made';
  ELSIF connection.status = 'pending' THEN
    UPDATE user_connections c SET status = 'accepted', responded_at = GREATEST(accepted_at, c.created_at)
    WHERE c.id = connection.id
    RETURNING * INTO connection;
    friendship := 'made';
  ELSE
    friendship := 'existing';
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), home, 'user', user_id, 'friend.invitation_accepted', NULL, request_id,
          jsonb_build_object('invitationId', invitation.id::text, 'connectionId', connection.id::text,
                             'requesterId', invitation.requester_id::text, 'friendship', friendship));
  IF friendship = 'made' THEN
    PERFORM chronelle_pending_shares_settle(connection, user_id, request_id);
  END IF;

  FOR pending IN
    SELECT * FROM pending_shares p WHERE p.invitation_id = invitation.id AND p.status = 'pending'
    ORDER BY p.created_at, p.id
    FOR UPDATE
  LOOP
    SELECT o.display_name INTO record_name FROM objects o
    WHERE o.workspace_id = pending.workspace_id AND o.id = pending.resource_id;
    held := chronelle_held_role(pending.workspace_id, user_id, pending.resource_id);
    IF pending.granted_by = user_id
       OR NOT chronelle_can_share(pending.workspace_id, pending.granted_by, pending.resource_id) THEN
      UPDATE pending_shares p SET status = 'lapsed', resolved_at = GREATEST(accepted_at, p.created_at) WHERE p.id = pending.id;
    ELSIF chronelle_role_rank(held) >= chronelle_role_rank(pending.role) THEN
      UPDATE pending_shares p SET status = 'lapsed', resolved_at = GREATEST(accepted_at, p.created_at) WHERE p.id = pending.id;
      already := already || jsonb_build_object('resourceId', pending.resource_id::text, 'displayName', record_name, 'role', held);
    ELSE
      INSERT INTO resource_grants (id, workspace_id, resource_id, principal_type, principal_id, role, granted_by)
      VALUES (chronelle_uuidv7(), pending.workspace_id, pending.resource_id, 'user', user_id, pending.role, pending.granted_by)
      ON CONFLICT ON CONSTRAINT resource_grants_principal_unique
      DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, expires_at = NULL
      RETURNING * INTO grant_row;
      INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
      VALUES (chronelle_uuidv7(), pending.workspace_id, 'user', pending.granted_by, 'resource.shared', pending.resource_id, request_id,
              jsonb_build_object('grantId', grant_row.id::text, 'principalId', user_id::text, 'role', grant_row.role,
                                 'pendingShareId', pending.id::text, 'acceptedBy', user_id::text)
                || CASE WHEN pending.person_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('personId', pending.person_id::text) END);
      UPDATE pending_shares p SET status = 'granted', grant_id = grant_row.id, resolved_at = GREATEST(accepted_at, p.created_at)
      WHERE p.id = pending.id;
      shared := shared || jsonb_build_object('resourceId', pending.resource_id::text, 'displayName', record_name, 'role', grant_row.role);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'friendship', friendship,
    'connection', chronelle_friend_connection_json(connection, user_id),
    'shared', shared,
    'alreadyHad', already,
    'personId', invitation.person_id::text,
    'workspaceId', invitation.workspace_id::text
  );
END
$$;
