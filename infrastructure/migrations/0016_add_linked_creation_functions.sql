-- Linked creation as one database function: a typed child on the Event's
-- canonical scope, the includes relation, both audit rows, and the
-- idempotency record of the command, committed together or not at all.
-- Relation creation is its own function so later relation work reuses it.
--
-- Errors follow the service: PT403 unavailable, PT422 invalid state,
-- PT400 invalid relation, PT409 with the service's message for a command
-- replayed with different input or an active relation that already exists.

-- View through membership of any role, or through an active grant of any
-- role on the object or its live canonical scope. Deleted objects are not
-- viewable; a missing object yields false.
CREATE FUNCTION chronelle_can_view(workspace_id uuid, user_id uuid, object_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM objects o
    WHERE o.workspace_id = $1 AND o.id = $3 AND o.deleted_at IS NULL
      AND (
        EXISTS (
          SELECT 1 FROM workspace_members m
          WHERE m.workspace_id = $1 AND m.user_id = $2
        ) OR EXISTS (
          SELECT 1 FROM resource_grants g
          WHERE g.workspace_id = $1
            AND g.principal_type = 'user'
            AND g.principal_id = $2
            AND (g.expires_at IS NULL OR g.expires_at > now())
            AND g.resource_id = o.id
        ) OR EXISTS (
          SELECT 1 FROM resource_grants g
          JOIN objects scope ON scope.workspace_id = g.workspace_id AND scope.id = g.resource_id
          WHERE g.workspace_id = $1
            AND g.principal_type = 'user'
            AND g.principal_id = $2
            AND (g.expires_at IS NULL OR g.expires_at > now())
            AND g.resource_id = o.permission_scope_id
            AND scope.deleted_at IS NULL
        )
      )
  );
$$;

-- The service's isCompatibleRelation().
CREATE FUNCTION chronelle_relation_compatible(source_type text, relation_type text, target_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE relation_type
    WHEN 'includes' THEN
      source_type = 'event' AND target_type IN ('event', 'task', 'expense', 'reminder', 'document')
    WHEN 'reminds_about' THEN
      source_type = 'reminder' AND target_type IN ('event', 'task')
    WHEN 'attached_to' THEN
      source_type = 'document' AND target_type IN ('event', 'task', 'expense')
    WHEN 'related_to' THEN true
    ELSE false
  END;
$$;

-- ObjectRelationService.create(): edit on the source, view on the target,
-- compatible types, one active relation per triple, one audit row.
-- Returns the relation row.
CREATE FUNCTION chronelle_relation_create(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  source_object_id uuid,
  relation_type text,
  target_object_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  source_type text;
  target_type text;
  relation_id uuid := chronelle_uuidv7();
  relation object_relations%ROWTYPE;
BEGIN
  IF source_object_id = target_object_id THEN
    RAISE EXCEPTION 'A relationship must connect two distinct objects.' USING ERRCODE = 'PT400';
  END IF;
  IF NOT chronelle_can_edit(workspace_id, user_id, source_object_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT o.object_type INTO source_type FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = source_object_id AND o.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF NOT chronelle_can_view(workspace_id, user_id, target_object_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT o.object_type INTO target_type FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = target_object_id;
  IF NOT chronelle_relation_compatible(source_type, relation_type, target_type) THEN
    RAISE EXCEPTION 'The relationship is not valid for these object types.' USING ERRCODE = 'PT400';
  END IF;

  INSERT INTO object_relations (id, workspace_id, source_object_id, relation_type, target_object_id, metadata, created_by)
  VALUES (relation_id, workspace_id, source_object_id, relation_type, target_object_id,
          COALESCE(metadata, '{}'::jsonb), user_id)
  ON CONFLICT DO NOTHING
  RETURNING * INTO relation;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The active relationship already exists.' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), workspace_id, 'user', user_id, 'relation.created', source_object_id, request_id,
          jsonb_build_object('relationId', relation_id::text, 'relationType', relation_type,
                             'targetObjectId', target_object_id::text));
  RETURN to_jsonb(relation);
END
$$;

-- EventContextService.create(): one resource included in a self-scoped Event,
-- once per user, workspace, and command. A replay with the same request hash
-- returns the original result; a replay with different input is a conflict.
-- Returns {resource, relationId}, where resource is the child's version-1
-- revision snapshot (the serialized resource).
CREATE FUNCTION chronelle_event_context_create(
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
    WHERE r.workspace_id = workspace_id AND r.object_id = existing.object_id
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
  WHERE r.workspace_id = workspace_id AND r.object_id = child_id AND r.object_version = 1;
  RETURN jsonb_build_object('resource', snapshot, 'relationId', relation ->> 'id');
END
$$;
