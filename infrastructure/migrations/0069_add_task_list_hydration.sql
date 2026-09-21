-- Hydrate one selected Task page in a single snapshot. Candidate selection
-- remains separate so locale-sensitive filtering, ordering, and cursor rules
-- stay in the application. Visibility is checked again here for every Task,
-- Event context, parent, and subtask returned after that selection.
CREATE FUNCTION chronelle_task_list_hydrate(
  workspace_id uuid, user_id uuid, task_ids jsonb, access_at timestamptz
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH requested AS MATERIALIZED (
    SELECT value::uuid AS id, ordinality
    FROM jsonb_array_elements_text($3) WITH ORDINALITY
  ), page_objects AS MATERIALIZED (
    SELECT o.*, requested.ordinality
    FROM requested
    JOIN chronelle_collection_candidates($1, $2, 'task', $4) visible
      ON visible.id = requested.id
    JOIN objects o
      ON o.workspace_id = visible.workspace_id AND o.id = visible.id
  ), page_tasks AS MATERIALIZED (
    SELECT t.*
    FROM tasks t
    JOIN page_objects o
      ON o.workspace_id = t.workspace_id AND o.id = t.object_id
  ), page_labels AS (
    SELECT tl.task_id, l.id AS label_id, l.name AS label_name
    FROM task_labels tl
    JOIN page_objects o ON o.id = tl.task_id
    JOIN labels l
      ON l.workspace_id = tl.workspace_id AND l.id = tl.label_id
  ), page_inclusions AS (
    SELECT r.id, r.source_object_id, r.target_object_id, r.created_at,
      event.display_name
    FROM object_relations r
    JOIN page_tasks task ON task.object_id = r.target_object_id
    JOIN chronelle_collection_candidates($1, $2, 'event', $4) event
      ON event.id = r.source_object_id
    WHERE r.workspace_id = $1 AND r.relation_type = 'includes'
      AND r.deleted_at IS NULL
  ), visible_subtasks AS (
    SELECT child.object_id, child.parent_task_id, child.status
    FROM tasks child
    JOIN page_tasks parent ON parent.object_id = child.parent_task_id
    JOIN chronelle_collection_candidates($1, $2, 'task', $4) visible
      ON visible.id = child.object_id
    WHERE child.workspace_id = $1
  ), visible_parents AS (
    SELECT child.object_id AS task_id, parent.id AS parent_task_id,
      parent.display_name
    FROM page_tasks child
    JOIN chronelle_collection_candidates($1, $2, 'task', $4) parent
      ON parent.id = child.parent_task_id
  )
  SELECT jsonb_build_object(
    'objects', coalesce((
      SELECT jsonb_agg(to_jsonb(o) - 'ordinality' ORDER BY o.ordinality)
      FROM page_objects o
    ), '[]'::jsonb),
    'tasks', coalesce((
      SELECT jsonb_agg(to_jsonb(t)) FROM page_tasks t
    ), '[]'::jsonb),
    'labels', coalesce((
      SELECT jsonb_agg(to_jsonb(l)) FROM page_labels l
    ), '[]'::jsonb),
    'contexts', coalesce((
      SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at, i.id)
      FROM page_inclusions i
    ), '[]'::jsonb),
    'subtasks', coalesce((
      SELECT jsonb_agg(to_jsonb(s)) FROM visible_subtasks s
    ), '[]'::jsonb),
    'parents', coalesce((
      SELECT jsonb_agg(to_jsonb(p)) FROM visible_parents p
    ), '[]'::jsonb)
  );
$$;

-- CloudBase shared PostgreSQL maps server credentials to service_role. Keep
-- browser roles and PUBLIC from calling this authorization-bearing function;
-- local PostgreSQL installations may not define those managed-service roles.
REVOKE ALL ON FUNCTION chronelle_task_list_hydrate(uuid, uuid, jsonb, timestamptz) FROM PUBLIC;
DO $acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION chronelle_task_list_hydrate(uuid, uuid, jsonb, timestamptz) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION chronelle_task_list_hydrate(uuid, uuid, jsonb, timestamptz) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION chronelle_task_list_hydrate(uuid, uuid, jsonb, timestamptz) TO service_role';
  END IF;
END
$acl$;
