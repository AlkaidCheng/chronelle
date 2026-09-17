-- Sharing with friends. A share may name a friend (an accepted connection
-- of the caller) as its grantee; a share ticked for a person who is only
-- invited waits in pending_shares against the request or invitation the
-- caller sent, and is granted when that request is accepted, through the
-- same grant row and audit event a direct share leaves. A workspace Owner
-- may add a friend as a member (viewer or editor) and remove a member.
--
-- chronelle_resource_share (0043) is redefined with the friend as a third
-- grantee argument. chronelle_friend_respond, chronelle_friend_withdraw,
-- and chronelle_friend_invitations_claim (0051) are replaced in place so a
-- decision on a request settles the shares waiting on it: acceptance grants
-- them, a decline or withdrawal lapses them, and an invitation claimed into
-- a request carries its shares over.
--
-- Errors follow the services: PT403 unavailable, PT404 unknown item or
-- person, PT422 invalid input, PT409 a conflicting membership.
CREATE TABLE pending_shares (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  resource_id uuid NOT NULL,
  person_id uuid REFERENCES persons(object_id) ON DELETE SET NULL,
  connection_id uuid REFERENCES user_connections(id) ON DELETE CASCADE,
  invitation_id uuid REFERENCES user_invitations(id) ON DELETE CASCADE,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  granted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  grant_id uuid,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  resolved_at timestamptz(3),
  CONSTRAINT pending_shares_resource_workspace_fk
    FOREIGN KEY (workspace_id, resource_id)
    REFERENCES objects(workspace_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT pending_shares_role_valid
    CHECK (role IN ('owner', 'editor', 'viewer')),
  CONSTRAINT pending_shares_status_valid
    CHECK (status IN ('pending', 'granted', 'revoked', 'lapsed')),
  CONSTRAINT pending_shares_item_named
    CHECK (connection_id IS NOT NULL OR invitation_id IS NOT NULL),
  CONSTRAINT pending_shares_resolved_when_settled
    CHECK ((status = 'pending') = (resolved_at IS NULL)),
  CONSTRAINT pending_shares_grant_when_granted
    CHECK ((status = 'granted') = (grant_id IS NOT NULL))
);
CREATE UNIQUE INDEX pending_shares_live_idx
  ON pending_shares (workspace_id, resource_id, COALESCE(connection_id, invitation_id))
  WHERE status = 'pending';
CREATE INDEX pending_shares_connection_idx ON pending_shares (connection_id) WHERE status = 'pending';
CREATE INDEX pending_shares_invitation_idx ON pending_shares (invitation_id) WHERE status = 'pending';

-- The account a share reaches: the one user with the email, the person's
-- linked account (else the one user with the person's email), or the other
-- side of the caller's accepted connection.
DROP FUNCTION chronelle_resource_share(uuid, uuid, uuid, uuid, text, text, uuid);

CREATE FUNCTION chronelle_resource_share(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  resource_id uuid,
  role text,
  principal_email text DEFAULT NULL,
  person_id uuid DEFAULT NULL,
  friend_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  person_row persons%ROWTYPE;
  connection user_connections%ROWTYPE;
  grantee_email text := principal_email;
  principal users%ROWTYPE;
  principal_count integer;
  grant_row resource_grants%ROWTYPE;
  named integer := (principal_email IS NOT NULL)::integer + (person_id IS NOT NULL)::integer + (friend_id IS NOT NULL)::integer;
BEGIN
  IF NOT chronelle_can_share(workspace_id, user_id, resource_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF named <> 1 THEN
    RAISE EXCEPTION 'Name exactly one of principalEmail, personId, and friendId.' USING ERRCODE = 'PT400';
  END IF;
  IF friend_id IS NOT NULL THEN
    SELECT c.* INTO connection FROM user_connections c
    WHERE c.id = friend_id AND c.status = 'accepted'
      AND (c.requester_id = user_id OR c.addressee_id = user_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The requested user is unavailable.' USING ERRCODE = 'PT404';
    END IF;
    SELECT * INTO principal FROM users u
    WHERE u.id = CASE WHEN connection.requester_id = user_id THEN connection.addressee_id ELSE connection.requester_id END;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The requested user is unavailable.' USING ERRCODE = 'PT404';
    END IF;
  ELSIF person_id IS NOT NULL THEN
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
            || CASE WHEN person_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('personId', person_id::text) END
            || CASE WHEN friend_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('friendId', friend_id::text) END);
  RETURN to_jsonb(grant_row) || jsonb_build_object(
    'principal', jsonb_build_object('id', principal.id::text, 'displayName', principal.display_name, 'email', principal.email)
  );
END
$$;

-- A pending share as the Share dialog lists it: whom it waits on (the
-- person card, else the address), the role, and the item it rides on.
CREATE FUNCTION chronelle_pending_share_json(pending pending_shares)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  person_name text;
  address text;
  kind text;
  item_id uuid;
BEGIN
  IF pending.person_id IS NOT NULL THEN
    SELECT COALESCE(p.nickname, o.display_name) INTO person_name
    FROM persons p JOIN objects o ON o.id = p.object_id AND o.workspace_id = p.workspace_id
    WHERE p.workspace_id = pending.workspace_id AND p.object_id = pending.person_id;
  END IF;
  IF pending.connection_id IS NOT NULL THEN
    kind := 'connection';
    item_id := pending.connection_id;
    SELECT chronelle_friend_account_email(u) INTO address
    FROM user_connections c
    JOIN users u ON u.id = CASE WHEN c.requester_id = pending.granted_by THEN c.addressee_id ELSE c.requester_id END
    WHERE c.id = pending.connection_id;
  ELSE
    kind := 'invitation';
    item_id := pending.invitation_id;
    SELECT i.email INTO address FROM user_invitations i WHERE i.id = pending.invitation_id;
  END IF;
  RETURN jsonb_build_object(
    'id', pending.id::text,
    'workspaceId', pending.workspace_id::text,
    'resourceId', pending.resource_id::text,
    'role', pending.role,
    'status', pending.status,
    'kind', kind,
    'itemId', item_id::text,
    'person', CASE WHEN pending.person_id IS NULL OR person_name IS NULL THEN NULL
                   ELSE jsonb_build_object('id', pending.person_id::text, 'displayName', person_name) END,
    'email', address,
    'grantedBy', pending.granted_by::text,
    'createdAt', to_jsonb(pending.created_at)
  );
END
$$;

-- Queues a share on a request or invitation the caller sent and still
-- waits on. The caller must be able to share the resource; the item must
-- be the caller's and pending (an invitation also unexpired); a person may
-- be named as the card it was ticked from. A second queue on the same item
-- and resource changes the role.
CREATE FUNCTION chronelle_pending_share_create(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  resource_id uuid,
  role text,
  item_id uuid,
  person_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  connection_ref uuid;
  invitation_ref uuid;
  pending pending_shares%ROWTYPE;
BEGIN
  IF NOT chronelle_can_share(workspace_id, user_id, resource_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF role NOT IN ('owner', 'editor', 'viewer') THEN
    RAISE EXCEPTION 'role must be owner, editor, or viewer.' USING ERRCODE = 'PT422';
  END IF;
  SELECT c.id INTO connection_ref FROM user_connections c
  WHERE c.id = item_id AND c.requester_id = user_id AND c.status = 'pending';
  IF connection_ref IS NULL THEN
    SELECT i.id INTO invitation_ref FROM user_invitations i
    WHERE i.id = item_id AND i.requester_id = user_id AND i.status = 'pending' AND i.expires_at > now();
    IF invitation_ref IS NULL THEN
      RAISE EXCEPTION 'The invitation does not exist.' USING ERRCODE = 'PT404';
    END IF;
  END IF;
  IF person_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM persons p
    JOIN objects o ON o.id = p.object_id AND o.workspace_id = p.workspace_id
    WHERE p.workspace_id = workspace_id AND p.object_id = person_id AND o.deleted_at IS NULL
      AND chronelle_can_view(workspace_id, user_id, person_id)
  ) THEN
    RAISE EXCEPTION 'The requested user is unavailable.' USING ERRCODE = 'PT404';
  END IF;
  SELECT p.* INTO pending FROM pending_shares p
  WHERE p.workspace_id = workspace_id AND p.resource_id = resource_id AND p.status = 'pending'
    AND ((connection_ref IS NOT NULL AND p.connection_id = connection_ref)
      OR (invitation_ref IS NOT NULL AND p.invitation_id = invitation_ref))
  FOR UPDATE;
  IF FOUND THEN
    UPDATE pending_shares p
    SET role = chronelle_pending_share_create.role, person_id = COALESCE(chronelle_pending_share_create.person_id, p.person_id), granted_by = user_id
    WHERE p.id = pending.id
    RETURNING * INTO pending;
  ELSE
    INSERT INTO pending_shares (id, workspace_id, resource_id, person_id, connection_id, invitation_id, role, granted_by)
    VALUES (chronelle_uuidv7(), workspace_id, resource_id, person_id, connection_ref, invitation_ref, role, user_id)
    RETURNING * INTO pending;
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), workspace_id, 'user', user_id, 'resource.share_queued', resource_id, request_id,
          jsonb_build_object('pendingShareId', pending.id::text, 'role', pending.role, 'itemId', item_id::text)
            || CASE WHEN person_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('personId', person_id::text) END);
  RETURN chronelle_pending_share_json(pending);
END
$$;

-- The shares still waiting on a resource, oldest first, for a caller with
-- recovery-level access to it (the same rule as the grant list).
CREATE FUNCTION chronelle_pending_share_list(workspace_id uuid, user_id uuid, resource_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  items jsonb;
BEGIN
  IF NOT chronelle_can_recover(workspace_id, user_id, resource_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT COALESCE(jsonb_agg(chronelle_pending_share_json(p) ORDER BY p.created_at, p.id), '[]'::jsonb) INTO items
  FROM pending_shares p
  WHERE p.workspace_id = workspace_id AND p.resource_id = resource_id AND p.status = 'pending';
  RETURN jsonb_build_object('items', items);
END
$$;

-- Takes a waiting share back; the caller needs recovery-level access to
-- the resource, as for revoking a grant.
CREATE FUNCTION chronelle_pending_share_revoke(workspace_id uuid, user_id uuid, request_id uuid, pending_id uuid, revoked_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  pending pending_shares%ROWTYPE;
BEGIN
  SELECT * INTO pending FROM pending_shares p
  WHERE p.workspace_id = workspace_id AND p.id = pending_id AND p.status = 'pending'
  FOR UPDATE;
  IF NOT FOUND OR NOT chronelle_can_recover(workspace_id, user_id, pending.resource_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  UPDATE pending_shares p SET status = 'revoked', resolved_at = GREATEST(now(), p.created_at) WHERE p.id = pending_id;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), workspace_id, 'user', user_id, 'resource.share_queue_revoked', pending.resource_id, request_id,
          jsonb_build_object('pendingShareId', pending_id::text));
  RETURN jsonb_build_object('id', pending_id::text, 'revokedAt', chronelle_iso(revoked_at));
END
$$;

-- Settles the shares waiting on an accepted connection: each becomes a
-- grant to the side that did not queue it, audited as a share by the
-- account that queued it, when that account can still share the resource;
-- otherwise it lapses. Returns how many were granted.
CREATE FUNCTION chronelle_pending_shares_settle(connection user_connections, settled_by uuid, request_id uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  pending pending_shares%ROWTYPE;
  grantee uuid;
  grant_row resource_grants%ROWTYPE;
  granted integer := 0;
BEGIN
  IF connection.status <> 'accepted' THEN
    RETURN 0;
  END IF;
  FOR pending IN
    SELECT * FROM pending_shares p WHERE p.connection_id = connection.id AND p.status = 'pending'
    ORDER BY p.created_at, p.id
    FOR UPDATE
  LOOP
    grantee := CASE WHEN connection.requester_id = pending.granted_by THEN connection.addressee_id ELSE connection.requester_id END;
    IF grantee <> pending.granted_by
       AND (connection.requester_id = pending.granted_by OR connection.addressee_id = pending.granted_by)
       AND chronelle_can_share(pending.workspace_id, pending.granted_by, pending.resource_id) THEN
      INSERT INTO resource_grants (id, workspace_id, resource_id, principal_type, principal_id, role, granted_by)
      VALUES (chronelle_uuidv7(), pending.workspace_id, pending.resource_id, 'user', grantee, pending.role, pending.granted_by)
      ON CONFLICT ON CONSTRAINT resource_grants_principal_unique
      DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, expires_at = NULL
      RETURNING * INTO grant_row;
      INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
      VALUES (chronelle_uuidv7(), pending.workspace_id, 'user', pending.granted_by, 'resource.shared', pending.resource_id, request_id,
              jsonb_build_object('grantId', grant_row.id::text, 'principalId', grantee::text, 'role', grant_row.role,
                                 'pendingShareId', pending.id::text, 'acceptedBy', settled_by::text)
                || CASE WHEN pending.person_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('personId', pending.person_id::text) END);
      UPDATE pending_shares p SET status = 'granted', grant_id = grant_row.id, resolved_at = GREATEST(now(), p.created_at)
      WHERE p.id = pending.id;
      granted := granted + 1;
    ELSE
      UPDATE pending_shares p SET status = 'lapsed', resolved_at = GREATEST(now(), p.created_at) WHERE p.id = pending.id;
    END IF;
  END LOOP;
  RETURN granted;
END
$$;

-- Lapses the shares waiting on a request or invitation that ended without
-- acceptance.
CREATE FUNCTION chronelle_pending_shares_lapse(connection_ref uuid, invitation_ref uuid)
RETURNS void LANGUAGE sql VOLATILE AS $$
  UPDATE pending_shares p SET status = 'lapsed', resolved_at = GREATEST(now(), p.created_at)
  WHERE p.status = 'pending'
    AND ((connection_ref IS NOT NULL AND p.connection_id = connection_ref)
      OR (invitation_ref IS NOT NULL AND p.invitation_id = invitation_ref));
$$;

-- Answers a request; acceptance settles the shares waiting on it.
CREATE OR REPLACE FUNCTION chronelle_friend_respond(user_id uuid, connection_id uuid, accept boolean, request_id uuid)
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
  IF accept THEN
    PERFORM chronelle_pending_shares_settle(connection, user_id, request_id);
  ELSE
    PERFORM chronelle_pending_shares_lapse(connection.id, NULL);
  END IF;
  RETURN chronelle_friend_connection_json(connection, user_id);
END
$$;

-- Withdraws what the caller sent and is still pending; the shares waiting
-- on it lapse.
CREATE OR REPLACE FUNCTION chronelle_friend_withdraw(user_id uuid, item_id uuid, request_id uuid)
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
    PERFORM chronelle_pending_shares_lapse(connection.id, NULL);
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
  PERFORM chronelle_pending_shares_lapse(NULL, invitation.id);
  RETURN jsonb_build_object('id', invitation.id::text, 'kind', 'invitation', 'status', 'withdrawn');
END
$$;

-- Turns the invitations waiting for a new account into requests. The
-- shares waiting on an invitation move to the request it becomes; when a
-- live connection already stands between the two accounts they move to
-- that one instead (and are settled at once if it is accepted), unless a
-- share already waits there, in which case they lapse.
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
      AND (i.email = chronelle_friend_account_email(me) OR (token_digest IS NOT NULL AND i.token_digest = token_digest))
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

-- A member of the current workspace, with the connection the caller has
-- to them when they are friends.
CREATE FUNCTION chronelle_workspace_member_json(workspace_id uuid, viewer_id uuid, member workspace_members)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  account users%ROWTYPE;
  friend_ref uuid;
  personal boolean;
BEGIN
  SELECT * INTO account FROM users u WHERE u.id = member.user_id;
  SELECT c.id INTO friend_ref FROM user_connections c
  WHERE c.status = 'accepted'
    AND LEAST(c.requester_id, c.addressee_id) = LEAST(viewer_id, member.user_id)
    AND GREATEST(c.requester_id, c.addressee_id) = GREATEST(viewer_id, member.user_id);
  SELECT w.personal_owner_id = member.user_id INTO personal FROM workspaces w WHERE w.id = workspace_id;
  RETURN jsonb_build_object(
    'userId', member.user_id::text,
    'displayName', account.display_name,
    'email', chronelle_friend_account_email(account),
    'role', member.role,
    'personal', COALESCE(personal, false),
    'friendId', friend_ref::text,
    'joinedAt', to_jsonb(member.created_at)
  );
END
$$;

-- The members of the current workspace, the personal owner first, then by
-- name, for any member.
CREATE FUNCTION chronelle_workspace_member_list(workspace_id uuid, user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  items jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = workspace_id AND m.user_id = user_id) THEN
    RAISE EXCEPTION 'The workspace is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'personal')::boolean DESC, item->>'displayName', item->>'userId'), '[]'::jsonb) INTO items
  FROM (
    SELECT chronelle_workspace_member_json(workspace_id, user_id, m) AS item
    FROM workspace_members m WHERE m.workspace_id = workspace_id
  ) members;
  RETURN jsonb_build_object('items', items);
END
$$;

-- An Owner adds a friend as a member (viewer or editor), or changes the
-- role of a friend who already is one; the personal owner's role never
-- changes, and an Owner is not demoted this way.
CREATE FUNCTION chronelle_workspace_member_add(workspace_id uuid, user_id uuid, request_id uuid, friend_id uuid, role text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  connection user_connections%ROWTYPE;
  member_id uuid;
  member workspace_members%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM workspace_members m WHERE m.workspace_id = workspace_id AND m.user_id = user_id AND m.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'The workspace is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF role NOT IN ('editor', 'viewer') THEN
    RAISE EXCEPTION 'role must be editor or viewer.' USING ERRCODE = 'PT422';
  END IF;
  SELECT c.* INTO connection FROM user_connections c
  WHERE c.id = friend_id AND c.status = 'accepted' AND (c.requester_id = user_id OR c.addressee_id = user_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The friend does not exist.' USING ERRCODE = 'PT404';
  END IF;
  member_id := CASE WHEN connection.requester_id = user_id THEN connection.addressee_id ELSE connection.requester_id END;
  IF EXISTS (
    SELECT 1 FROM workspace_members m WHERE m.workspace_id = workspace_id AND m.user_id = member_id AND m.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'The member is an Owner of this workspace.' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (workspace_id, member_id, role)
  ON CONFLICT ON CONSTRAINT workspace_members_pkey DO UPDATE SET role = EXCLUDED.role
  RETURNING * INTO member;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), workspace_id, 'user', user_id, 'workspace.member_added', NULL, request_id,
          jsonb_build_object('memberId', member_id::text, 'role', role, 'friendId', friend_id::text));
  RETURN chronelle_workspace_member_json(workspace_id, user_id, member);
END
$$;

-- An Owner removes a member other than the personal owner and other than
-- themselves; the member's direct grants in the workspace stay.
CREATE FUNCTION chronelle_workspace_member_remove(workspace_id uuid, user_id uuid, request_id uuid, member_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  member workspace_members%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM workspace_members m WHERE m.workspace_id = workspace_id AND m.user_id = user_id AND m.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'The workspace is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF member_id = user_id OR EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_id AND w.personal_owner_id = member_id) THEN
    RAISE EXCEPTION 'The member cannot be removed.' USING ERRCODE = 'PT422';
  END IF;
  DELETE FROM workspace_members m WHERE m.workspace_id = workspace_id AND m.user_id = member_id
  RETURNING * INTO member;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The member does not exist.' USING ERRCODE = 'PT404';
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), workspace_id, 'user', user_id, 'workspace.member_removed', NULL, request_id,
          jsonb_build_object('memberId', member_id::text, 'role', member.role));
  RETURN jsonb_build_object('userId', member_id::text, 'removed', true);
END
$$;
