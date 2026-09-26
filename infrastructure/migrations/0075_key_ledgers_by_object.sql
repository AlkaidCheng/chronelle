-- History stays in the workspace where it was written. Audit events,
-- revisions, command changes, Event page revisions, and context and create
-- command records keep their workspace_id, a fact about where a change
-- happened, and name their object by id alone, so an object that changes
-- workspace keeps its history and no ledger row is updated. A revision is
-- unique per object and version, and a layout revision per Event and
-- version, wherever it was written. Nothing moves a record yet.
--
-- The unique indexes are built before any exclusive lock is taken, so reads
-- continue while they build. The keys are added NOT VALID, which checks new
-- rows only; the next migration validates the existing ones without
-- blocking writes. Dropping a foreign key locks both tables exclusively, so
-- a busy lock fails fast.
SET LOCAL lock_timeout = '5s';

CREATE UNIQUE INDEX object_revisions_object_version_unique
  ON object_revisions (object_id, object_version);
CREATE UNIQUE INDEX event_page_revisions_event_version_unique
  ON event_page_revisions (event_id, version);
-- Serves the RESTRICT check of audit_events_resource_fk.
CREATE INDEX audit_events_resource_idx
  ON audit_events (resource_id, created_at DESC) WHERE resource_id IS NOT NULL;

ALTER TABLE object_revisions
  ADD CONSTRAINT object_revisions_object_version_unique
    UNIQUE USING INDEX object_revisions_object_version_unique;
ALTER TABLE event_page_revisions
  ADD CONSTRAINT event_page_revisions_event_version_unique
    UNIQUE USING INDEX event_page_revisions_event_version_unique;

ALTER TABLE audit_events
  DROP CONSTRAINT audit_events_resource_workspace_fk,
  ADD CONSTRAINT audit_events_resource_fk
    FOREIGN KEY (resource_id) REFERENCES objects(id)
    ON DELETE RESTRICT NOT VALID;

ALTER TABLE object_revisions
  DROP CONSTRAINT object_revisions_object_workspace_fk,
  ADD CONSTRAINT object_revisions_object_fk
    FOREIGN KEY (object_id) REFERENCES objects(id)
    ON DELETE RESTRICT NOT VALID;

ALTER TABLE command_changes
  DROP CONSTRAINT command_changes_workspace_id_object_id_before_version_fkey,
  DROP CONSTRAINT command_changes_workspace_id_object_id_after_version_fkey,
  ADD CONSTRAINT command_changes_before_revision_fk
    FOREIGN KEY (object_id, before_version)
    REFERENCES object_revisions(object_id, object_version)
    ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT command_changes_after_revision_fk
    FOREIGN KEY (object_id, after_version)
    REFERENCES object_revisions(object_id, object_version)
    ON DELETE RESTRICT NOT VALID;

ALTER TABLE event_context_commands
  DROP CONSTRAINT event_context_commands_workspace_id_context_object_id_fkey,
  DROP CONSTRAINT event_context_commands_workspace_id_object_id_fkey,
  ADD CONSTRAINT event_context_commands_context_object_fk
    FOREIGN KEY (context_object_id) REFERENCES objects(id)
    ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT event_context_commands_object_fk
    FOREIGN KEY (object_id) REFERENCES objects(id)
    ON DELETE RESTRICT NOT VALID;

ALTER TABLE object_create_commands
  DROP CONSTRAINT object_create_commands_workspace_id_object_id_fkey,
  ADD CONSTRAINT object_create_commands_object_fk
    FOREIGN KEY (object_id) REFERENCES objects(id)
    ON DELETE RESTRICT NOT VALID;

-- A layout revision already names its Event by id through
-- event_page_revisions_event_id_fkey.
ALTER TABLE event_page_revisions
  DROP CONSTRAINT event_page_revisions_workspace_id_event_id_fkey;

-- With command changes keyed by object and version, nothing references the
-- workspace-keyed revision key.
ALTER TABLE object_revisions DROP CONSTRAINT object_revisions_version_unique;
DROP INDEX audit_events_resource_created_idx;

-- The functions below are the latest definitions from the migration named
-- above each, redefined in place with one change: an object's revisions
-- and layout revisions are read by its id, not by the caller's workspace.
-- The object's own authorization has already passed where they are read.
-- Reads keyed by a command stay in the command's workspace.

-- From 0007: a restored revision's source is an earlier revision of the
-- same object, wherever it was written. A new revision is written in its
-- object's workspace, with an audit event there.
CREATE OR REPLACE FUNCTION chronelle_validate_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM audit_events a JOIN objects o
      ON o.workspace_id = a.workspace_id AND o.id = a.resource_id
    WHERE a.id = NEW.audit_event_id AND a.workspace_id = NEW.workspace_id
      AND a.resource_id = NEW.object_id AND a.request_id = NEW.request_id
      AND a.actor_type = NEW.actor_type AND a.actor_id IS NOT DISTINCT FROM NEW.actor_id
      AND o.version = NEW.object_version AND o.object_type = NEW.snapshot->>'objectType'
      AND a.action = CASE NEW.mutation_kind
        WHEN 'baseline' THEN 'object.baselined'
        WHEN 'permission_scope_updated' THEN 'object.permission_scope_updated'
        ELSE o.object_type || '.' || NEW.mutation_kind END
      AND (NEW.mutation_kind <> 'restored' OR a.metadata->>'sourceRevisionId' = NEW.source_revision_id::text)
  ) THEN
    RAISE EXCEPTION 'revision must match its canonical version and audit event' USING ERRCODE = '23514';
  END IF;
  IF NEW.mutation_kind = 'restored' AND NOT EXISTS (
    SELECT 1 FROM object_revisions source
    WHERE source.id = NEW.source_revision_id
      AND source.object_id = NEW.object_id
      AND source.object_version < NEW.object_version
      AND source.snapshot_schema_version = NEW.snapshot_schema_version
  ) THEN
    RAISE EXCEPTION 'restoration source must be an earlier revision of the same object' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- From 0016: the created resource's first revision.
CREATE OR REPLACE FUNCTION chronelle_event_context_create(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  event_id uuid,
  command_id uuid,
  request_hash text,
  resource jsonb,
  relation_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  context_event objects%ROWTYPE;
  existing event_context_commands%ROWTYPE;
  object_type text := resource ->> 'objectType';
  created jsonb;
  child_id uuid;
  relation jsonb;
  snapshot jsonb;
BEGIN
  IF NOT chronelle_can_edit(workspace_id, user_id, event_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT * INTO context_event FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = event_id AND o.object_type = 'event' AND o.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF context_event.permission_scope_id <> context_event.id THEN
    RAISE EXCEPTION 'The context must be a self-scoped Event.' USING ERRCODE = 'PT422';
  END IF;

  SELECT * INTO existing FROM event_context_commands c
  WHERE c.workspace_id = workspace_id AND c.user_id = user_id AND c.command_id = command_id;
  IF FOUND THEN
    IF existing.request_hash <> request_hash THEN
      RAISE EXCEPTION 'The command ID was already used with different input.' USING ERRCODE = 'PT409';
    END IF;
    IF NOT chronelle_can_view(workspace_id, user_id, existing.object_id) THEN
      RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
    END IF;
    SELECT r.snapshot INTO snapshot FROM object_revisions r
    WHERE r.object_id = existing.object_id
      AND r.object_version = 1 AND r.snapshot_schema_version = 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The command result revision is unavailable.' USING ERRCODE = 'PT500';
    END IF;
    RETURN jsonb_build_object('resource', snapshot, 'relationId', existing.relation_id::text);
  END IF;

  created := chronelle_object_create(workspace_id, user_id, request_id, object_type,
    (resource - 'objectType') || jsonb_build_object('permissionScopeId', event_id::text));
  child_id := (created -> 'object' ->> 'id')::uuid;
  relation := chronelle_relation_create(workspace_id, user_id, request_id, event_id, 'includes', child_id,
    COALESCE(relation_metadata, '{}'::jsonb));
  INSERT INTO event_context_commands (workspace_id, user_id, command_id, request_id, request_hash,
                                      context_object_id, object_id, relation_id)
  VALUES (workspace_id, user_id, command_id, request_id, request_hash, event_id, child_id, (relation ->> 'id')::uuid);
  SELECT r.snapshot INTO snapshot FROM object_revisions r
  WHERE r.object_id = child_id AND r.object_version = 1;
  RETURN jsonb_build_object('resource', snapshot, 'relationId', relation ->> 'id');
END
$$;

-- From 0020: the revision of the version being replaced.
CREATE OR REPLACE FUNCTION chronelle_object_scope_update(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_id uuid,
  expected_version integer,
  permission_scope_id uuid,
  updated_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  current_object objects%ROWTYPE;
  scope objects%ROWTYPE;
  saved objects%ROWTYPE;
  audit_id uuid := chronelle_uuidv7();
  written_at timestamptz := now();
BEGIN
  IF NOT chronelle_can_share(workspace_id, user_id, object_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT * INTO current_object FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = object_id
  FOR UPDATE;
  IF current_object.version <> expected_version THEN
    RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
  END IF;
  IF current_object.permission_scope_id = permission_scope_id THEN
    RAISE EXCEPTION 'permissionScopeId must change the current permission scope.' USING ERRCODE = 'PT422';
  END IF;
  IF permission_scope_id <> object_id THEN
    IF NOT chronelle_can_share(workspace_id, user_id, permission_scope_id) THEN
      RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
    END IF;
    SELECT * INTO scope FROM objects o
    WHERE o.workspace_id = workspace_id AND o.id = permission_scope_id;
    IF scope.object_type <> 'event' OR scope.permission_scope_id <> scope.id THEN
      RAISE EXCEPTION 'permissionScopeId must reference a self-scoped Event.' USING ERRCODE = 'PT422';
    END IF;
  END IF;

  UPDATE objects o
  SET permission_scope_id = permission_scope_id, updated_at = updated_at, version = o.version + 1
  WHERE o.workspace_id = workspace_id AND o.id = object_id AND o.version = expected_version AND o.deleted_at IS NULL
  RETURNING * INTO saved;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM object_revisions r
    WHERE r.object_id = object_id AND r.object_version = expected_version
  ) THEN
    RAISE EXCEPTION 'Object revision baseline is missing; run db:baseline-revisions before serving writes.'
      USING ERRCODE = 'PT500';
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
  VALUES (audit_id, workspace_id, 'user', user_id, 'object.permission_scope_updated', object_id, request_id,
          jsonb_build_object('permissionScopeId', permission_scope_id::text,
                             'previousPermissionScopeId', current_object.permission_scope_id::text,
                             'previousVersion', expected_version, 'version', saved.version), written_at);
  INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
  VALUES (chronelle_uuidv7(), workspace_id, object_id, saved.version, 'permission_scope_updated', NULL,
          'user', user_id, request_id, audit_id, 1, chronelle_object_snapshot(workspace_id, object_id), written_at);
  RETURN chronelle_object_rows(workspace_id, object_id);
END
$$;

-- From 0022: the Event's current layout version and the restored one.
CREATE OR REPLACE FUNCTION chronelle_event_layout_write(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  event_id uuid,
  expected_version integer,
  pages jsonb,
  restored_from_version integer
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  current_version integer;
  next_version integer;
  layout jsonb := pages;
  audit_id uuid := chronelle_uuidv7();
  written_at timestamptz := now();
BEGIN
  IF NOT chronelle_can_edit(workspace_id, user_id, event_id) OR EXISTS (
    SELECT 1 FROM objects o WHERE o.workspace_id = workspace_id AND o.id = event_id AND o.deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  PERFORM 1 FROM objects o WHERE o.workspace_id = workspace_id AND o.id = event_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM events e WHERE e.workspace_id = workspace_id AND e.object_id = event_id) THEN
    RAISE EXCEPTION 'Page layouts belong to Events.' USING ERRCODE = 'PT422';
  END IF;
  SELECT COALESCE(max(r.version), 0) INTO current_version FROM event_page_revisions r
  WHERE r.event_id = event_id;
  IF current_version <> expected_version THEN
    RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
  END IF;
  IF restored_from_version IS NOT NULL THEN
    IF restored_from_version > 0 THEN
      SELECT r.pages INTO layout FROM event_page_revisions r
      WHERE r.event_id = event_id AND r.version = restored_from_version;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
      END IF;
    ELSE
      layout := '[]'::jsonb;
    END IF;
  END IF;
  next_version := current_version + 1;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
  VALUES (audit_id, workspace_id, 'user', user_id,
          CASE WHEN restored_from_version IS NULL THEN 'event.layout_updated' ELSE 'event.layout_restored' END,
          event_id, request_id,
          jsonb_build_object('previousVersion', current_version, 'version', next_version)
            || CASE WHEN restored_from_version IS NULL THEN '{}'::jsonb
                    ELSE jsonb_build_object('restoredFromVersion', restored_from_version) END,
          written_at);
  INSERT INTO event_page_revisions (workspace_id, event_id, version, pages, audit_event_id, created_at)
  VALUES (workspace_id, event_id, next_version, layout, audit_id, written_at);
  RETURN jsonb_build_object('eventId', event_id::text, 'version', next_version, 'pages', layout,
                            'updatedAt', chronelle_iso(written_at));
END
$$;

-- From 0023: the revision a change restores on undo or redo.
CREATE OR REPLACE FUNCTION chronelle_command_transition(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  operation_id uuid,
  command_id uuid,
  expected_stack_version integer,
  direction text,
  request_hash text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  receipt jsonb := chronelle_command_replay(workspace_id, user_id, operation_id, request_hash);
  stack command_stacks%ROWTYPE;
  source uuid[];
  change command_changes%ROWTYPE;
  current_object objects%ROWTYPE;
  revision object_revisions%ROWTYPE;
  changes jsonb[] := '{}';
  edit jsonb;
  versions jsonb := '[]'::jsonb;
  command jsonb := jsonb_build_object('id', command_id::text, 'operationId', operation_id::text, 'direction', direction);
BEGIN
  IF direction NOT IN ('undo', 'redo') THEN
    RAISE EXCEPTION 'direction must be undo or redo.' USING ERRCODE = 'PT422';
  END IF;
  IF receipt IS NOT NULL THEN
    RETURN receipt;
  END IF;
  stack := chronelle_command_stack(workspace_id, user_id);
  source := CASE direction WHEN 'undo' THEN stack.undo_ids ELSE stack.redo_ids END;
  IF stack.version <> expected_stack_version OR source[cardinality(source)] IS DISTINCT FROM command_id THEN
    RAISE EXCEPTION 'The command history changed. Refresh before trying again.' USING ERRCODE = 'PT409';
  END IF;

  FOR change IN
    SELECT * FROM command_changes c
    WHERE c.workspace_id = workspace_id AND c.user_id = user_id AND c.command_id = command_id
    ORDER BY c.object_id
  LOOP
    current_object := chronelle_command_target(workspace_id, user_id, change.object_id);
    IF current_object.version IS DISTINCT FROM (stack.expected_versions ->> change.object_id::text)::integer THEN
      RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
    END IF;
    SELECT * INTO revision FROM object_revisions r
    WHERE r.object_id = change.object_id
      AND r.object_version = CASE direction WHEN 'undo' THEN change.before_version ELSE change.after_version END;
    IF NOT FOUND OR revision.snapshot_schema_version <> 1 THEN
      RAISE EXCEPTION 'Unsupported command revision.' USING ERRCODE = 'PT500';
    END IF;
    IF revision.snapshot ->> 'deletedAt' IS NOT NULL THEN
      RAISE EXCEPTION 'Command content must reference a live revision.' USING ERRCODE = 'PT500';
    END IF;
    changes := changes || jsonb_build_object(
      'objectType', current_object.object_type, 'objectId', change.object_id::text,
      'expectedVersion', current_object.version,
      'content', chronelle_command_content(current_object.object_type, revision.snapshot));
  END LOOP;
  IF cardinality(changes) = 0 THEN
    RAISE EXCEPTION 'The command history changed. Refresh before trying again.' USING ERRCODE = 'PT409';
  END IF;

  FOREACH edit IN ARRAY changes LOOP
    PERFORM chronelle_object_update(workspace_id, user_id, request_id, edit ->> 'objectType',
                                    (edit ->> 'objectId')::uuid, (edit ->> 'expectedVersion')::integer,
                                    edit -> 'content', command);
    versions := versions || jsonb_build_object('id', edit -> 'objectId', 'version', (edit ->> 'expectedVersion')::integer + 1);
    stack.expected_versions := stack.expected_versions
      || jsonb_build_object(edit ->> 'objectId', (edit ->> 'expectedVersion')::integer + 1);
  END LOOP;
  IF direction = 'undo' THEN
    stack.undo_ids := stack.undo_ids[1:cardinality(stack.undo_ids) - 1];
    stack.redo_ids := stack.redo_ids || command_id;
  ELSE
    stack.redo_ids := stack.redo_ids[1:cardinality(stack.redo_ids) - 1];
    stack.undo_ids := stack.undo_ids || command_id;
  END IF;
  RETURN chronelle_command_record(request_id, request_hash, stack, jsonb_build_object(
    'operationId', operation_id::text, 'commandId', command_id::text, 'direction', direction,
    'stackVersion', stack.version + 1, 'objects', versions));
END
$$;

-- From 0025: the revisions of the documents that are in the workspace.
CREATE OR REPLACE FUNCTION chronelle_storage_references(
  workspace_id uuid,
  user_id uuid,
  storage_provider text,
  observed_at timestamptz,
  row_limit integer
)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  canonical jsonb;
  revisions jsonb;
  uploads jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM workspace_members m
    WHERE m.workspace_id = workspace_id AND m.user_id = user_id AND m.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT COALESCE(jsonb_agg(k.key), '[]'::jsonb) INTO canonical
  FROM (
    SELECT DISTINCT d.storage_key AS key
    FROM documents d
    WHERE d.workspace_id = workspace_id AND d.storage_provider = storage_provider
    LIMIT row_limit + 1
  ) k;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schemaVersion', r.schema_version, 'objectType', r.object_type, 'provider', r.provider, 'key', r.key)), '[]'::jsonb)
  INTO revisions
  FROM (
    SELECT DISTINCT
      rv.snapshot_schema_version AS schema_version,
      rv.snapshot ->> 'objectType' AS object_type,
      CASE WHEN jsonb_typeof(rv.snapshot -> 'storageProvider') = 'string' THEN rv.snapshot ->> 'storageProvider' END AS provider,
      rv.snapshot ->> 'storageKey' AS key
    FROM object_revisions rv
    JOIN objects o ON o.id = rv.object_id AND o.object_type = 'document'
    WHERE o.workspace_id = workspace_id
    LIMIT row_limit + 1
  ) r;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', u.key, 'recoverable', u.recoverable)), '[]'::jsonb) INTO uploads
  FROM (
    SELECT t.storage_key AS key,
           bool_or(t.consumed_at IS NOT NULL OR t.finalized_at IS NOT NULL OR t.expires_at > observed_at) AS recoverable
    FROM document_transfer_authorizations t
    WHERE t.workspace_id = workspace_id AND t.storage_provider = storage_provider AND t.operation = 'upload'
    GROUP BY t.storage_key
    LIMIT row_limit + 1
  ) u;
  RETURN jsonb_build_object('canonical', canonical, 'revisions', revisions, 'uploads', uploads);
END
$$;

-- From 0028: the revision of each object's current version.
CREATE OR REPLACE FUNCTION chronelle_backend_readiness()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'functions', (
      SELECT COALESCE(jsonb_agg(DISTINCT p.proname ORDER BY p.proname), '[]'::jsonb)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = current_schema() AND p.proname LIKE 'chronelle\_%'
    ),
    'objectsWithoutBaseline', (
      SELECT count(*)
      FROM objects o
      LEFT JOIN object_revisions r
        ON r.object_id = o.id AND r.object_version = o.version
      WHERE r.id IS NULL
    )
  );
$$;

-- From 0029: each object's latest revision.
CREATE OR REPLACE FUNCTION chronelle_revision_baseline()
RETURNS integer LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  target record;
  request_id uuid := chronelle_uuidv7();
  audit_id uuid;
  captured integer := 0;
  written_at timestamptz := now();
BEGIN
  LOCK TABLE objects, events, tasks, expenses, reminders, documents, object_revisions IN SHARE ROW EXCLUSIVE MODE;
  FOR target IN
    SELECT o.id, o.workspace_id, o.version,
           (SELECT max(r.object_version) FROM object_revisions r
            WHERE r.object_id = o.id) AS latest
    FROM objects o
    ORDER BY o.id
  LOOP
    IF target.latest IS NOT NULL THEN
      IF target.latest <> target.version THEN
        RAISE EXCEPTION 'An existing revision chain is incomplete; baseline cannot repair history.'
          USING ERRCODE = 'PT422';
      END IF;
      CONTINUE;
    END IF;
    audit_id := chronelle_uuidv7();
    INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
    VALUES (audit_id, target.workspace_id, 'system', NULL, 'object.baselined', target.id, request_id,
            jsonb_build_object('version', target.version), written_at);
    INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                  actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
    VALUES (chronelle_uuidv7(), target.workspace_id, target.id, target.version, 'baseline', NULL,
            'system', NULL, request_id, audit_id, 1, chronelle_object_snapshot(target.workspace_id, target.id), written_at);
    captured := captured + 1;
  END LOOP;
  RETURN captured;
END
$$;

-- From 0041: the revisions of the versions being replaced, the task's
-- and its subtasks'.
CREATE OR REPLACE FUNCTION chronelle_object_delete(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_id uuid,
  expected_version integer,
  deleted_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  saved objects%ROWTYPE;
  subtask objects%ROWTYPE;
  saved_subtask objects%ROWTYPE;
  subtask_audit_id uuid;
  audit_id uuid := chronelle_uuidv7();
  written_at timestamptz := now();
BEGIN
  IF NOT chronelle_can_delete(workspace_id, user_id, object_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  UPDATE objects o
  SET deleted_at = deleted_at, updated_at = deleted_at, version = o.version + 1
  WHERE o.workspace_id = workspace_id AND o.id = object_id AND o.version = expected_version AND o.deleted_at IS NULL
  RETURNING * INTO saved;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM object_revisions r
    WHERE r.object_id = object_id AND r.object_version = expected_version
  ) THEN
    RAISE EXCEPTION 'Object revision baseline is missing; run db:baseline-revisions before serving writes.'
      USING ERRCODE = 'PT500';
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
  VALUES (audit_id, workspace_id, 'user', user_id, saved.object_type || '.deleted', object_id, request_id,
          jsonb_build_object('version', saved.version), written_at);
  INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
  VALUES (chronelle_uuidv7(), workspace_id, object_id, saved.version, 'deleted', NULL,
          'user', user_id, request_id, audit_id, 1, chronelle_object_snapshot(workspace_id, object_id), written_at);
  -- A task takes its live subtasks to Trash with it, at the same instant,
  -- each with its own audit event and revision.
  IF saved.object_type = 'task' THEN
    FOR subtask IN
      SELECT o.* FROM objects o
      JOIN tasks t ON t.workspace_id = o.workspace_id AND t.object_id = o.id
      WHERE o.workspace_id = workspace_id AND t.parent_task_id = object_id AND o.deleted_at IS NULL
      ORDER BY o.id
      FOR UPDATE OF o
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM object_revisions r
        WHERE r.object_id = subtask.id AND r.object_version = subtask.version
      ) THEN
        RAISE EXCEPTION 'Object revision baseline is missing; run db:baseline-revisions before serving writes.'
          USING ERRCODE = 'PT500';
      END IF;
      UPDATE objects o
      SET deleted_at = deleted_at, deleted_with = object_id, updated_at = deleted_at, version = o.version + 1
      WHERE o.workspace_id = workspace_id AND o.id = subtask.id
      RETURNING * INTO saved_subtask;
      subtask_audit_id := chronelle_uuidv7();
      INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
      VALUES (subtask_audit_id, workspace_id, 'user', user_id, 'task.deleted', saved_subtask.id, request_id,
              jsonb_build_object('cascadeFrom', object_id::text, 'version', saved_subtask.version), written_at);
      INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                    actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
      VALUES (chronelle_uuidv7(), workspace_id, saved_subtask.id, saved_subtask.version, 'deleted', NULL,
              'user', user_id, request_id, subtask_audit_id, 1, chronelle_object_snapshot(workspace_id, saved_subtask.id), written_at);
    END LOOP;
  END IF;
  RETURN jsonb_build_object('id', object_id::text, 'version', saved.version, 'deletedAt', chronelle_iso(deleted_at));
END
$$;

-- From 0041: the revisions of the versions being replaced, the task's
-- and its subtasks'.
CREATE OR REPLACE FUNCTION chronelle_object_recover(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_id uuid,
  expected_version integer
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  current_object objects%ROWTYPE;
  saved objects%ROWTYPE;
  subtask objects%ROWTYPE;
  saved_subtask objects%ROWTYPE;
  subtask_audit_id uuid;
  audit_id uuid := chronelle_uuidv7();
  written_at timestamptz := now();
BEGIN
  IF NOT chronelle_can_recover(workspace_id, user_id, object_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT * INTO current_object FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = object_id
  FOR UPDATE;
  IF current_object.version <> expected_version THEN
    RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
  END IF;
  IF current_object.deleted_at IS NULL THEN
    RAISE EXCEPTION 'The object is not in Trash.' USING ERRCODE = 'PT422';
  END IF;
  IF current_object.permission_scope_id <> current_object.id AND NOT EXISTS (
    SELECT 1 FROM objects scope
    WHERE scope.workspace_id = workspace_id AND scope.id = current_object.permission_scope_id AND scope.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Restore the canonical permission scope first. Recovery does not change permissions.'
      USING ERRCODE = 'PT422';
  END IF;
  -- A subtask cannot come back under a parent that is still in Trash.
  IF current_object.object_type = 'task' AND EXISTS (
    SELECT 1 FROM tasks t
    JOIN objects parent ON parent.workspace_id = t.workspace_id AND parent.id = t.parent_task_id
    WHERE t.workspace_id = workspace_id AND t.object_id = object_id AND parent.deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Restore the parent task first.' USING ERRCODE = 'PT422';
  END IF;
  UPDATE objects o
  SET deleted_at = NULL, deleted_with = NULL, updated_at = written_at, version = o.version + 1
  WHERE o.workspace_id = workspace_id AND o.id = object_id AND o.version = expected_version AND o.deleted_at IS NOT NULL
  RETURNING * INTO saved;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM object_revisions r
    WHERE r.object_id = object_id AND r.object_version = expected_version
  ) THEN
    RAISE EXCEPTION 'Object revision baseline is missing; run db:baseline-revisions before serving writes.'
      USING ERRCODE = 'PT500';
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
  VALUES (audit_id, workspace_id, 'user', user_id, saved.object_type || '.recovered', object_id, request_id,
          jsonb_build_object('previousVersion', expected_version, 'deletedAt', chronelle_iso(current_object.deleted_at),
                             'version', saved.version), written_at);
  INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
  VALUES (chronelle_uuidv7(), workspace_id, object_id, saved.version, 'recovered', NULL,
          'user', user_id, request_id, audit_id, 1, chronelle_object_snapshot(workspace_id, object_id), written_at);
  -- The subtasks that went to Trash with the task come back with it; those
  -- trashed on their own stay.
  IF saved.object_type = 'task' THEN
    FOR subtask IN
      SELECT o.* FROM objects o
      JOIN tasks t ON t.workspace_id = o.workspace_id AND t.object_id = o.id
      WHERE o.workspace_id = workspace_id AND t.parent_task_id = object_id AND o.deleted_with = object_id
      ORDER BY o.id
      FOR UPDATE OF o
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM object_revisions r
        WHERE r.object_id = subtask.id AND r.object_version = subtask.version
      ) THEN
        RAISE EXCEPTION 'Object revision baseline is missing; run db:baseline-revisions before serving writes.'
          USING ERRCODE = 'PT500';
      END IF;
      UPDATE objects o
      SET deleted_at = NULL, deleted_with = NULL, updated_at = written_at, version = o.version + 1
      WHERE o.workspace_id = workspace_id AND o.id = subtask.id
      RETURNING * INTO saved_subtask;
      subtask_audit_id := chronelle_uuidv7();
      INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
      VALUES (subtask_audit_id, workspace_id, 'user', user_id, 'task.recovered', saved_subtask.id, request_id,
              jsonb_build_object('cascadeFrom', object_id::text, 'previousVersion', saved_subtask.version - 1,
                                 'deletedAt', chronelle_iso(current_object.deleted_at), 'version', saved_subtask.version), written_at);
      INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                    actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
      VALUES (chronelle_uuidv7(), workspace_id, saved_subtask.id, saved_subtask.version, 'recovered', NULL,
              'user', user_id, request_id, subtask_audit_id, 1, chronelle_object_snapshot(workspace_id, saved_subtask.id), written_at);
    END LOOP;
  END IF;
  RETURN chronelle_object_rows(workspace_id, object_id);
END
$$;

-- From 0060: the revision of each note's current version, for its editor.
CREATE OR REPLACE FUNCTION chronelle_note_list(workspace_id uuid, user_id uuid, event_id uuid, sort text DEFAULT 'edited')
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  page jsonb;
BEGIN
  IF sort IS NULL OR sort NOT IN ('edited', 'title') THEN
    RAISE EXCEPTION 'The sort is invalid.' USING ERRCODE = 'PT422';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM objects o
    WHERE o.workspace_id = workspace_id AND o.id = event_id
      AND o.object_type = 'event' AND o.deleted_at IS NULL
  ) OR NOT chronelle_can_view(workspace_id, user_id, event_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT jsonb_build_object(
    'sourceEventId', event_id::text,
    'items', COALESCE(jsonb_agg(
      jsonb_build_object('object', to_jsonb(o), 'note', to_jsonb(n), 'editedBy', u.display_name)
      ORDER BY
        CASE WHEN sort = 'edited' THEN o.updated_at END DESC,
        CASE WHEN sort = 'title' THEN lower(o.display_name) COLLATE "C" END ASC,
        o.id ASC
    ), '[]'::jsonb)
  )
  INTO page
  FROM object_relations rel
  JOIN objects o ON o.workspace_id = rel.workspace_id AND o.id = rel.target_object_id
  JOIN notes n ON n.workspace_id = o.workspace_id AND n.object_id = o.id
  LEFT JOIN object_revisions r
    ON r.object_id = o.id AND r.object_version = o.version
  LEFT JOIN users u ON r.actor_type = 'user' AND u.id = r.actor_id
  WHERE rel.workspace_id = workspace_id
    AND rel.source_object_id = event_id
    AND rel.relation_type = 'includes'
    AND rel.deleted_at IS NULL
    AND o.deleted_at IS NULL
    AND chronelle_can_view(workspace_id, user_id, o.id);
  RETURN page;
END
$$;

-- From 0060: the revision of the version being replaced.
CREATE OR REPLACE FUNCTION chronelle_object_update(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_type text,
  object_id uuid,
  expected_version integer,
  changes jsonb,
  command jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  current_object objects%ROWTYPE;
  next_version integer;
  audit_id uuid := chronelle_uuidv7();
  written_at timestamptz := now();
  audit_metadata jsonb;
  snapshot jsonb;
  rows jsonb;
BEGIN
  IF object_type NOT IN ('event', 'task', 'expense', 'reminder', 'person', 'note') THEN
    RAISE EXCEPTION 'Unsupported object type %.', object_type USING ERRCODE = 'PT422';
  END IF;
  IF NOT chronelle_can_edit(workspace_id, user_id, object_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT * INTO current_object FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = object_id AND o.object_type = object_type
  FOR UPDATE;
  IF NOT FOUND OR current_object.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  EXECUTE format('SELECT chronelle_%I_validate($1, $2, $3)', object_type) USING workspace_id, object_id, changes;
  IF current_object.version <> expected_version THEN
    RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
  END IF;
  next_version := expected_version + 1;
  UPDATE objects o
  SET display_name = COALESCE(changes ->> 'displayName', o.display_name),
      custom_properties = COALESCE(changes -> 'customProperties', o.custom_properties),
      metadata = COALESCE(changes -> 'metadata', o.metadata),
      updated_at = written_at,
      version = next_version
  WHERE o.workspace_id = workspace_id AND o.id = object_id AND o.version = expected_version;
  EXECUTE format('SELECT chronelle_%I_apply($1, $2, $3)', object_type) USING workspace_id, object_id, changes;
  IF NOT EXISTS (
    SELECT 1 FROM object_revisions r
    WHERE r.object_id = object_id AND r.object_version = expected_version
  ) THEN
    RAISE EXCEPTION 'Object revision baseline is missing; run db:baseline-revisions before serving writes.'
      USING ERRCODE = 'PT500';
  END IF;
  audit_metadata := jsonb_build_object('previousVersion', expected_version, 'version', next_version);
  IF command IS NOT NULL THEN
    audit_metadata := audit_metadata || jsonb_build_object('command', command);
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
  VALUES (audit_id, workspace_id, 'user', user_id, object_type || '.updated', object_id, request_id, audit_metadata, written_at);
  EXECUTE format('SELECT chronelle_%I_serialize($1, $2)', object_type) INTO snapshot USING workspace_id, object_id;
  INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
  VALUES (chronelle_uuidv7(), workspace_id, object_id, next_version, 'updated', NULL,
          'user', user_id, request_id, audit_id, 1, snapshot, written_at);
  EXECUTE format('SELECT chronelle_%I_rows($1, $2)', object_type) INTO rows USING workspace_id, object_id;
  RETURN rows;
END
$$;

-- From 0060: the source revision and the revision of the version being
-- replaced.
CREATE OR REPLACE FUNCTION chronelle_object_restore(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_id uuid,
  expected_version integer,
  source_revision_id uuid,
  source_version integer,
  content jsonb
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  current_object objects%ROWTYPE;
  source object_revisions%ROWTYPE;
  saved objects%ROWTYPE;
  audit_id uuid := chronelle_uuidv7();
  written_at timestamptz := now();
BEGIN
  IF NOT chronelle_can_edit(workspace_id, user_id, object_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT * INTO current_object FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = object_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF current_object.version <> expected_version THEN
    RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO source FROM object_revisions r
  WHERE r.object_id = object_id
    AND r.id = source_revision_id AND r.object_version = source_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF source.snapshot ->> 'deletedAt' IS NOT NULL THEN
    RAISE EXCEPTION 'A deleted state cannot be restored through content history.' USING ERRCODE = 'PT422';
  END IF;

  UPDATE objects o
  SET display_name = content ->> 'displayName',
      custom_properties = COALESCE(content -> 'customProperties', '{}'::jsonb),
      updated_at = written_at,
      version = o.version + 1
  WHERE o.workspace_id = workspace_id AND o.id = object_id AND o.version = expected_version AND o.deleted_at IS NULL
  RETURNING * INTO saved;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
  END IF;
  -- Expense and Document content is preserved by policy; only the families
  -- with restorable typed fields take the content (a Person's contacts,
  -- never its linked account; a Note's text).
  IF saved.object_type IN ('event', 'task', 'reminder', 'person', 'note') THEN
    EXECUTE format('SELECT chronelle_%I_apply($1, $2, $3)', saved.object_type) USING workspace_id, object_id, content;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM object_revisions r
    WHERE r.object_id = object_id AND r.object_version = expected_version
  ) THEN
    RAISE EXCEPTION 'Object revision baseline is missing; run db:baseline-revisions before serving writes.'
      USING ERRCODE = 'PT500';
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
  VALUES (audit_id, workspace_id, 'user', user_id, saved.object_type || '.restored', object_id, request_id,
          jsonb_build_object('previousVersion', expected_version, 'sourceVersion', source_version,
                             'version', saved.version, 'sourceRevisionId', source_revision_id::text), written_at);
  INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
  VALUES (chronelle_uuidv7(), workspace_id, object_id, saved.version, 'restored', source_revision_id,
          'user', user_id, request_id, audit_id, 1, chronelle_object_snapshot(workspace_id, object_id), written_at);
  RETURN chronelle_object_rows(workspace_id, object_id);
END
$$;
