-- Reversible content commands as database functions: execute, undo, and
-- redo. Each call replays by receipt, checks the caller's stack, applies the
-- Event and Task edits through chronelle_object_update (each edit carries
-- the family's authorization, version, audit, and revision rules and names
-- the command in its audit metadata), records the command and the version
-- change of every object, advances the caller's stack, and writes the receipt
-- with its audit event, all in one transaction.
--
-- Errors follow ReversibleCommandService: PT403 unavailable (missing, in
-- Trash, of another type, or not editable by the caller), PT409 with the
-- service's messages for an operation replayed with different input, a stack
-- that moved, and an object that changed; PT500 for a revision the command
-- cannot invert.

-- ReversibleCommandService.replay(): the receipt an operation already
-- produced, once the caller can still view every object it names; NULL when
-- the operation is new; a conflict when the same operation id arrives with
-- different input.
CREATE FUNCTION chronelle_command_replay(
  workspace_id uuid,
  user_id uuid,
  operation_id uuid,
  request_hash text
)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  stored command_receipts%ROWTYPE;
  entry jsonb;
BEGIN
  SELECT * INTO stored FROM command_receipts r
  WHERE r.workspace_id = workspace_id AND r.user_id = user_id AND r.operation_id = operation_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF stored.request_hash <> request_hash THEN
    RAISE EXCEPTION 'The command ID was already used with different input.' USING ERRCODE = 'PT409';
  END IF;
  FOR entry IN SELECT * FROM jsonb_array_elements(stored.receipt -> 'objects') LOOP
    IF NOT chronelle_can_view(workspace_id, user_id, (entry ->> 'id')::uuid) THEN
      RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
    END IF;
  END LOOP;
  RETURN stored.receipt;
END
$$;

-- The caller's stack, locked for the transaction; the empty stack at version
-- 0 when none has been saved.
CREATE FUNCTION chronelle_command_stack(workspace_id uuid, user_id uuid)
RETURNS command_stacks LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  stack command_stacks%ROWTYPE;
BEGIN
  SELECT * INTO stack FROM command_stacks s
  WHERE s.workspace_id = workspace_id AND s.user_id = user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    stack.workspace_id := workspace_id;
    stack.user_id := user_id;
    stack.version := 0;
    stack.undo_ids := '{}';
    stack.redo_ids := '{}';
    stack.expected_versions := '{}'::jsonb;
  END IF;
  RETURN stack;
END
$$;

-- selectRestorableContent() for the families commands edit: the content of a
-- version-1 snapshot as an update, with every field present so a cleared
-- field is restored as cleared.
CREATE FUNCTION chronelle_command_content(object_type text, snapshot jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE object_type
    WHEN 'event' THEN jsonb_build_object(
      'displayName', snapshot -> 'displayName',
      'customProperties', snapshot -> 'customProperties',
      'startsOn', snapshot -> 'startsOn',
      'endsOn', snapshot -> 'endsOn',
      'startsAt', snapshot -> 'startsAt',
      'endsAt', snapshot -> 'endsAt',
      'timezone', snapshot -> 'timezone',
      'isAllDay', snapshot -> 'isAllDay')
    WHEN 'task' THEN jsonb_build_object(
      'displayName', snapshot -> 'displayName',
      'customProperties', snapshot -> 'customProperties',
      'status', snapshot -> 'status',
      'dueAt', snapshot -> 'dueAt',
      'completedAt', snapshot -> 'completedAt')
  END;
$$;

-- The current state a command may edit: the object must exist, be live, and
-- be editable by the caller.
CREATE FUNCTION chronelle_command_target(workspace_id uuid, user_id uuid, object_id uuid)
RETURNS objects LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  current_object objects%ROWTYPE;
BEGIN
  IF NOT chronelle_can_edit(workspace_id, user_id, object_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT * INTO current_object FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = object_id;
  IF NOT FOUND OR current_object.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  RETURN current_object;
END
$$;

-- saveCommandStack() and recordCommandReceipt(): advance the stack under
-- its version predicate, keep version expectations only for objects that a
-- retained command changed, and write the receipt with its audit event.
-- Returns the receipt.
CREATE FUNCTION chronelle_command_record(
  request_id uuid,
  request_hash text,
  stack command_stacks,
  receipt jsonb
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  retained uuid[] := stack.undo_ids || stack.redo_ids;
  retained_versions jsonb;
  audit_id uuid := chronelle_uuidv7();
BEGIN
  SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb) INTO retained_versions
  FROM jsonb_each(stack.expected_versions) e
  WHERE EXISTS (
    SELECT 1 FROM command_changes c
    WHERE c.workspace_id = stack.workspace_id AND c.user_id = stack.user_id
      AND c.command_id = ANY (retained) AND c.object_id = e.key::uuid
  );
  INSERT INTO command_stacks (workspace_id, user_id)
  VALUES (stack.workspace_id, stack.user_id)
  ON CONFLICT DO NOTHING;
  UPDATE command_stacks s
  SET version = stack.version + 1, undo_ids = stack.undo_ids, redo_ids = stack.redo_ids,
      expected_versions = retained_versions
  WHERE s.workspace_id = stack.workspace_id AND s.user_id = stack.user_id AND s.version = stack.version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The command history changed. Refresh before trying again.' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, request_id, metadata)
  VALUES (audit_id, stack.workspace_id, 'user', stack.user_id, 'command.' || (receipt ->> 'direction'), request_id, receipt);
  INSERT INTO command_receipts (workspace_id, user_id, operation_id, command_id, request_hash, audit_event_id, receipt)
  VALUES (stack.workspace_id, stack.user_id, (receipt ->> 'operationId')::uuid, (receipt ->> 'commandId')::uuid,
          request_hash, audit_id, receipt);
  RETURN receipt;
END
$$;

-- ReversibleCommandService.execute(): apply up to ten Event and Task content
-- edits as one command. `edits` is the request's array of
-- {objectType, objectId, patch}, with the patch's instants as ISO strings and
-- its expectedVersion; the request hash is the service's canonical hash of
-- the request, so a replay returns the same receipt on either backend.
-- Returns the receipt.
CREATE FUNCTION chronelle_command_execute(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  operation_id uuid,
  expected_stack_version integer,
  edits jsonb,
  request_hash text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  receipt jsonb := chronelle_command_replay(workspace_id, user_id, operation_id, request_hash);
  stack command_stacks%ROWTYPE;
  edit jsonb;
  edit_id uuid;
  current_object objects%ROWTYPE;
  expected integer;
  has_diverged boolean := false;
  versions jsonb := '[]'::jsonb;
  command jsonb := jsonb_build_object('id', operation_id::text, 'operationId', operation_id::text, 'direction', 'execute');
BEGIN
  IF receipt IS NOT NULL THEN
    RETURN receipt;
  END IF;
  stack := chronelle_command_stack(workspace_id, user_id);
  IF stack.version <> expected_stack_version THEN
    RAISE EXCEPTION 'The command history changed. Refresh before trying again.' USING ERRCODE = 'PT409';
  END IF;

  FOR edit IN SELECT e FROM jsonb_array_elements(edits) e ORDER BY (e ->> 'objectId')::uuid LOOP
    edit_id := (edit ->> 'objectId')::uuid;
    current_object := chronelle_command_target(workspace_id, user_id, edit_id);
    IF current_object.object_type <> (edit ->> 'objectType') THEN
      RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
    END IF;
    IF current_object.version <> (edit -> 'patch' ->> 'expectedVersion')::integer THEN
      RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
    END IF;
    expected := (stack.expected_versions ->> edit_id::text)::integer;
    IF expected IS NOT NULL AND expected <> current_object.version THEN
      has_diverged := true;
    END IF;
  END LOOP;
  -- A new command must not make an older inverse cross an intervening untracked edit.
  IF has_diverged THEN
    stack.undo_ids := '{}';
    stack.expected_versions := '{}'::jsonb;
  END IF;
  stack.redo_ids := '{}';

  INSERT INTO reversible_commands (workspace_id, user_id, id) VALUES (workspace_id, user_id, operation_id);
  FOR edit IN SELECT e FROM jsonb_array_elements(edits) e ORDER BY (e ->> 'objectId')::uuid LOOP
    edit_id := (edit ->> 'objectId')::uuid;
    expected := (edit -> 'patch' ->> 'expectedVersion')::integer;
    PERFORM chronelle_object_update(workspace_id, user_id, request_id, edit ->> 'objectType', edit_id,
                                    expected, (edit -> 'patch') - 'expectedVersion', command);
    INSERT INTO command_changes (workspace_id, user_id, command_id, object_id, before_version, after_version)
    VALUES (workspace_id, user_id, operation_id, edit_id, expected, expected + 1);
    versions := versions || jsonb_build_object('id', edit_id::text, 'version', expected + 1);
    stack.expected_versions := stack.expected_versions || jsonb_build_object(edit_id::text, expected + 1);
  END LOOP;
  stack.undo_ids := stack.undo_ids || operation_id;
  IF cardinality(stack.undo_ids) > 50 THEN
    stack.undo_ids := stack.undo_ids[cardinality(stack.undo_ids) - 49:];
  END IF;
  RETURN chronelle_command_record(request_id, request_hash, stack, jsonb_build_object(
    'operationId', operation_id::text, 'commandId', operation_id::text, 'direction', 'execute',
    'stackVersion', stack.version + 1, 'objects', versions));
END
$$;

-- ReversibleCommandService.undo() and redo(): move the command at the head
-- of the caller's undo or redo list to the other list by restoring each
-- changed object's content from the revision before or after the command.
-- Returns the receipt.
CREATE FUNCTION chronelle_command_transition(
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
    WHERE r.workspace_id = workspace_id AND r.object_id = change.object_id
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
