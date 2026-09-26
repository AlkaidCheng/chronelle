-- An Owner deletes a shared space that holds nothing but Trash. Deleting a
-- space marks it deleted and never purges it: the space keeps its row, its
-- records with their revisions, its audit trail, and its stored files. It
-- loses what lets anyone in: its waiting shares are revoked, then the live
-- grants on its records, then its members, each audited, so it leaves every
-- switcher and a session in it resolves as unavailable. A Personal space is
-- never deleted.
--
-- A record is live when it is not in Trash and neither is its permission
-- scope: an Event moved to Trash marks only itself, so the records in its
-- scope are in Trash with it. People cards are records. Labels and sections
-- are the space's configuration and go with it. The functions below serve
-- the preview and the deletion on the rpc route; the TypeScript store runs
-- the same steps in one transaction.
--
-- Adding a key and triggers locks their tables, so a busy lock fails fast.
SET LOCAL lock_timeout = '5s';

ALTER TABLE workspaces
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT workspaces_deletion_recorded
    CHECK ((deleted_at IS NULL) = (deleted_by IS NULL)),
  ADD CONSTRAINT workspaces_deleted_after_creation
    CHECK (deleted_at IS NULL OR deleted_at >= created_at),
  ADD CONSTRAINT workspaces_personal_kept
    CHECK (personal_owner_id IS NULL OR deleted_at IS NULL);

-- A deleted space gains no live record: a record created in it, or brought
-- back from its Trash, is refused. The guard takes the space's row in share
-- mode, so it waits for a deletion in progress, which holds the row as a
-- membership change does, and then sees it; writers in one space do not
-- wait for each other.
CREATE FUNCTION chronelle_guard_deleted_workspace()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM workspaces w WHERE w.id = NEW.workspace_id AND w.deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER objects_deleted_workspace_guard
  BEFORE INSERT ON objects
  FOR EACH ROW EXECUTE FUNCTION chronelle_guard_deleted_workspace();

CREATE TRIGGER objects_restore_deleted_workspace_guard
  BEFORE UPDATE OF deleted_at ON objects
  FOR EACH ROW WHEN (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
  EXECUTE FUNCTION chronelle_guard_deleted_workspace();

-- How many of the space's records are live and how many are in Trash.
CREATE FUNCTION chronelle_workspace_records(workspace_id uuid)
RETURNS TABLE (live_records integer, trash_records integer)
LANGUAGE sql STABLE AS $$
  SELECT count(*) FILTER (WHERE o.deleted_at IS NULL AND s.deleted_at IS NULL)::integer,
         count(*) FILTER (WHERE o.deleted_at IS NOT NULL OR s.deleted_at IS NOT NULL)::integer
  FROM objects o
  LEFT JOIN objects s ON s.workspace_id = o.workspace_id AND s.id = o.permission_scope_id
  WHERE o.workspace_id = $1;
$$;

-- Whether the caller may delete the space, and why not, in the order the
-- API reports it: a Personal space is never deleted, only an Owner deletes
-- a space, and only while it holds nothing but Trash. Any member reads it;
-- a space that does not exist or was deleted is unavailable.
CREATE FUNCTION chronelle_workspace_deletion(workspace_id uuid, user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  workspace workspaces%ROWTYPE;
  caller_role text;
  counted record;
  member_count integer;
  reason text;
BEGIN
  SELECT w.* INTO workspace FROM workspaces w WHERE w.id = workspace_id;
  IF NOT FOUND OR workspace.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'The workspace is unavailable.' USING ERRCODE = 'PT404';
  END IF;
  SELECT m.role INTO caller_role FROM workspace_members m
  WHERE m.workspace_id = workspace_id AND m.user_id = user_id;
  IF caller_role IS NULL THEN
    RAISE EXCEPTION 'The workspace is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT * INTO counted FROM chronelle_workspace_records(workspace_id);
  SELECT count(*) INTO member_count FROM workspace_members m WHERE m.workspace_id = workspace_id;
  reason := CASE
    WHEN workspace.personal_owner_id IS NOT NULL THEN 'personal'
    WHEN caller_role <> 'owner' THEN 'not_owner'
    WHEN counted.live_records > 0 THEN 'holds_records'
  END;
  RETURN jsonb_build_object(
    'deletable', reason IS NULL,
    'reason', reason,
    'liveRecords', counted.live_records,
    'trashRecords', counted.trash_records,
    'memberCount', member_count
  );
END
$$;

-- An Owner deletes a shared space that holds nothing but Trash. The space's
-- row is locked first, as membership changes lock it, so no member joins,
-- no role changes, and no record is created or restored while the rule is
-- checked and the space is emptied of access. Its waiting shares are
-- revoked, then the live grants on its records, each with its audit event;
-- then its members are removed and the space is marked deleted, audited
-- with the members and grants it lost.
CREATE FUNCTION chronelle_workspace_delete(workspace_id uuid, user_id uuid, request_id uuid, deleted_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  caller_role text;
  workspace workspaces%ROWTYPE;
  counted record;
  pending record;
  pending_ids uuid[] := '{}';
  revoked record;
  grant_ids uuid[] := '{}';
  grants jsonb := '[]'::jsonb;
  members jsonb;
BEGIN
  caller_role := chronelle_workspace_member_lock(workspace_id, user_id);
  SELECT w.* INTO workspace FROM workspaces w WHERE w.id = workspace_id;
  IF NOT FOUND OR workspace.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'The workspace is unavailable.' USING ERRCODE = 'PT404';
  END IF;
  IF workspace.personal_owner_id IS NOT NULL THEN
    RAISE EXCEPTION 'A Personal space is never deleted.' USING ERRCODE = 'PT422';
  END IF;
  IF caller_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only an Owner deletes a space.' USING ERRCODE = 'PT403';
  END IF;
  SELECT * INTO counted FROM chronelle_workspace_records(workspace_id);
  IF counted.live_records > 0 THEN
    RAISE EXCEPTION 'The space holds records; move them to another space or to Trash first.'
      USING ERRCODE = 'PT409';
  END IF;

  FOR pending IN
    SELECT p.id, p.resource_id FROM pending_shares p
    WHERE p.workspace_id = workspace_id AND p.status = 'pending'
    ORDER BY p.id
    FOR UPDATE
  LOOP
    INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
    VALUES (chronelle_uuidv7(), workspace_id, 'user', user_id, 'resource.share_queue_revoked', pending.resource_id,
            request_id, jsonb_build_object('pendingShareId', pending.id::text, 'reason', 'workspace_deleted'));
    pending_ids := pending_ids || pending.id;
  END LOOP;
  UPDATE pending_shares p SET status = 'revoked', resolved_at = GREATEST(now(), p.created_at)
  WHERE p.id = ANY (pending_ids);

  FOR revoked IN
    SELECT g.id, g.resource_id, g.principal_id, g.role FROM resource_grants g
    WHERE g.workspace_id = workspace_id AND (g.expires_at IS NULL OR g.expires_at > now())
    ORDER BY g.id
    FOR UPDATE
  LOOP
    INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
    VALUES (chronelle_uuidv7(), workspace_id, 'user', user_id, 'resource.share_revoked', revoked.resource_id,
            request_id, jsonb_build_object('grantId', revoked.id::text, 'principalId', revoked.principal_id::text,
                                           'role', revoked.role, 'reason', 'workspace_deleted'));
    grant_ids := grant_ids || revoked.id;
    grants := grants || jsonb_build_object('grantId', revoked.id::text, 'resourceId', revoked.resource_id::text,
                                           'principalId', revoked.principal_id::text, 'role', revoked.role);
  END LOOP;
  DELETE FROM resource_grants g WHERE g.id = ANY (grant_ids);

  WITH removed AS (
    DELETE FROM workspace_members m WHERE m.workspace_id = workspace_id
    RETURNING m.user_id, m.role
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('userId', r.user_id::text, 'role', r.role) ORDER BY r.user_id),
                  '[]'::jsonb)
  INTO members FROM removed r;

  UPDATE workspaces w
  SET deleted_at = GREATEST(deleted_at, w.created_at), deleted_by = user_id,
      updated_at = GREATEST(deleted_at, w.created_at)
  WHERE w.id = workspace_id
  RETURNING * INTO workspace;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), workspace_id, 'user', user_id, 'workspace.deleted', NULL, request_id,
          jsonb_build_object('displayName', workspace.display_name, 'members', members, 'grants', grants,
                             'pendingShares', cardinality(pending_ids), 'trashRecords', counted.trash_records));
  RETURN jsonb_build_object('id', workspace_id::text, 'deletedAt', chronelle_iso(workspace.deleted_at));
END
$$;

-- From 0071: a session resolves only in a space that was not deleted.
CREATE OR REPLACE FUNCTION chronelle_user_session_resolve(
  user_id uuid,
  requested_workspace_id uuid,
  object_id uuid,
  observed_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  signed_in users%ROWTYPE;
  personal_id uuid;
  requested_id uuid;
  object_workspace_id uuid;
  resolved workspaces%ROWTYPE;
BEGIN
  SELECT * INTO signed_in FROM users u WHERE u.id = user_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT w.id INTO personal_id FROM workspaces w
  WHERE w.personal_owner_id = signed_in.id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  requested_id := coalesce(requested_workspace_id, personal_id);
  IF object_id IS NOT NULL THEN
    SELECT o.workspace_id INTO object_workspace_id FROM objects o WHERE o.id = object_id;
  END IF;

  SELECT w.* INTO resolved FROM workspaces w
  WHERE w.id IN (requested_id, object_workspace_id)
    AND w.deleted_at IS NULL
    AND (
      EXISTS (
        SELECT 1 FROM workspace_members m
        WHERE m.workspace_id = w.id AND m.user_id = signed_in.id
      ) OR EXISTS (
        SELECT 1 FROM resource_grants g
        JOIN objects o ON o.id = g.resource_id AND o.workspace_id = g.workspace_id
        WHERE g.workspace_id = w.id
          AND g.principal_type = 'user' AND g.principal_id = signed_in.id
          AND (g.expires_at IS NULL OR g.expires_at > observed_at)
          AND (o.deleted_at IS NULL OR g.role = 'owner')
      )
    )
  ORDER BY CASE WHEN w.id = object_workspace_id THEN 0 ELSE 1 END
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The requested workspace is unavailable.' USING ERRCODE = 'PT404';
  END IF;

  RETURN jsonb_build_object('user', to_jsonb(signed_in), 'workspace', to_jsonb(resolved));
END
$$;

REVOKE ALL ON FUNCTION chronelle_guard_deleted_workspace() FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_workspace_records(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_workspace_deletion(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_workspace_delete(uuid, uuid, uuid, timestamptz) FROM PUBLIC;

DO $$
DECLARE
  signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'chronelle_workspace_records(uuid)',
    'chronelle_workspace_deletion(uuid, uuid)',
    'chronelle_workspace_delete(uuid, uuid, uuid, timestamptz)'
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
