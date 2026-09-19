-- A person card stands for an account by its link first, then by any of
-- its email contacts: the one account whose email equals one of them and
-- that lets itself be found by email. The card's own email column, kept
-- for one release as a mirror of the first email contact, goes with the
-- "first email" rule: a person's contacts are read from person_contacts
-- alone, and the order of the contacts no longer decides who is granted
-- or invited. The rule lives in chronelle_person_account and every share
-- path that names a card uses it.

-- The account a card stands for: the linked one, else the one account that
-- one of the card's email contacts reaches and that can be found by email;
-- null when none or more than one.
CREATE FUNCTION chronelle_person_account(workspace_id uuid, person_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  linked uuid;
  matches uuid[];
BEGIN
  SELECT p.user_id INTO linked FROM persons p
  WHERE p.workspace_id = workspace_id AND p.object_id = person_id;
  IF linked IS NOT NULL THEN
    RETURN linked;
  END IF;
  SELECT array_agg(DISTINCT u.id) INTO matches
  FROM person_contacts c
  JOIN users u ON u.email = lower(c.value) AND u.find_by_email
  WHERE c.workspace_id = workspace_id AND c.person_id = person_id AND c.kind = 'email';
  IF matches IS NULL OR array_length(matches, 1) <> 1 THEN
    RETURN NULL;
  END IF;
  RETURN matches[1];
END
$$;

-- The account a share reaches: the one user with the email, the account
-- the person card stands for, or the other side of the caller's accepted
-- connection.
CREATE OR REPLACE FUNCTION chronelle_resource_share(
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
  connection user_connections%ROWTYPE;
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
    IF NOT EXISTS (
      SELECT 1 FROM persons p
      WHERE p.workspace_id = workspace_id AND p.object_id = person_id
        AND chronelle_can_view(workspace_id, user_id, person_id)
    ) THEN
      RAISE EXCEPTION 'The requested user is unavailable.' USING ERRCODE = 'PT404';
    END IF;
    SELECT * INTO principal FROM users u WHERE u.id = chronelle_person_account(workspace_id, person_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The requested user is unavailable.' USING ERRCODE = 'PT404';
    END IF;
  ELSE
    SELECT count(*) INTO principal_count FROM users u WHERE u.email = principal_email;
    IF principal_count <> 1 THEN
      RAISE EXCEPTION 'The requested user is unavailable.' USING ERRCODE = 'PT404';
    END IF;
    SELECT * INTO principal FROM users u WHERE u.email = principal_email;
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

-- What is shared each way with one person, for the person's page, as
-- before; the person's account is the one the card stands for.
CREATE OR REPLACE FUNCTION chronelle_person_shares_list(workspace_id uuid, user_id uuid, person_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  account uuid;
  items jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM persons p WHERE p.workspace_id = workspace_id AND p.object_id = person_id)
     OR NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = workspace_id AND m.user_id = user_id)
     OR NOT chronelle_can_view(workspace_id, user_id, person_id) THEN
    RAISE EXCEPTION 'The person is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  account := chronelle_person_account(workspace_id, person_id);
  SELECT COALESCE(jsonb_agg(item ORDER BY item->>'createdAt' DESC, item->>'id'), '[]'::jsonb) INTO items
  FROM (
    SELECT jsonb_build_object(
      'id', g.id::text, 'kind', 'grant', 'direction', 'outgoing',
      'resourceId', o.id::text, 'objectType', o.object_type, 'displayName', o.display_name,
      'role', g.role, 'createdAt', chronelle_iso(g.created_at)
    ) AS item
    FROM resource_grants g
    JOIN objects o ON o.workspace_id = g.workspace_id AND o.id = g.resource_id
    WHERE g.workspace_id = workspace_id
      AND g.principal_type = 'user' AND g.principal_id = account
      AND (g.expires_at IS NULL OR g.expires_at > now())
      AND o.deleted_at IS NULL
    UNION ALL
    SELECT jsonb_build_object(
      'id', p.id::text, 'kind', 'pending', 'direction', 'outgoing',
      'resourceId', o.id::text, 'objectType', o.object_type, 'displayName', o.display_name,
      'role', p.role, 'createdAt', chronelle_iso(p.created_at)
    ) AS item
    FROM pending_shares p
    JOIN objects o ON o.workspace_id = p.workspace_id AND o.id = p.resource_id
    WHERE p.workspace_id = workspace_id AND p.person_id = person_id AND p.status = 'pending'
      AND o.deleted_at IS NULL
    UNION ALL
    SELECT jsonb_build_object(
      'id', g.id::text, 'kind', 'grant', 'direction', 'incoming',
      'resourceId', o.id::text, 'objectType', o.object_type, 'displayName', o.display_name,
      'role', g.role, 'createdAt', chronelle_iso(g.created_at)
    ) AS item
    FROM resource_grants g
    JOIN objects o ON o.workspace_id = g.workspace_id AND o.id = g.resource_id
    WHERE g.principal_type = 'user' AND g.principal_id = user_id
      AND g.granted_by = account
      AND (g.expires_at IS NULL OR g.expires_at > now())
      AND o.deleted_at IS NULL
  ) shared;
  RETURN jsonb_build_object('items', items);
END
$$;

-- A Person's linked account is a member of the workspace or a friend of
-- one and belongs to one Person. The contacts are checked on their own.
DROP FUNCTION chronelle_assert_person_state(uuid, uuid, uuid, text);
CREATE FUNCTION chronelle_assert_person_state(workspace_id uuid, object_id uuid, user_id uuid)
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
END
$$;

-- The contacts a create or update asks for: `contacts` as given, else
-- null for unchanged.
CREATE OR REPLACE FUNCTION chronelle_person_requested_contacts(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN $3 ? 'contacts' THEN $3 -> 'contacts' ELSE NULL END;
$$;

-- Replaces a Person's contacts.
CREATE OR REPLACE FUNCTION chronelle_person_set_contacts(workspace_id uuid, object_id uuid, contacts jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
BEGIN
  PERFORM chronelle_assert_person_contacts(contacts);
  DELETE FROM person_contacts c WHERE c.workspace_id = workspace_id AND c.person_id = object_id;
  INSERT INTO person_contacts (id, workspace_id, person_id, kind, value, position)
  SELECT chronelle_uuidv7(), workspace_id, object_id, entry ->> 'kind', entry ->> 'value', position - 1
  FROM jsonb_array_elements(contacts) WITH ORDINALITY AS entries(entry, position);
END
$$;

CREATE OR REPLACE FUNCTION chronelle_person_serialize(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT chronelle_serialize_object($1, $2) || jsonb_build_object(
    'objectType', 'person',
    'userId', p.user_id::text,
    'nickname', p.nickname,
    'description', p.description,
    'contacts', chronelle_person_contacts($1, $2),
    'labelIds', chronelle_person_label_ids($1, $2)
  )
  FROM persons p
  WHERE p.workspace_id = $1 AND p.object_id = $2;
$$;

CREATE OR REPLACE FUNCTION chronelle_person_insert(workspace_id uuid, object_id uuid, input jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  user_id uuid := (input ->> 'userId')::uuid;
  nickname text := input ->> 'nickname';
  description text := input ->> 'description';
  contacts jsonb := COALESCE(chronelle_person_requested_contacts(workspace_id, object_id, input), '[]'::jsonb);
BEGIN
  PERFORM chronelle_assert_person_contacts(contacts);
  PERFORM chronelle_assert_person_text(nickname, description);
  PERFORM chronelle_assert_person_state(workspace_id, object_id, user_id);
  INSERT INTO persons (object_id, workspace_id, user_id, nickname, description)
  VALUES (object_id, workspace_id, user_id, nickname, description);
  PERFORM chronelle_person_set_contacts(workspace_id, object_id, contacts);
  IF input ? 'labelIds' THEN
    PERFORM chronelle_person_set_labels(workspace_id, object_id, input -> 'labelIds');
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION chronelle_person_validate(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  current_person persons%ROWTYPE;
  contacts jsonb := chronelle_person_requested_contacts(workspace_id, object_id, changes);
BEGIN
  SELECT * INTO current_person FROM persons p
  WHERE p.workspace_id = workspace_id AND p.object_id = object_id;
  IF contacts IS NOT NULL THEN
    PERFORM chronelle_assert_person_contacts(contacts);
  END IF;
  PERFORM chronelle_assert_person_text(
    CASE WHEN changes ? 'nickname' THEN changes ->> 'nickname' ELSE current_person.nickname END,
    CASE WHEN changes ? 'description' THEN changes ->> 'description' ELSE current_person.description END
  );
  PERFORM chronelle_assert_person_state(
    workspace_id,
    object_id,
    CASE WHEN changes ? 'userId' THEN (changes ->> 'userId')::uuid ELSE current_person.user_id END
  );
END
$$;

DROP FUNCTION chronelle_person_contacts_with_email(uuid, uuid, text);
DROP FUNCTION chronelle_person_first_email(jsonb);

ALTER TABLE persons DROP CONSTRAINT persons_email_trimmed;
ALTER TABLE persons DROP COLUMN email;
