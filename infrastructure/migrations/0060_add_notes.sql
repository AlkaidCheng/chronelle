-- A Note is a canonical object: a title (the display name) and a plain-text
-- body kept with an Event, versioned, audited, trashed, restored, and
-- searched by title like every object. The family supplies the typed steps
-- the write core of migration 0013 resolves by name; the core's type lists,
-- the restore function of migration 0019, the search of 0021, and the
-- relation rule of 0040 admit the new type, otherwise unchanged from
-- migrations 0037, 0040, and 0042. chronelle_note_list is the Notes
-- projection of an Event: the notes it includes that the caller may view,
-- each with the display name of the account that wrote its current version.
ALTER TABLE objects DROP CONSTRAINT objects_type_valid;
ALTER TABLE objects ADD CONSTRAINT objects_type_valid
  CHECK (object_type IN ('event', 'task', 'expense', 'reminder', 'document', 'person', 'note'));

CREATE TABLE notes (
  object_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  object_type text NOT NULL DEFAULT 'note',
  body text NOT NULL DEFAULT '',
  CONSTRAINT notes_canonical_object_fk
    FOREIGN KEY (workspace_id, object_id, object_type)
    REFERENCES objects(workspace_id, id, object_type)
    ON DELETE RESTRICT,
  CONSTRAINT notes_object_type_valid
    CHECK (object_type = 'note'),
  CONSTRAINT notes_body_length
    CHECK (length(body) <= 20000)
);

-- The service's assertNoteState(), with the same message: the text is at
-- most 20,000 characters.
CREATE FUNCTION chronelle_assert_note_state(body text)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF body IS NULL OR length(body) > 20000 THEN
    RAISE EXCEPTION 'body must be text of at most 20000 characters.' USING ERRCODE = 'PT422';
  END IF;
END
$$;

CREATE FUNCTION chronelle_note_serialize(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT chronelle_serialize_object($1, $2) || jsonb_build_object(
    'objectType', 'note',
    'body', n.body
  )
  FROM notes n
  WHERE n.workspace_id = $1 AND n.object_id = $2;
$$;

CREATE FUNCTION chronelle_note_rows(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('object', to_jsonb(o), 'note', to_jsonb(n))
  FROM objects o
  JOIN notes n ON n.workspace_id = o.workspace_id AND n.object_id = o.id
  WHERE o.workspace_id = $1 AND o.id = $2;
$$;

CREATE FUNCTION chronelle_note_insert(workspace_id uuid, object_id uuid, input jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  body text := COALESCE(input ->> 'body', '');
BEGIN
  PERFORM chronelle_assert_note_state(body);
  INSERT INTO notes (object_id, workspace_id, body)
  VALUES (object_id, workspace_id, body);
END
$$;

CREATE FUNCTION chronelle_note_validate(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
BEGIN
  IF changes ? 'body' THEN
    PERFORM chronelle_assert_note_state(changes ->> 'body');
  END IF;
END
$$;

CREATE FUNCTION chronelle_note_apply(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
BEGIN
  UPDATE notes n
  SET body = CASE WHEN changes ? 'body' THEN changes ->> 'body' ELSE n.body END
  WHERE n.workspace_id = workspace_id AND n.object_id = object_id;
END
$$;

CREATE FUNCTION chronelle_note_create(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  input jsonb
)
RETURNS jsonb LANGUAGE sql VOLATILE AS $$
  SELECT chronelle_object_create($1, $2, $3, 'note', $4);
$$;

CREATE FUNCTION chronelle_note_update(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_id uuid,
  expected_version integer,
  changes jsonb,
  command jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql VOLATILE AS $$
  SELECT chronelle_object_update($1, $2, $3, 'note', $4, $5, $6, $7);
$$;

-- The Notes projection: the live notes an Event includes that the caller
-- may view, last edited first (or by title), each row with the display name
-- of the account whose revision is the note's current version.
CREATE FUNCTION chronelle_note_list(workspace_id uuid, user_id uuid, event_id uuid, sort text DEFAULT 'edited')
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
    ON r.workspace_id = o.workspace_id AND r.object_id = o.id AND r.object_version = o.version
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

CREATE OR REPLACE FUNCTION chronelle_object_create(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_type text,
  input jsonb
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  object_id uuid := chronelle_uuidv7();
  audit_id uuid := chronelle_uuidv7();
  written_at timestamptz := now();
  scope_id uuid := COALESCE((input ->> 'permissionScopeId')::uuid, object_id);
  command_id uuid := (input ->> 'commandId')::uuid;
  request_hash text := input ->> 'requestHash';
  existing object_create_commands%ROWTYPE;
  snapshot jsonb;
  rows jsonb;
BEGIN
  -- A repeated command returns what it created; a different input under the
  -- same command id is a conflict.
  IF command_id IS NOT NULL THEN
    IF request_hash IS NULL THEN
      RAISE EXCEPTION 'A commandId requires its requestHash.' USING ERRCODE = 'PT422';
    END IF;
    SELECT * INTO existing FROM object_create_commands c
    WHERE c.workspace_id = workspace_id AND c.user_id = user_id AND c.command_id = command_id;
    IF FOUND THEN
      IF existing.request_hash <> request_hash THEN
        RAISE EXCEPTION 'The command ID was already used with different input.' USING ERRCODE = 'PT409';
      END IF;
      IF NOT chronelle_can_view(workspace_id, user_id, existing.object_id) THEN
        RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
      END IF;
      RETURN chronelle_object_rows(workspace_id, existing.object_id);
    END IF;
    input := input - 'commandId' - 'requestHash';
  END IF;
  IF object_type NOT IN ('event', 'task', 'expense', 'reminder', 'person', 'note') THEN
    RAISE EXCEPTION 'Unsupported object type %.', object_type USING ERRCODE = 'PT422';
  END IF;
  IF input ? 'permissionScopeId' THEN
    IF NOT chronelle_can_edit(workspace_id, user_id, scope_id) THEN
      RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
    END IF;
  ELSIF NOT chronelle_can_create(workspace_id, user_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  INSERT INTO objects (id, workspace_id, object_type, display_name, created_by, permission_scope_id,
                       custom_properties, metadata, created_at, updated_at, version)
  VALUES (object_id, workspace_id, object_type, input ->> 'displayName', user_id, scope_id,
          COALESCE(input -> 'customProperties', '{}'::jsonb), COALESCE(input -> 'metadata', '{}'::jsonb),
          written_at, written_at, 1);
  EXECUTE format('SELECT chronelle_%I_insert($1, $2, $3)', object_type) USING workspace_id, object_id, input;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
  VALUES (audit_id, workspace_id, 'user', user_id, object_type || '.created', object_id, request_id,
          jsonb_build_object('permissionScopeId', scope_id::text, 'version', 1), written_at);
  EXECUTE format('SELECT chronelle_%I_serialize($1, $2)', object_type) INTO snapshot USING workspace_id, object_id;
  INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
  VALUES (chronelle_uuidv7(), workspace_id, object_id, 1, 'created', NULL,
          'user', user_id, request_id, audit_id, 1, snapshot, written_at);
  IF command_id IS NOT NULL THEN
    INSERT INTO object_create_commands (workspace_id, user_id, command_id, request_id, request_hash, object_type, object_id)
    VALUES (workspace_id, user_id, command_id, request_id, request_hash, object_type, object_id);
  END IF;
  EXECUTE format('SELECT chronelle_%I_rows($1, $2)', object_type) INTO rows USING workspace_id, object_id;
  RETURN rows;
END
$$;

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
    WHERE r.workspace_id = workspace_id AND r.object_id = object_id AND r.object_version = expected_version
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
  WHERE r.workspace_id = workspace_id AND r.object_id = object_id
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
    WHERE r.workspace_id = workspace_id AND r.object_id = object_id AND r.object_version = expected_version
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

CREATE OR REPLACE FUNCTION chronelle_object_search(
  workspace_id uuid,
  user_id uuid,
  query text,
  object_type text DEFAULT NULL,
  page_limit integer DEFAULT 20,
  after_rank real DEFAULT NULL,
  after_updated_at timestamptz DEFAULT NULL,
  after_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  page jsonb;
BEGIN
  IF workspace_id IS NULL OR user_id IS NULL THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF query IS NULL OR btrim(query) = '' THEN
    RAISE EXCEPTION 'The search query is invalid.' USING ERRCODE = 'PT422';
  END IF;
  IF object_type IS NOT NULL
     AND object_type NOT IN ('event', 'task', 'expense', 'reminder', 'document', 'person', 'note') THEN
    RAISE EXCEPTION 'The object type is invalid.' USING ERRCODE = 'PT422';
  END IF;
  IF page_limit IS NULL OR page_limit < 1 OR page_limit > 50 THEN
    RAISE EXCEPTION 'The page limit is invalid.' USING ERRCODE = 'PT422';
  END IF;
  IF (after_rank IS NULL) <> (after_updated_at IS NULL)
     OR (after_rank IS NULL) <> (after_id IS NULL)
     OR after_rank < 0 THEN
    RAISE EXCEPTION 'The search cursor is invalid for this query.' USING ERRCODE = 'PT422';
  END IF;

  WITH matches AS (
    SELECT o.id, o.object_type, o.display_name, o.permission_scope_id, o.updated_at, o.version,
           ts_rank(to_tsvector('simple', o.display_name), websearch_to_tsquery('simple', query)) AS rank
    FROM objects o
    WHERE o.workspace_id = workspace_id
      AND o.deleted_at IS NULL
      AND (object_type IS NULL OR o.object_type = object_type)
      AND to_tsvector('simple', o.display_name) @@ websearch_to_tsquery('simple', query)
      AND chronelle_can_view(workspace_id, user_id, o.id)
  ), positioned AS (
    SELECT m.*, row_number() OVER (ORDER BY m.rank DESC, m.updated_at DESC, m.id ASC) AS position
    FROM matches m
    WHERE after_rank IS NULL
       OR m.rank < after_rank
       OR (m.rank = after_rank
           AND (m.updated_at < after_updated_at
                OR (m.updated_at = after_updated_at AND m.id > after_id)))
    ORDER BY m.rank DESC, m.updated_at DESC, m.id ASC
    LIMIT page_limit + 1
  )
  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(jsonb_build_object(
      'id', w.id::text,
      'objectType', w.object_type,
      'displayName', w.display_name,
      'permissionScopeId', w.permission_scope_id::text,
      'updatedAt', chronelle_iso(w.updated_at),
      'version', w.version
    ) ORDER BY w.position) FILTER (WHERE w.position <= page_limit), '[]'::jsonb),
    'next', CASE WHEN count(*) > page_limit THEN
      jsonb_agg(jsonb_build_object(
        'id', w.id::text,
        'rank', w.rank,
        'updatedAt', to_char(w.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      )) FILTER (WHERE w.position = page_limit) -> 0
    END
  )
  INTO page
  FROM positioned w;
  RETURN page;
END
$$;

CREATE OR REPLACE FUNCTION chronelle_relation_compatible(source_type text, relation_type text, target_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE relation_type
    WHEN 'includes' THEN
      source_type = 'event' AND target_type IN ('event', 'task', 'expense', 'reminder', 'document', 'person', 'note')
    WHEN 'reminds_about' THEN
      source_type = 'reminder' AND target_type IN ('event', 'task')
    WHEN 'attached_to' THEN
      source_type = 'document' AND target_type IN ('event', 'task', 'expense')
    WHEN 'related_to' THEN true
    ELSE false
  END;
$$;
