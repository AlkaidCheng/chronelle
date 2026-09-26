-- An Owner of a space moves an Event, with everything in its permission
-- scope, to another space where they can add records. The records keep
-- their ids, versions, and history; what linked them to records that stay
-- behind is dropped with an audit event each: relations to records outside
-- the scope, task assignees (People cards never move), and the scope of the
-- People cards scoped to the Event, which stay and become their own scope.
-- A task's labels join the new space's labels of the same name, created
-- when missing. The functions below serve the move on the rpc route; the
-- TypeScript service runs the same steps in one transaction.
--
-- Dropping a foreign key and creating a trigger lock their tables, so a
-- busy lock fails fast.
SET LOCAL lock_timeout = '5s';

-- A context creation's record keeps the id of the relation it created as a
-- recorded fact, as audit metadata does. A move deletes the relations it
-- drops, so the record no longer holds its relation by key.
ALTER TABLE event_context_commands
  DROP CONSTRAINT event_context_commands_relation_id_fkey;

-- A relation is removed by a soft delete with a version step. A move is the
-- one writer that deletes relations, and it sets chronelle.relation_drop
-- for its own transaction first.
CREATE FUNCTION chronelle_guard_relation_drop()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('chronelle.relation_drop', true) IS DISTINCT FROM 'move' THEN
    RAISE EXCEPTION 'A relation is removed with a version step; only a move drops one.'
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END
$$;

CREATE TRIGGER object_relations_drop_guard
  BEFORE DELETE ON object_relations
  FOR EACH ROW EXECUTE FUNCTION chronelle_guard_relation_drop();

-- The records a move of an Event carries, in id order: the Event and
-- everything in its scope but People cards, trashed records included.
CREATE FUNCTION chronelle_object_move_scope(workspace_id uuid, event_id uuid)
RETURNS uuid[] LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_agg(o.id ORDER BY o.id), '{}'::uuid[])
  FROM objects o
  WHERE o.workspace_id = $1
    AND (o.id = $2 OR (o.permission_scope_id = $2 AND o.object_type <> 'person'));
$$;

-- The live grants on the carried records, each with its grantee's role in
-- the target space; a grant is covered when that role gives at least as
-- much, and the move deletes it.
CREATE FUNCTION chronelle_object_move_grants(workspace_id uuid, target_workspace_id uuid, scope uuid[])
RETURNS TABLE (grant_id uuid, resource_id uuid, principal_id uuid, role text, member_role text, covered boolean)
LANGUAGE sql STABLE AS $$
  SELECT g.id, g.resource_id, g.principal_id, g.role, m.role,
         m.role IS NOT NULL AND chronelle_role_rank(m.role) >= chronelle_role_rank(g.role)
  FROM resource_grants g
  LEFT JOIN workspace_members m ON m.workspace_id = $2 AND m.user_id = g.principal_id
  WHERE g.workspace_id = $1 AND g.resource_id = ANY ($3)
    AND (g.expires_at IS NULL OR g.expires_at > now());
$$;

-- Refuses a move of the object that the caller may not make, in the order
-- the API reports it: an object the caller cannot see is unavailable, only
-- an Owner of its space moves it, and only an Event that is its own scope
-- and not in Trash moves.
CREATE FUNCTION chronelle_object_move_source_check(workspace_id uuid, user_id uuid, object_id uuid)
RETURNS void LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  moved objects%ROWTYPE;
  caller_role text;
BEGIN
  SELECT o.* INTO moved FROM objects o WHERE o.workspace_id = workspace_id AND o.id = object_id;
  SELECT m.role INTO caller_role FROM workspace_members m
  WHERE m.workspace_id = workspace_id AND m.user_id = user_id;
  IF moved.id IS NULL OR (caller_role IS NULL AND NOT chronelle_can_view(workspace_id, user_id, object_id)) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF caller_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only an Owner of the space moves its records, into a space where they can add records.'
      USING ERRCODE = 'PT403';
  END IF;
  IF moved.object_type <> 'event' OR moved.permission_scope_id <> moved.id OR moved.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only an Event that is its own scope and not in Trash moves.' USING ERRCODE = 'PT422';
  END IF;
END
$$;

-- Refuses a target the caller may not move into: the space the record is
-- in, a space they are not a member of, and one where they only view.
CREATE FUNCTION chronelle_object_move_target_check(workspace_id uuid, user_id uuid, target_workspace_id uuid)
RETURNS void LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  target_role text;
BEGIN
  IF target_workspace_id = workspace_id THEN
    RAISE EXCEPTION 'The record is already in that space.' USING ERRCODE = 'PT422';
  END IF;
  SELECT m.role INTO target_role FROM workspace_members m
  WHERE m.workspace_id = target_workspace_id AND m.user_id = user_id;
  IF target_role IS NULL THEN
    RAISE EXCEPTION 'The workspace is unavailable.' USING ERRCODE = 'PT404';
  END IF;
  IF target_role NOT IN ('owner', 'editor') THEN
    RAISE EXCEPTION 'Only an Owner of the space moves its records, into a space where they can add records.'
      USING ERRCODE = 'PT403';
  END IF;
END
$$;

-- What a move of the Event into the target space carries, drops, and
-- changes, as the preview reports it. Lists hold at most 100 items beside
-- their exact totals. The links the move drops with a warning are the live
-- relations between live records that cross the scope and the live tasks
-- assigned to a live People card; the rest it clears silently.
CREATE FUNCTION chronelle_object_move_plan(workspace_id uuid, user_id uuid, object_id uuid, target_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  scope uuid[] := chronelle_object_move_scope(workspace_id, object_id);
  source workspaces%ROWTYPE;
  target workspaces%ROWTYPE;
  moves jsonb;
  crossing integer;
  assigned integer;
  dropped jsonb;
  unassigned jsonb;
  label_names jsonb;
  people jsonb;
  keeping jsonb;
  covered jsonb;
  losing jsonb;
  members jsonb;
  lapsing integer;
BEGIN
  SELECT w.* INTO source FROM workspaces w WHERE w.id = workspace_id;
  SELECT w.* INTO target FROM workspaces w WHERE w.id = target_workspace_id;

  SELECT jsonb_build_object(
    'scheduleItems', count(*) FILTER (WHERE o.live AND o.object_type = 'event' AND o.id <> object_id),
    'todos', count(*) FILTER (WHERE o.live AND o.object_type = 'task' AND t.parent_task_id IS NULL),
    'subtasks', count(*) FILTER (WHERE o.live AND o.object_type = 'task' AND t.parent_task_id IS NOT NULL),
    'expenses', count(*) FILTER (WHERE o.live AND o.object_type = 'expense'),
    'reminders', count(*) FILTER (WHERE o.live AND o.object_type = 'reminder'),
    'notes', count(*) FILTER (WHERE o.live AND o.object_type = 'note'),
    'files', count(*) FILTER (WHERE o.live AND o.object_type = 'document'),
    'inTrash', count(*) FILTER (WHERE NOT o.live),
    'sections', (SELECT count(*) FROM sections s WHERE s.workspace_id = workspace_id AND s.event_id = object_id),
    'pages', COALESCE((
      SELECT jsonb_array_length(p.pages) FROM event_page_revisions p
      WHERE p.event_id = object_id ORDER BY p.version DESC LIMIT 1), 0),
    'shares', (SELECT count(*) FROM chronelle_object_move_grants(workspace_id, target_workspace_id, scope) g
               WHERE NOT g.covered),
    'pendingShares', (SELECT count(*) FROM pending_shares p
                      WHERE p.workspace_id = workspace_id AND p.resource_id = ANY (scope) AND p.status = 'pending')
  ) INTO moves
  FROM (SELECT o.id, o.object_type, o.deleted_at IS NULL AS live FROM objects o
        WHERE o.workspace_id = workspace_id AND o.id = ANY (scope)) o
  LEFT JOIN tasks t ON t.object_id = o.id;

  SELECT count(*) INTO crossing FROM object_relations r
  WHERE r.workspace_id = workspace_id
    AND (r.source_object_id = ANY (scope)) <> (r.target_object_id = ANY (scope));
  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(listed.item ORDER BY listed.place) FILTER (WHERE listed.place <= 100), '[]'::jsonb),
    'total', count(*)
  ) INTO dropped
  FROM (
    SELECT jsonb_build_object(
      'relationId', r.id::text,
      'relationType', r.relation_type,
      'scoped', jsonb_build_object('id', s.id::text, 'objectType', s.object_type, 'displayName', s.display_name),
      'other', jsonb_build_object('id', x.id::text, 'objectType', x.object_type, 'displayName', x.display_name)
    ) AS item, row_number() OVER (ORDER BY r.id) AS place
    FROM object_relations r
    JOIN objects s ON s.id = CASE WHEN r.source_object_id = ANY (scope) THEN r.source_object_id ELSE r.target_object_id END
    JOIN objects x ON x.id = CASE WHEN r.source_object_id = ANY (scope) THEN r.target_object_id ELSE r.source_object_id END
    WHERE r.workspace_id = workspace_id
      AND (r.source_object_id = ANY (scope)) <> (r.target_object_id = ANY (scope))
      AND r.deleted_at IS NULL AND s.deleted_at IS NULL AND x.deleted_at IS NULL
  ) listed;

  SELECT count(*) INTO assigned FROM tasks t
  WHERE t.workspace_id = workspace_id AND t.object_id = ANY (scope) AND t.assignee_person_id IS NOT NULL;
  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(listed.item ORDER BY listed.place) FILTER (WHERE listed.place <= 100), '[]'::jsonb),
    'total', count(*)
  ) INTO unassigned
  FROM (
    SELECT jsonb_build_object(
      'taskId', o.id::text,
      'displayName', o.display_name,
      'person', jsonb_build_object('id', p.id::text, 'displayName', p.display_name)
    ) AS item, row_number() OVER (ORDER BY o.id) AS place
    FROM tasks t
    JOIN objects o ON o.id = t.object_id
    JOIN objects p ON p.id = t.assignee_person_id
    WHERE t.workspace_id = workspace_id AND t.object_id = ANY (scope)
      AND o.deleted_at IS NULL AND p.deleted_at IS NULL
  ) listed;

  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(listed.item ORDER BY listed.place) FILTER (WHERE listed.place <= 100), '[]'::jsonb),
    'total', count(*)
  ) INTO label_names
  FROM (
    SELECT jsonb_build_object(
      'name', n.name,
      'existing', EXISTS (SELECT 1 FROM labels b WHERE b.workspace_id = target_workspace_id AND lower(b.name) = lower(n.name))
    ) AS item, row_number() OVER (ORDER BY lower(n.name), n.name) AS place
    FROM (SELECT DISTINCT l.name FROM task_labels tl JOIN labels l ON l.id = tl.label_id
          WHERE tl.workspace_id = workspace_id AND tl.task_id = ANY (scope)) n
  ) listed;

  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(listed.item ORDER BY listed.place) FILTER (WHERE listed.place <= 100), '[]'::jsonb),
    'total', count(*)
  ) INTO people
  FROM (
    SELECT jsonb_build_object('id', o.id::text, 'displayName', o.display_name) AS item,
           row_number() OVER (ORDER BY o.display_name, o.id) AS place
    FROM objects o
    WHERE o.workspace_id = workspace_id AND o.permission_scope_id = object_id AND o.id <> object_id
      AND o.object_type = 'person' AND o.deleted_at IS NULL
  ) listed;

  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(listed.item ORDER BY listed.place) FILTER (WHERE listed.place <= 100), '[]'::jsonb),
    'total', count(*)
  ) INTO keeping
  FROM (
    SELECT jsonb_build_object('userId', u.id::text, 'displayName', u.display_name, 'role', k.role) AS item,
           row_number() OVER (ORDER BY u.display_name, u.id) AS place
    FROM (SELECT g.principal_id, (array_agg(g.role ORDER BY chronelle_role_rank(g.role) DESC))[1] AS role
          FROM chronelle_object_move_grants(workspace_id, target_workspace_id, scope) g
          WHERE g.resource_id = object_id AND NOT g.covered
          GROUP BY g.principal_id) k
    JOIN users u ON u.id = k.principal_id
  ) listed;

  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(listed.item ORDER BY listed.place) FILTER (WHERE listed.place <= 100), '[]'::jsonb),
    'total', count(*)
  ) INTO covered
  FROM (
    SELECT jsonb_build_object('userId', u.id::text, 'displayName', u.display_name, 'role', c.role,
                              'memberRole', c.member_role) AS item,
           row_number() OVER (ORDER BY u.display_name, u.id) AS place
    FROM (SELECT g.principal_id, (array_agg(g.role ORDER BY chronelle_role_rank(g.role) DESC))[1] AS role,
                 max(g.member_role) AS member_role
          FROM chronelle_object_move_grants(workspace_id, target_workspace_id, scope) g
          WHERE g.covered
          GROUP BY g.principal_id) c
    JOIN users u ON u.id = c.principal_id
  ) listed;

  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(listed.item ORDER BY listed.place) FILTER (WHERE listed.place <= 100), '[]'::jsonb),
    'total', count(*)
  ) INTO losing
  FROM (
    SELECT jsonb_build_object('userId', u.id::text, 'displayName', u.display_name) AS item,
           row_number() OVER (ORDER BY u.display_name, u.id) AS place
    FROM workspace_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.workspace_id = workspace_id
      AND NOT EXISTS (SELECT 1 FROM workspace_members d
                      WHERE d.workspace_id = target_workspace_id AND d.user_id = m.user_id)
      AND NOT EXISTS (SELECT 1 FROM resource_grants g
                      WHERE g.workspace_id = workspace_id AND g.resource_id = object_id AND g.principal_id = m.user_id
                        AND (g.expires_at IS NULL OR g.expires_at > now()))
  ) listed;

  SELECT jsonb_build_object(
    'owner', count(*) FILTER (WHERE m.role = 'owner'),
    'editor', count(*) FILTER (WHERE m.role = 'editor'),
    'viewer', count(*) FILTER (WHERE m.role = 'viewer')
  ) INTO members
  FROM workspace_members m WHERE m.workspace_id = target_workspace_id;

  -- A share waiting on an invitation is granted when accepted only if its
  -- sharer can still share the record; after the move that takes Owner in
  -- the target space or an Owner share of the record or the Event.
  SELECT count(*) INTO lapsing FROM pending_shares p
  WHERE p.workspace_id = workspace_id AND p.resource_id = ANY (scope) AND p.status = 'pending'
    AND NOT EXISTS (SELECT 1 FROM workspace_members m
                    WHERE m.workspace_id = target_workspace_id AND m.user_id = p.granted_by AND m.role = 'owner')
    AND NOT EXISTS (SELECT 1 FROM resource_grants g
                    WHERE g.workspace_id = workspace_id AND g.principal_id = p.granted_by
                      AND g.role = 'owner' AND g.scope = 'all' AND g.resource_id IN (p.resource_id, object_id)
                      AND (g.expires_at IS NULL OR g.expires_at > now()));

  RETURN jsonb_build_object(
    'eventId', object_id::text,
    'from', chronelle_workspace_json(source, user_id),
    'to', chronelle_workspace_json(target, user_id),
    'moves', moves,
    'droppedLinks', dropped,
    'unassignedTasks', unassigned,
    'labels', label_names,
    'peopleKept', people,
    'clearedLinks', crossing - (dropped ->> 'total')::integer + assigned - (unassigned ->> 'total')::integer,
    'access', jsonb_build_object(
      'targetMembers', members,
      'keepingShares', keeping,
      'droppedGrants', covered,
      'losingAccess', losing,
      'lapsingShares', lapsing
    ),
    'expectedDroppedLinks', (dropped ->> 'total')::integer + (unassigned ->> 'total')::integer
  );
END
$$;

-- The spaces the caller is a member of, as the move's chooser lists them:
-- the caller's own Personal space first, then by name. A space is allowed
-- when it is not the Event's and the caller can add records there.
CREATE FUNCTION chronelle_object_move_targets(workspace_id uuid, user_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  items jsonb;
BEGIN
  PERFORM chronelle_object_move_source_check(workspace_id, user_id, object_id);
  SELECT COALESCE(jsonb_agg(listed.item ORDER BY listed.own DESC, listed.name, listed.id), '[]'::jsonb) INTO items
  FROM (
    SELECT jsonb_build_object(
      'workspace', chronelle_workspace_json(w, user_id),
      'memberCount', (SELECT count(*) FROM workspace_members c WHERE c.workspace_id = w.id),
      'current', w.id = workspace_id,
      'allowed', w.id <> workspace_id AND m.role IN ('owner', 'editor')
    ) AS item, w.personal_owner_id IS NOT DISTINCT FROM user_id AS own, w.display_name AS name, w.id
    FROM workspace_members m
    JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.user_id = user_id
  ) listed;
  RETURN jsonb_build_object('items', items);
END
$$;

-- The move's preview, after the checks the move makes.
CREATE FUNCTION chronelle_object_move_preview(workspace_id uuid, user_id uuid, object_id uuid, target_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
BEGIN
  PERFORM chronelle_object_move_source_check(workspace_id, user_id, object_id);
  PERFORM chronelle_object_move_target_check(workspace_id, user_id, target_workspace_id);
  RETURN chronelle_object_move_plan(workspace_id, user_id, object_id, target_workspace_id);
END
$$;

-- A version step of a record the move changes, with its audit event and
-- revision in the record's space.
CREATE FUNCTION chronelle_object_move_revise(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_id uuid,
  action text,
  mutation_kind text,
  metadata jsonb,
  written_at timestamptz
)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  saved objects%ROWTYPE;
  audit_id uuid := chronelle_uuidv7();
BEGIN
  SELECT o.* INTO saved FROM objects o WHERE o.workspace_id = workspace_id AND o.id = object_id;
  IF NOT EXISTS (
    SELECT 1 FROM object_revisions r
    WHERE r.object_id = object_id AND r.object_version = saved.version - 1
  ) THEN
    RAISE EXCEPTION 'Object revision baseline is missing; run db:baseline-revisions before serving writes.'
      USING ERRCODE = 'PT500';
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
  VALUES (audit_id, workspace_id, 'user', user_id, action, object_id, request_id,
          metadata || jsonb_build_object('version', saved.version), written_at);
  INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
  VALUES (chronelle_uuidv7(), workspace_id, object_id, saved.version, mutation_kind, NULL,
          'user', user_id, request_id, audit_id, 1, chronelle_object_snapshot(workspace_id, object_id), written_at);
END
$$;

-- Moves the Event and its scope from the caller's space to the target.
-- The two spaces' rows are locked in id order, as protected mutations in
-- each lock theirs; then the Event's row, the scope's rows in id order,
-- their tasks, and the relations touching them. The move is refused when
-- the links it would drop with a warning are not the number the caller
-- reviewed, or when a concurrent write conflicts. A repeat of a move with
-- the same command id returns the recorded result.
CREATE FUNCTION chronelle_object_move(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_id uuid,
  target_workspace_id uuid,
  expected_dropped_links integer,
  moved_at timestamptz,
  command_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  recorded audit_events%ROWTYPE;
  scope uuid[];
  plan jsonb;
  card objects%ROWTYPE;
  relation object_relations%ROWTYPE;
  dropped uuid[] := '{}';
  pruned uuid[];
  stack command_stacks%ROWTYPE;
  undo_ids uuid[];
  redo_ids uuid[];
  retained_versions jsonb;
  rewritten uuid[];
  moved_count integer;
  label record;
  mapped uuid;
  label_map jsonb := '{}'::jsonb;
  joined integer := 0;
  created integer := 0;
  task_id uuid;
  previous_version integer;
  covered_grant record;
  covered_ids uuid[] := '{}';
  source_name text;
  target_name text;
  summary jsonb;
  written_at timestamptz := now();
BEGIN
  -- A target that does not exist has no row to lock.
  IF NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.id = target_workspace_id) THEN
    RAISE EXCEPTION 'The workspace is unavailable.' USING ERRCODE = 'PT404';
  END IF;
  PERFORM 1 FROM workspaces w WHERE w.id = least(workspace_id, target_workspace_id) FOR NO KEY UPDATE;
  PERFORM 1 FROM workspaces w WHERE w.id = greatest(workspace_id, target_workspace_id) FOR NO KEY UPDATE;

  IF command_id IS NOT NULL THEN
    SELECT a.* INTO recorded FROM audit_events a
    WHERE a.resource_id = object_id AND a.action = 'object.moved' AND a.actor_id = user_id
      AND a.metadata ->> 'direction' = 'in' AND a.metadata ->> 'commandId' = command_id::text
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT 1;
    IF FOUND THEN
      IF recorded.workspace_id <> target_workspace_id THEN
        RAISE EXCEPTION 'The command ID was already used with different input.' USING ERRCODE = 'PT409';
      END IF;
      IF NOT chronelle_can_view(target_workspace_id, user_id, object_id) THEN
        RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
      END IF;
      RETURN jsonb_build_object('event', chronelle_object_rows(target_workspace_id, object_id),
                                'move', recorded.metadata - 'direction');
    END IF;
  END IF;

  PERFORM 1 FROM objects o WHERE o.workspace_id = workspace_id AND o.id = object_id FOR UPDATE;
  PERFORM chronelle_object_move_source_check(workspace_id, user_id, object_id);
  PERFORM chronelle_object_move_target_check(workspace_id, user_id, target_workspace_id);

  BEGIN
    PERFORM 1 FROM objects o
    WHERE o.workspace_id = workspace_id AND (o.id = object_id OR o.permission_scope_id = object_id)
    ORDER BY o.id FOR UPDATE;
    scope := chronelle_object_move_scope(workspace_id, object_id);
    PERFORM 1 FROM tasks t WHERE t.object_id = ANY (scope) ORDER BY t.object_id FOR UPDATE;
    PERFORM 1 FROM object_relations r
    WHERE r.workspace_id = workspace_id
      AND (r.source_object_id = ANY (scope) OR r.target_object_id = ANY (scope))
    ORDER BY r.id FOR UPDATE;

    IF EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.workspace_id = workspace_id AND t.parent_task_id IS NOT NULL
        AND (t.object_id = ANY (scope)) <> (t.parent_task_id = ANY (scope))
    ) THEN
      RAISE EXCEPTION 'A subtask and its task are in different scopes.' USING ERRCODE = 'PT500';
    END IF;

    plan := chronelle_object_move_plan(workspace_id, user_id, object_id, target_workspace_id);
    IF (plan ->> 'expectedDroppedLinks')::integer <> expected_dropped_links THEN
      RAISE EXCEPTION 'The move changed since it was previewed.' USING ERRCODE = 'PT409';
    END IF;

    -- People cards scoped to the Event stay and become their own scope.
    FOR card IN
      SELECT o.* FROM objects o
      WHERE o.workspace_id = workspace_id AND o.permission_scope_id = object_id AND o.id <> object_id
        AND o.object_type = 'person'
      ORDER BY o.id
    LOOP
      UPDATE objects o SET permission_scope_id = card.id, version = o.version + 1, updated_at = moved_at
      WHERE o.workspace_id = workspace_id AND o.id = card.id;
      PERFORM chronelle_object_move_revise(
        workspace_id, user_id, request_id, card.id, 'object.permission_scope_updated', 'permission_scope_updated',
        jsonb_build_object('cause', 'object.moved', 'permissionScopeId', card.id::text,
                           'previousPermissionScopeId', object_id::text, 'previousVersion', card.version),
        written_at);
    END LOOP;

    -- Relations that cross the scope, live or removed, are dropped.
    FOR relation IN
      SELECT r.* FROM object_relations r
      WHERE r.workspace_id = workspace_id
        AND (r.source_object_id = ANY (scope)) <> (r.target_object_id = ANY (scope))
      ORDER BY r.id
    LOOP
      INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
      VALUES (chronelle_uuidv7(), workspace_id, 'user', user_id, 'relation.dropped', relation.source_object_id, request_id,
              jsonb_build_object('cause', 'object.moved', 'relationId', relation.id::text,
                                 'relationType', relation.relation_type,
                                 'targetObjectId', relation.target_object_id::text, 'version', relation.version,
                                 'removed', relation.deleted_at IS NOT NULL,
                                 'toWorkspaceId', target_workspace_id::text),
              written_at);
      dropped := dropped || relation.id;
    END LOOP;
    PERFORM set_config('chronelle.relation_drop', 'move', true);
    DELETE FROM object_relations r WHERE r.id = ANY (dropped);
    PERFORM set_config('chronelle.relation_drop', '', true);

    -- Undo and redo entries that changed a carried record leave the old
    -- space's stacks; their history stays.
    pruned := ARRAY(
      SELECT DISTINCT c.command_id FROM command_changes c
      WHERE c.workspace_id = workspace_id AND c.object_id = ANY (scope)
    );
    FOR stack IN
      SELECT s.* FROM command_stacks s
      WHERE s.workspace_id = workspace_id AND (s.undo_ids && pruned OR s.redo_ids && pruned)
      ORDER BY s.user_id
      FOR UPDATE
    LOOP
      undo_ids := ARRAY(SELECT e.id FROM unnest(stack.undo_ids) WITH ORDINALITY AS e(id, place)
                        WHERE e.id <> ALL (pruned) ORDER BY e.place);
      redo_ids := ARRAY(SELECT e.id FROM unnest(stack.redo_ids) WITH ORDINALITY AS e(id, place)
                        WHERE e.id <> ALL (pruned) ORDER BY e.place);
      SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb) INTO retained_versions
      FROM jsonb_each(stack.expected_versions) e
      WHERE EXISTS (
        SELECT 1 FROM command_changes c
        WHERE c.workspace_id = workspace_id AND c.user_id = stack.user_id
          AND c.command_id = ANY (undo_ids || redo_ids) AND c.object_id = e.key::uuid
      );
      UPDATE command_stacks s
      SET version = s.version + 1, undo_ids = undo_ids, redo_ids = redo_ids, expected_versions = retained_versions
      WHERE s.workspace_id = workspace_id AND s.user_id = stack.user_id;
    END LOOP;

    rewritten := ARRAY(
      SELECT t.object_id FROM tasks t
      WHERE t.workspace_id = workspace_id AND t.object_id = ANY (scope)
        AND (t.assignee_person_id IS NOT NULL
             OR EXISTS (SELECT 1 FROM task_labels tl WHERE tl.task_id = t.object_id))
      ORDER BY t.object_id
    );

    UPDATE objects o SET workspace_id = target_workspace_id
    WHERE o.workspace_id = workspace_id AND o.id = ANY (scope);
    GET DIAGNOSTICS moved_count = ROW_COUNT;
    IF moved_count <> cardinality(scope) THEN
      RAISE EXCEPTION 'The move changed since it was previewed.' USING ERRCODE = 'PT409';
    END IF;

    -- A task's labels join the target's labels of the same name.
    FOR label IN
      SELECT l.id, l.name FROM labels l
      WHERE l.id IN (SELECT tl.label_id FROM task_labels tl
                     WHERE tl.workspace_id = workspace_id AND tl.task_id = ANY (scope))
      ORDER BY lower(l.name), l.id
    LOOP
      SELECT b.id INTO mapped FROM labels b
      WHERE b.workspace_id = target_workspace_id AND lower(b.name) = lower(label.name);
      IF FOUND THEN
        joined := joined + 1;
      ELSE
        INSERT INTO labels (id, workspace_id, name, created_by)
        VALUES (chronelle_uuidv7(), target_workspace_id, label.name, user_id)
        ON CONFLICT DO NOTHING
        RETURNING id INTO mapped;
        IF FOUND THEN
          created := created + 1;
        ELSE
          SELECT b.id INTO mapped FROM labels b
          WHERE b.workspace_id = target_workspace_id AND lower(b.name) = lower(label.name);
          joined := joined + 1;
        END IF;
      END IF;
      label_map := label_map || jsonb_build_object(label.id::text, mapped::text);
    END LOOP;
    UPDATE task_labels tl
    SET workspace_id = target_workspace_id, label_id = (label_map ->> tl.label_id::text)::uuid
    WHERE tl.workspace_id = workspace_id AND tl.task_id = ANY (scope);

    UPDATE tasks t SET assignee_person_id = NULL
    WHERE t.workspace_id = target_workspace_id AND t.object_id = ANY (scope) AND t.assignee_person_id IS NOT NULL;
    FOREACH task_id IN ARRAY rewritten LOOP
      UPDATE objects o SET version = o.version + 1, updated_at = moved_at
      WHERE o.workspace_id = target_workspace_id AND o.id = task_id
      RETURNING o.version - 1 INTO previous_version;
      PERFORM chronelle_object_move_revise(
        target_workspace_id, user_id, request_id, task_id, 'task.updated', 'updated',
        jsonb_build_object('cause', 'object.moved', 'previousVersion', previous_version),
        written_at);
    END LOOP;

    -- A waiting share no longer names a People card of the old space.
    UPDATE pending_shares p SET person_id = NULL
    WHERE p.workspace_id = target_workspace_id AND p.resource_id = ANY (scope) AND p.person_id IS NOT NULL;

    -- A share the grantee's membership of the target covers is revoked.
    FOR covered_grant IN
      SELECT g.grant_id, g.resource_id, g.principal_id, g.role, g.member_role
      FROM chronelle_object_move_grants(target_workspace_id, target_workspace_id, scope) g
      WHERE g.covered
      ORDER BY g.grant_id
    LOOP
      INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
      VALUES (chronelle_uuidv7(), target_workspace_id, 'user', user_id, 'resource.share_revoked',
              covered_grant.resource_id, request_id,
              jsonb_build_object('grantId', covered_grant.grant_id::text,
                                 'principalId', covered_grant.principal_id::text, 'role', covered_grant.role,
                                 'memberRole', covered_grant.member_role, 'reason', 'covered_by_membership'),
              written_at);
      covered_ids := covered_ids || covered_grant.grant_id;
    END LOOP;
    DELETE FROM resource_grants g WHERE g.id = ANY (covered_ids);
  EXCEPTION
    WHEN foreign_key_violation OR deadlock_detected THEN
      RAISE EXCEPTION 'The move changed since it was previewed.' USING ERRCODE = 'PT409';
  END;

  SELECT w.display_name INTO source_name FROM workspaces w WHERE w.id = workspace_id;
  SELECT w.display_name INTO target_name FROM workspaces w WHERE w.id = target_workspace_id;
  summary := jsonb_build_object(
    'commandId', command_id::text,
    'from', jsonb_build_object('id', workspace_id::text, 'displayName', source_name),
    'to', jsonb_build_object('id', target_workspace_id::text, 'displayName', target_name),
    'moves', plan -> 'moves',
    'droppedLinks', (plan -> 'droppedLinks' ->> 'total')::integer,
    'unassignedTasks', (plan -> 'unassignedTasks' ->> 'total')::integer,
    'clearedLinks', (plan ->> 'clearedLinks')::integer,
    'labelsJoined', joined,
    'labelsCreated', created,
    'grantsDropped', cardinality(covered_ids),
    'peopleKept', (plan -> 'peopleKept' ->> 'total')::integer,
    'movedAt', chronelle_iso(moved_at)
  );
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
  VALUES (chronelle_uuidv7(), workspace_id, 'user', user_id, 'object.moved', object_id, request_id,
          summary || jsonb_build_object('direction', 'out'), written_at),
         (chronelle_uuidv7(), target_workspace_id, 'user', user_id, 'object.moved', object_id, request_id,
          summary || jsonb_build_object('direction', 'in'), written_at);
  RETURN jsonb_build_object('event', chronelle_object_rows(target_workspace_id, object_id), 'move', summary);
END
$$;

REVOKE ALL ON FUNCTION chronelle_guard_relation_drop() FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_object_move_scope(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_object_move_grants(uuid, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_object_move_source_check(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_object_move_target_check(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_object_move_plan(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_object_move_targets(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_object_move_preview(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_object_move_revise(uuid, uuid, uuid, uuid, text, text, jsonb, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_object_move(uuid, uuid, uuid, uuid, uuid, integer, timestamptz, uuid) FROM PUBLIC;

DO $$
DECLARE
  signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'chronelle_object_move_scope(uuid, uuid)',
    'chronelle_object_move_grants(uuid, uuid, uuid[])',
    'chronelle_object_move_source_check(uuid, uuid, uuid)',
    'chronelle_object_move_target_check(uuid, uuid, uuid)',
    'chronelle_object_move_plan(uuid, uuid, uuid, uuid)',
    'chronelle_object_move_targets(uuid, uuid, uuid)',
    'chronelle_object_move_preview(uuid, uuid, uuid, uuid)',
    'chronelle_object_move_revise(uuid, uuid, uuid, uuid, text, text, jsonb, timestamptz)',
    'chronelle_object_move(uuid, uuid, uuid, uuid, uuid, integer, timestamptz, uuid)'
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
