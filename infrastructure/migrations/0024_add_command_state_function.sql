-- The reversible command state as a read-only database function: the
-- caller's stack version and the undo and redo heads, each computed with
-- the service's edit-permission and version checks. Completes the commands
-- family of migration 0023 for a deployment that reads through the gateway.

-- The authorization service's "edit" decision: a live object, and an
-- owner or editor role from workspace membership, an active direct grant,
-- or an active grant on the object's live canonical scope.
CREATE FUNCTION chronelle_can_edit_live(workspace_id uuid, user_id uuid, object_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM objects o
    WHERE o.workspace_id = $1 AND o.id = $3 AND o.deleted_at IS NULL
      AND (
        EXISTS (
          SELECT 1 FROM workspace_members m
          WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.role IN ('owner', 'editor')
        ) OR EXISTS (
          SELECT 1 FROM resource_grants g
          WHERE g.workspace_id = $1
            AND g.principal_type = 'user'
            AND g.principal_id = $2
            AND g.role IN ('owner', 'editor')
            AND (g.expires_at IS NULL OR g.expires_at > now())
            AND g.resource_id = o.id
        ) OR EXISTS (
          SELECT 1 FROM resource_grants g
          JOIN objects scope ON scope.workspace_id = g.workspace_id AND scope.id = g.resource_id
          WHERE g.workspace_id = $1
            AND g.principal_type = 'user'
            AND g.principal_id = $2
            AND g.role IN ('owner', 'editor')
            AND (g.expires_at IS NULL OR g.expires_at > now())
            AND g.resource_id = o.permission_scope_id
            AND scope.deleted_at IS NULL
        )
      )
  );
$$;

-- ReversibleCommandService.readHead(): the head {commandId, available} of
-- one list, JSON null when there is no head or the caller may no longer
-- edit one of its objects; available is false when an object moved past
-- the version the stack expects.
CREATE FUNCTION chronelle_command_head(
  workspace_id uuid,
  user_id uuid,
  expected_versions jsonb,
  command_id uuid
)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  change command_changes%ROWTYPE;
  current_version integer;
  available boolean := true;
  has_changes boolean := false;
BEGIN
  IF command_id IS NULL THEN
    RETURN 'null'::jsonb;
  END IF;
  FOR change IN
    SELECT * FROM command_changes c
    WHERE c.workspace_id = workspace_id AND c.user_id = user_id AND c.command_id = command_id
    ORDER BY c.object_id
  LOOP
    has_changes := true;
    IF NOT chronelle_can_edit_live(workspace_id, user_id, change.object_id) THEN
      RETURN 'null'::jsonb;
    END IF;
    SELECT o.version INTO current_version FROM objects o
    WHERE o.workspace_id = workspace_id AND o.id = change.object_id;
    IF current_version IS DISTINCT FROM (expected_versions ->> change.object_id::text)::integer THEN
      available := false;
    END IF;
  END LOOP;
  IF NOT has_changes THEN
    RAISE EXCEPTION 'The command history changed. Refresh before trying again.' USING ERRCODE = 'PT409';
  END IF;
  RETURN jsonb_build_object('commandId', command_id::text, 'available', available);
END
$$;

-- ReversibleCommandService.getState(): {version, undo, redo}. The undo head
-- is reported even when unavailable; the redo head only when available.
CREATE FUNCTION chronelle_command_state(workspace_id uuid, user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  stack command_stacks%ROWTYPE;
  undo_head jsonb;
  redo_head jsonb;
BEGIN
  SELECT * INTO stack FROM command_stacks s
  WHERE s.workspace_id = workspace_id AND s.user_id = user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('version', 0, 'undo', NULL, 'redo', NULL);
  END IF;
  undo_head := chronelle_command_head(workspace_id, user_id, stack.expected_versions,
                                      stack.undo_ids[cardinality(stack.undo_ids)]);
  redo_head := chronelle_command_head(workspace_id, user_id, stack.expected_versions,
                                      stack.redo_ids[cardinality(stack.redo_ids)]);
  RETURN jsonb_build_object(
    'version', stack.version,
    'undo', undo_head,
    'redo', CASE WHEN redo_head ->> 'available' = 'true' THEN redo_head ELSE 'null'::jsonb END);
END
$$;
