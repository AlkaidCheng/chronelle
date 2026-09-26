-- Spaces people create and share. A shared workspace has any number of
-- Owners and always at least one; a Personal workspace keeps its account as
-- its only Owner, its name, and its owner. Every membership change locks the
-- workspace row first, so changes to one workspace's members run one at a
-- time and the at-least-one-Owner rule holds under concurrency.

-- The caller's role in the workspace (NULL when not a member), taken after
-- locking the workspace row as protected mutations in it do.
CREATE FUNCTION chronelle_workspace_member_lock(workspace_id uuid, user_id uuid)
RETURNS text LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  caller_role text;
BEGIN
  PERFORM 1 FROM workspaces w WHERE w.id = workspace_id FOR NO KEY UPDATE;
  SELECT m.role INTO caller_role FROM workspace_members m
  WHERE m.workspace_id = workspace_id AND m.user_id = user_id;
  RETURN caller_role;
END
$$;

-- A workspace as the switcher lists it for the caller.
CREATE FUNCTION chronelle_workspace_json(workspace workspaces, user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  owner_name text;
  caller_role text;
BEGIN
  SELECT u.display_name INTO owner_name FROM users u
  WHERE u.id = COALESCE(workspace.personal_owner_id, workspace.created_by);
  SELECT m.role INTO caller_role FROM workspace_members m
  WHERE m.workspace_id = workspace.id AND m.user_id = user_id;
  RETURN jsonb_build_object(
    'id', workspace.id::text,
    'displayName', workspace.display_name,
    'personal', workspace.personal_owner_id IS NOT NULL,
    'ownerDisplayName', owner_name,
    'role', caller_role
  );
END
$$;

-- A new shared workspace with the caller as its Owner.
CREATE FUNCTION chronelle_workspace_create(user_id uuid, request_id uuid, display_name text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  workspace workspaces%ROWTYPE;
BEGIN
  IF display_name IS NULL OR btrim(display_name) = '' THEN
    RAISE EXCEPTION 'displayName is required.' USING ERRCODE = 'PT422';
  END IF;
  INSERT INTO workspaces (id, display_name, created_by)
  VALUES (chronelle_uuidv7(), btrim(display_name), user_id)
  RETURNING * INTO workspace;
  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (workspace.id, user_id, 'owner');
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), workspace.id, 'user', user_id, 'workspace.created', NULL, request_id,
          jsonb_build_object('displayName', workspace.display_name));
  RETURN chronelle_workspace_json(workspace, user_id);
END
$$;

-- An Owner renames a shared workspace; a Personal one keeps its name.
CREATE FUNCTION chronelle_workspace_update(workspace_id uuid, user_id uuid, request_id uuid, display_name text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  workspace workspaces%ROWTYPE;
  previous_name text;
BEGIN
  IF chronelle_workspace_member_lock(workspace_id, user_id) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'The workspace is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF display_name IS NULL OR btrim(display_name) = '' THEN
    RAISE EXCEPTION 'displayName is required.' USING ERRCODE = 'PT422';
  END IF;
  SELECT w.* INTO workspace FROM workspaces w WHERE w.id = workspace_id;
  IF workspace.personal_owner_id IS NOT NULL THEN
    RAISE EXCEPTION 'A Personal space keeps its name.' USING ERRCODE = 'PT422';
  END IF;
  previous_name := workspace.display_name;
  UPDATE workspaces w SET display_name = btrim(display_name), updated_at = GREATEST(now(), w.created_at)
  WHERE w.id = workspace_id
  RETURNING * INTO workspace;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), workspace_id, 'user', user_id, 'workspace.renamed', NULL, request_id,
          jsonb_build_object('displayName', workspace.display_name, 'previousName', previous_name));
  RETURN chronelle_workspace_json(workspace, user_id);
END
$$;

-- An Owner adds a friend as a member with any role, or changes the role of
-- a friend who already is one. A Personal workspace has one Owner.
CREATE OR REPLACE FUNCTION chronelle_workspace_member_add(workspace_id uuid, user_id uuid, request_id uuid, friend_id uuid, role text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  connection user_connections%ROWTYPE;
  member_id uuid;
  member workspace_members%ROWTYPE;
BEGIN
  IF chronelle_workspace_member_lock(workspace_id, user_id) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'The workspace is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF role IS NULL OR role NOT IN ('owner', 'editor', 'viewer') THEN
    RAISE EXCEPTION 'role must be owner, editor, or viewer.' USING ERRCODE = 'PT422';
  END IF;
  IF role = 'owner' AND EXISTS (
    SELECT 1 FROM workspaces w WHERE w.id = workspace_id AND w.personal_owner_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A Personal space has one Owner.' USING ERRCODE = 'PT422';
  END IF;
  SELECT c.* INTO connection FROM user_connections c
  WHERE c.id = friend_id AND c.status = 'accepted' AND (c.requester_id = user_id OR c.addressee_id = user_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The friend does not exist.' USING ERRCODE = 'PT404';
  END IF;
  member_id := CASE WHEN connection.requester_id = user_id THEN connection.addressee_id ELSE connection.requester_id END;
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

-- An Owner changes a member's role. The Owner of a Personal workspace keeps
-- the role, a Personal workspace has one Owner, and a shared one keeps at
-- least one.
CREATE FUNCTION chronelle_workspace_member_role(workspace_id uuid, user_id uuid, request_id uuid, member_id uuid, role text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  personal_owner uuid;
  previous_role text;
  member workspace_members%ROWTYPE;
BEGIN
  IF chronelle_workspace_member_lock(workspace_id, user_id) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'The workspace is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF role IS NULL OR role NOT IN ('owner', 'editor', 'viewer') THEN
    RAISE EXCEPTION 'role must be owner, editor, or viewer.' USING ERRCODE = 'PT422';
  END IF;
  SELECT m.role INTO previous_role FROM workspace_members m
  WHERE m.workspace_id = workspace_id AND m.user_id = member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The member does not exist.' USING ERRCODE = 'PT404';
  END IF;
  SELECT w.personal_owner_id INTO personal_owner FROM workspaces w WHERE w.id = workspace_id;
  IF personal_owner = member_id THEN
    RAISE EXCEPTION 'The Owner of a Personal space keeps the role.' USING ERRCODE = 'PT422';
  END IF;
  IF personal_owner IS NOT NULL AND role = 'owner' THEN
    RAISE EXCEPTION 'A Personal space has one Owner.' USING ERRCODE = 'PT422';
  END IF;
  IF previous_role = 'owner' AND role <> 'owner' AND NOT EXISTS (
    SELECT 1 FROM workspace_members m
    WHERE m.workspace_id = workspace_id AND m.role = 'owner' AND m.user_id <> member_id
  ) THEN
    RAISE EXCEPTION 'A space keeps at least one Owner.' USING ERRCODE = 'PT409';
  END IF;
  UPDATE workspace_members m SET role = role
  WHERE m.workspace_id = workspace_id AND m.user_id = member_id
  RETURNING * INTO member;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), workspace_id, 'user', user_id, 'workspace.member_role_changed', NULL, request_id,
          jsonb_build_object('memberId', member_id::text, 'role', role, 'previousRole', previous_role));
  RETURN chronelle_workspace_member_json(workspace_id, user_id, member);
END
$$;

-- An Owner removes a member other than the Owner of a Personal workspace
-- and other than themselves (who leave instead); the member's direct grants
-- in the workspace stay.
CREATE OR REPLACE FUNCTION chronelle_workspace_member_remove(workspace_id uuid, user_id uuid, request_id uuid, member_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  member workspace_members%ROWTYPE;
BEGIN
  IF chronelle_workspace_member_lock(workspace_id, user_id) IS DISTINCT FROM 'owner' THEN
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

-- A member leaves the workspace. The Owner of a Personal workspace stays,
-- and the last Owner of a shared one makes another member an Owner first.
CREATE FUNCTION chronelle_workspace_leave(workspace_id uuid, user_id uuid, request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  caller_role text;
BEGIN
  caller_role := chronelle_workspace_member_lock(workspace_id, user_id);
  IF caller_role IS NULL THEN
    RAISE EXCEPTION 'The workspace is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_id AND w.personal_owner_id = user_id) THEN
    RAISE EXCEPTION 'The Owner of a Personal space cannot leave it.' USING ERRCODE = 'PT422';
  END IF;
  IF caller_role = 'owner' AND NOT EXISTS (
    SELECT 1 FROM workspace_members m
    WHERE m.workspace_id = workspace_id AND m.role = 'owner' AND m.user_id <> user_id
  ) THEN
    RAISE EXCEPTION 'A space keeps at least one Owner.' USING ERRCODE = 'PT409';
  END IF;
  DELETE FROM workspace_members m WHERE m.workspace_id = workspace_id AND m.user_id = user_id;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), workspace_id, 'user', user_id, 'workspace.member_left', NULL, request_id,
          jsonb_build_object('role', caller_role));
  RETURN jsonb_build_object('userId', user_id::text, 'left', true);
END
$$;

REVOKE ALL ON FUNCTION chronelle_workspace_member_lock(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_workspace_json(workspaces, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_workspace_create(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_workspace_update(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_workspace_member_role(uuid, uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_workspace_leave(uuid, uuid, uuid) FROM PUBLIC;

DO $$
DECLARE
  signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'chronelle_workspace_member_lock(uuid, uuid)',
    'chronelle_workspace_json(workspaces, uuid)',
    'chronelle_workspace_create(uuid, uuid, text)',
    'chronelle_workspace_update(uuid, uuid, uuid, text)',
    'chronelle_workspace_member_role(uuid, uuid, uuid, uuid, text)',
    'chronelle_workspace_leave(uuid, uuid, uuid)'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', signature);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', signature);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', signature);
    END IF;
  END LOOP;
END
$$;
