-- Every account has a username, the one readable handle it carries
-- whatever it signed up with: 3 to 30 characters, letters, digits, hyphen
-- or underscore, starting with a letter, unique without regard to case.
-- Sign-up asks for one; an account created without choosing gets one from
-- its name, with a number when that is taken; it is not changed afterwards.
-- Who can
-- find the account is the account's choice: by username always, by name
-- and by email each switchable off. Find people searches the accounts by
-- @username, name, or exact email, and a request goes to an account by
-- id; both through the functions below on the rpc path, and through the
-- same rules in the PostgreSQL stores.
ALTER TABLE users
  ADD COLUMN username text,
  ADD COLUMN find_by_name boolean NOT NULL DEFAULT true,
  ADD COLUMN find_by_email boolean NOT NULL DEFAULT true;

-- A username from a name: its letters and digits, lowercased, with runs of
-- anything else as one hyphen; started with a letter and at least three
-- characters long, "user" when the name gives nothing usable.
CREATE FUNCTION chronelle_username_slug(display_name text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  base text;
BEGIN
  base := lower(regexp_replace(COALESCE(display_name, ''), '[^A-Za-z0-9]+', '-', 'g'));
  base := btrim(base, '-');
  IF base !~ '^[a-z]' THEN
    base := 'u' || base;
  END IF;
  base := btrim(base, '-');
  IF length(base) < 3 THEN
    base := 'user';
  END IF;
  RETURN left(base, 30);
END
$$;

-- The username an account gets: the one it asked for when free and well
-- formed, else the one its name gives, numbered until free.
CREATE FUNCTION chronelle_username_assign(display_name text, wanted text)
RETURNS text LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  base text;
  candidate text;
  n integer := 1;
BEGIN
  IF wanted IS NOT NULL THEN
    IF wanted !~ '^[A-Za-z][A-Za-z0-9_-]{2,29}$' THEN
      RAISE EXCEPTION 'A username is 3 to 30 letters, digits, hyphens or underscores, starting with a letter.' USING ERRCODE = 'PT422';
    END IF;
    IF EXISTS (SELECT 1 FROM users u WHERE lower(u.username) = lower(wanted)) THEN
      RAISE EXCEPTION 'That username is taken.' USING ERRCODE = 'PT409';
    END IF;
    RETURN wanted;
  END IF;
  base := chronelle_username_slug(display_name);
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM users u WHERE lower(u.username) = candidate) LOOP
    n := n + 1;
    candidate := left(base, 30 - length(n::text)) || n::text;
  END LOOP;
  RETURN candidate;
END
$$;

-- Every account that exists gets its username from its name, oldest first.
DO $$
DECLARE
  account record;
BEGIN
  FOR account IN SELECT u.id, u.display_name FROM users u WHERE u.username IS NULL ORDER BY u.created_at, u.id LOOP
    UPDATE users SET username = chronelle_username_assign(account.display_name, NULL) WHERE id = account.id;
  END LOOP;
END
$$;

ALTER TABLE users
  ALTER COLUMN username SET NOT NULL,
  ADD CONSTRAINT users_username_shape CHECK (username ~ '^[A-Za-z][A-Za-z0-9_-]{2,29}$');

CREATE UNIQUE INDEX users_username_lower_idx ON users (lower(username));

-- Find people by name: the name folded (accents dropped, lowercased, one
-- space between words) and indexed by trigrams, so a fragment, a word
-- prefix, or a near miss is found through the index and scored by
-- trigram similarity. Usernames get the same index for prefixes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE FUNCTION chronelle_search_fold(value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(lower(public.unaccent(COALESCE(value, ''))), '\s+', ' ', 'g'));
$$;

CREATE INDEX users_search_name_trgm_idx ON users USING gin (chronelle_search_fold(display_name) gin_trgm_ops);
CREATE INDEX users_username_trgm_idx ON users USING gin (lower(username) gin_trgm_ops);

-- Every account gets a username whichever way it is created: an insert
-- without one (null or empty) gets one from the name before the row lands.
CREATE FUNCTION chronelle_users_username_default()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.username IS NULL OR NEW.username = '' THEN
    NEW.username := chronelle_username_assign(NEW.display_name, NULL);
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER users_username_default
BEFORE INSERT ON users
FOR EACH ROW EXECUTE FUNCTION chronelle_users_username_default();

-- The sign-in creates the account with its username: the one sign-up
-- chose, else one from the name. An account that exists keeps its own.
DROP FUNCTION chronelle_identity_sign_in(text, text, text, text, uuid);
CREATE FUNCTION chronelle_identity_sign_in(
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
    INSERT INTO users (id, identity_provider, provider_subject, email, display_name, username)
    VALUES (chronelle_uuidv7(), identity_provider, provider_subject, email, display_name,
            chronelle_username_assign(display_name, username))
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

-- A LIKE pattern for the text as typed: its wildcards mean themselves.
CREATE FUNCTION chronelle_like_escape(value text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(value, '\', '\\'), '%', '\%'), '_', '\_');
$$;

-- How two accounts stand: friends, a request the first sent, a request
-- the first received, or nothing.
CREATE FUNCTION chronelle_friend_relation(user_id uuid, other_id uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN c.status = 'accepted' THEN 'friend'
      WHEN c.requester_id = user_id THEN 'requested'
      ELSE 'incoming' END
    FROM user_connections c
    WHERE c.status IN ('pending', 'accepted')
      AND LEAST(c.requester_id, c.addressee_id) = LEAST(user_id, other_id)
      AND GREATEST(c.requester_id, c.addressee_id) = GREATEST(user_id, other_id)
    LIMIT 1
  ), 'none');
$$;

-- An account as Find people and the code page show it to the viewer.
CREATE FUNCTION chronelle_user_summary(account users, viewer_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id', account.id::text,
    'displayName', account.display_name,
    'username', account.username,
    'relation', chronelle_friend_relation(viewer_id, account.id)
  );
$$;

-- Sets the discovery switches; each key present in the patch replaces the
-- stored value. The username is not changed here: it is chosen once, at
-- sign-up, and a change needs its own flow. The account is returned as the
-- next session read shows it.
CREATE FUNCTION chronelle_account_update(user_id uuid, patch jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  updated users%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = user_id) THEN
    RAISE EXCEPTION 'The user does not exist.' USING ERRCODE = 'PT404';
  END IF;
  IF patch ? 'username' THEN
    RAISE EXCEPTION 'The username cannot be changed.' USING ERRCODE = 'PT422';
  END IF;
  IF (patch ? 'findByName' AND jsonb_typeof(patch->'findByName') <> 'boolean')
     OR (patch ? 'findByEmail' AND jsonb_typeof(patch->'findByEmail') <> 'boolean') THEN
    RAISE EXCEPTION 'A discovery switch is true or false.' USING ERRCODE = 'PT422';
  END IF;
  UPDATE users u SET
    find_by_name = CASE WHEN patch ? 'findByName' THEN (patch->>'findByName')::boolean ELSE u.find_by_name END,
    find_by_email = CASE WHEN patch ? 'findByEmail' THEN (patch->>'findByEmail')::boolean ELSE u.find_by_email END,
    updated_at = now()
  WHERE u.id = user_id
  RETURNING * INTO updated;
  RETURN to_jsonb(updated);
END
$$;

-- Find people: "@name" matches usernames that start so; an address matches
-- the one account with that email that lets itself be found by it; any
-- other text matches, among accounts that let themselves be found by
-- name, names that contain it or come close to it (trigram similarity of
-- 0.45 or more, which a typo in a full name clears and a shared word does
-- not; from four characters), and usernames that start so. The searcher
-- is left out; at most ten, ranked: the exact username, then a username
-- prefix, then a name whose word starts with the text, then a name that
-- contains it, then by similarity, then by name.
CREATE FUNCTION chronelle_users_search(user_id uuid, query text)
RETURNS jsonb LANGUAGE plpgsql STABLE
SET pg_trgm.similarity_threshold = 0.45
AS $$
#variable_conflict use_variable
DECLARE
  q text := btrim(COALESCE(query, ''));
  fq text;
  pattern text;
  items jsonb := '[]'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = user_id) THEN
    RAISE EXCEPTION 'The user does not exist.' USING ERRCODE = 'PT404';
  END IF;
  IF length(q) < 2 THEN
    RETURN jsonb_build_object('items', items);
  END IF;
  IF left(q, 1) = '@' THEN
    q := substr(q, 2);
    SELECT COALESCE(jsonb_agg(chronelle_user_summary(x.account, user_id) ORDER BY x.exact DESC, x.uname), '[]'::jsonb) INTO items
    FROM (
      SELECT u AS account, lower(u.username) AS uname, lower(u.username) = lower(q) AS exact
      FROM users u
      WHERE u.id <> user_id
        AND lower(u.username) LIKE chronelle_like_escape(lower(q)) || '%'
      ORDER BY exact DESC, uname
      LIMIT 10
    ) x;
  ELSIF position('@' IN q) > 0 THEN
    SELECT COALESCE(jsonb_agg(chronelle_user_summary(x.account, user_id)), '[]'::jsonb) INTO items
    FROM (
      SELECT u AS account FROM users u
      WHERE u.id <> user_id AND u.find_by_email AND chronelle_friend_account_email(u) = lower(q)
      LIMIT 10
    ) x;
  ELSE
    fq := chronelle_search_fold(q);
    pattern := chronelle_like_escape(fq);
    SELECT COALESCE(jsonb_agg(chronelle_user_summary(x.account, user_id)
      ORDER BY x.exact DESC, x.handle_prefix DESC, x.word_prefix DESC, x.contains DESC, x.score DESC, x.sname), '[]'::jsonb) INTO items
    FROM (
      SELECT u AS account,
        chronelle_search_fold(u.display_name) AS sname,
        lower(u.username) = fq AS exact,
        lower(u.username) LIKE pattern || '%' AS handle_prefix,
        u.find_by_name AND (chronelle_search_fold(u.display_name) LIKE pattern || '%'
          OR chronelle_search_fold(u.display_name) LIKE '% ' || pattern || '%') AS word_prefix,
        u.find_by_name AND chronelle_search_fold(u.display_name) LIKE '%' || pattern || '%' AS contains,
        CASE WHEN u.find_by_name THEN similarity(chronelle_search_fold(u.display_name), fq) ELSE 0 END AS score
      FROM users u
      WHERE u.id <> user_id AND (
        lower(u.username) LIKE pattern || '%'
        OR (u.find_by_name AND (
          chronelle_search_fold(u.display_name) LIKE '%' || pattern || '%'
          OR (length(fq) >= 4 AND chronelle_search_fold(u.display_name) % fq)))
      )
      ORDER BY exact DESC, handle_prefix DESC, word_prefix DESC, contains DESC, score DESC, sname
      LIMIT 10
    ) x;
  END IF;
  RETURN jsonb_build_object('items', items);
END
$$;

-- Whether a username is free, for the sign-up screen: false as well for
-- one of the wrong shape, so the screen never offers it.
CREATE FUNCTION chronelle_username_available(candidate text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT candidate ~ '^[A-Za-z][A-Za-z0-9_-]{2,29}$'
    AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.username) = lower(candidate));
$$;

-- The account behind a code: by username, for a signed-in viewer.
CREATE FUNCTION chronelle_user_lookup(user_id uuid, username text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  account users%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = user_id) THEN
    RAISE EXCEPTION 'The user does not exist.' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO account FROM users u WHERE lower(u.username) = lower(COALESCE(username, ''));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The user does not exist.' USING ERRCODE = 'PT404';
  END IF;
  RETURN chronelle_user_summary(account, user_id);
END
$$;

-- A friend request to an account by id, from Find people or the code page:
-- the same request an invitation to a known address makes, with the same
-- refusals, and the same daily allowance shared with invitations.
CREATE FUNCTION chronelle_friend_request(
  user_id uuid,
  addressee_id uuid,
  message text,
  person_id uuid,
  workspace_id uuid,
  daily_limit integer,
  request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  me users%ROWTYPE;
  recipient users%ROWTYPE;
  existing user_connections%ROWTYPE;
  connection user_connections%ROWTYPE;
  home uuid;
  sent_today integer;
  sent_at timestamptz := now();
BEGIN
  SELECT * INTO me FROM users u WHERE u.id = user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The user does not exist.' USING ERRCODE = 'PT404';
  END IF;
  home := chronelle_friend_home_workspace(user_id);
  SELECT * INTO recipient FROM users u WHERE u.id = addressee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The person is unavailable.' USING ERRCODE = 'PT404';
  END IF;
  IF addressee_id = user_id THEN
    RAISE EXCEPTION 'You cannot add yourself.' USING ERRCODE = 'PT422';
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
  SELECT * INTO existing FROM user_connections c
  WHERE c.status IN ('pending', 'accepted')
    AND LEAST(c.requester_id, c.addressee_id) = LEAST(user_id, addressee_id)
    AND GREATEST(c.requester_id, c.addressee_id) = GREATEST(user_id, addressee_id);
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
  VALUES (chronelle_uuidv7(), user_id, addressee_id, 'pending', message, person_id, workspace_id, sent_at, sent_at)
  RETURNING * INTO connection;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), home, 'user', user_id, 'friend.invited', NULL, request_id,
          jsonb_build_object('connectionId', connection.id::text, 'addresseeId', addressee_id::text));
  RETURN jsonb_build_object(
    'kind', 'connection',
    'item', chronelle_friend_connection_json(connection, user_id) || jsonb_build_object('kind', 'connection', 'expiresAt', NULL),
    'recipient', jsonb_build_object('userId', recipient.id::text, 'email', chronelle_friend_account_email(recipient), 'displayName', recipient.display_name, 'locale', recipient.locale),
    'sender', jsonb_build_object('displayName', me.display_name, 'email', chronelle_friend_account_email(me), 'locale', me.locale)
  );
END
$$;
