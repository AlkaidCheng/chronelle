-- Read only the fields needed to choose a page. Locale-sensitive name
-- matching and ordering stay in the application; canonical payloads are
-- hydrated only for the selected IDs. Updated/manual keysets can be bounded
-- here without changing the application's collation or millisecond precision.
CREATE FUNCTION chronelle_event_list_candidates(
  workspace_id uuid, user_id uuid, access_at timestamptz, as_of timestamptz,
  list_scope text, period text, page_limit integer, after_position jsonb,
  include_counts boolean
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH members AS MATERIALIZED (
    SELECT m.workspace_id FROM workspace_members m WHERE m.user_id = $2
  ), visible AS MATERIALIZED (
    SELECT o.id, o.workspace_id, o.display_name, o.updated_at,
           e.starts_at, e.ends_at, e.starts_on, e.ends_on,
           EXISTS (SELECT 1 FROM members m WHERE m.workspace_id = o.workspace_id) AS own
    FROM objects o
    JOIN events e ON e.workspace_id = o.workspace_id AND e.object_id = o.id
    WHERE o.object_type = 'event' AND o.deleted_at IS NULL AND o.permission_scope_id = o.id
      AND (
        (o.workspace_id = $1 AND EXISTS (SELECT 1 FROM members m WHERE m.workspace_id = o.workspace_id))
        OR (NOT EXISTS (SELECT 1 FROM members m WHERE m.workspace_id = o.workspace_id)
            AND EXISTS (
              SELECT 1 FROM resource_grants g
              WHERE g.workspace_id = o.workspace_id AND g.resource_id = o.id
                AND g.principal_type = 'user' AND g.principal_id = $2
                AND (g.expires_at IS NULL OR g.expires_at > $3)
            ))
      )
  ), periods AS (
    SELECT v.*,
      (coalesce(v.ends_on, v.starts_on) < ($4 AT TIME ZONE 'UTC')::date
        OR coalesce(v.ends_at, v.starts_at) < $4) IS TRUE AS past,
      (coalesce(v.ends_on, v.starts_on) >= ($4 AT TIME ZONE 'UTC')::date
        OR coalesce(v.ends_at, v.starts_at) >= $4) IS TRUE AS upcoming
    FROM visible v
  ), page AS (
    SELECT p.* FROM periods p
    WHERE ($5 = 'all' OR ($5 = 'mine' AND p.own) OR ($5 = 'shared' AND NOT p.own))
      AND ($6 = 'all' OR ($6 = 'past' AND p.past) OR ($6 = 'upcoming' AND p.upcoming)
        OR ($6 = 'unscheduled' AND p.starts_at IS NULL AND p.starts_on IS NULL))
      AND ($8 IS NULL
        OR date_trunc('milliseconds', p.updated_at) < date_trunc('milliseconds', ($8 ->> 'updatedAt')::timestamptz)
        OR (date_trunc('milliseconds', p.updated_at) = date_trunc('milliseconds', ($8 ->> 'updatedAt')::timestamptz)
            AND p.id > ($8 ->> 'id')::uuid))
    ORDER BY date_trunc('milliseconds', p.updated_at) DESC, p.id
    LIMIT $7
  )
  SELECT jsonb_build_object(
    'rows', coalesce((SELECT jsonb_agg(to_jsonb(p) - 'past' - 'upcoming') FROM page p), '[]'::jsonb),
    'counts', CASE WHEN $9 THEN (
      SELECT jsonb_build_object('all', count(*), 'mine', count(*) FILTER (WHERE own),
        'shared', count(*) FILTER (WHERE NOT own), 'past', count(*) FILTER (WHERE past),
        'upcoming', count(*) FILTER (WHERE upcoming)) FROM periods
    ) ELSE NULL END
  );
$$;

-- Collection visibility follows the read adapter's active memberships and
-- direct/inherited grants, including grants on retained scopes. The grant's
-- narrowing still controls which live records can appear in the collection.
CREATE FUNCTION chronelle_collection_candidates(
  requested_workspace_id uuid, requesting_user_id uuid, requested_type text, access_at timestamptz
)
RETURNS TABLE(id uuid, workspace_id uuid, display_name text, updated_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT o.id, o.workspace_id, o.display_name, o.updated_at
  FROM objects o
  WHERE o.workspace_id = $1 AND o.object_type = $3 AND o.deleted_at IS NULL
    AND (EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = $1 AND m.user_id = $2)
      OR EXISTS (
        SELECT 1 FROM resource_grants g
        WHERE g.workspace_id = $1 AND g.principal_type = 'user' AND g.principal_id = $2
          AND (g.expires_at IS NULL OR g.expires_at > $4)
          AND (g.resource_id = o.id OR (g.resource_id = o.permission_scope_id
            AND chronelle_grant_admits(g.scope, g.section_id, o.id, o.object_type)))
      ));
$$;

CREATE FUNCTION chronelle_task_list_candidates(
  workspace_id uuid, user_id uuid, status_filter text, label_id uuid,
  assignee_id uuid, list_sort text, page_limit integer, after_position jsonb,
  access_at timestamptz
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) FROM (
    SELECT o.id, o.display_name, o.updated_at, t.due_on, t.due_at, t.rank
    FROM chronelle_collection_candidates($1, $2, 'task', $9) o
    JOIN tasks t ON t.workspace_id = o.workspace_id AND t.object_id = o.id
    WHERE ($3 = 'all' OR ($3 = 'done' AND t.status = 'done')
        OR ($3 = 'open' AND t.status IN ('todo', 'in_progress')))
      AND ($4 IS NULL OR EXISTS (
        SELECT 1 FROM task_labels tl
        WHERE tl.workspace_id = $1 AND tl.task_id = o.id AND tl.label_id = $4
      ))
      AND ($5 IS NULL OR t.assignee_person_id = $5)
      AND ($8 IS NULL OR
        ($6 = 'updated' AND (
          date_trunc('milliseconds', o.updated_at) < date_trunc('milliseconds', ($8 ->> 'updatedAt')::timestamptz)
          OR (date_trunc('milliseconds', o.updated_at) = date_trunc('milliseconds', ($8 ->> 'updatedAt')::timestamptz) AND o.id > ($8 ->> 'id')::uuid)))
        OR ($6 = 'manual' AND (t.rank COLLATE "C", o.id) > (($8 ->> 'rank') COLLATE "C", ($8 ->> 'id')::uuid)))
    ORDER BY CASE WHEN $6 = 'updated' THEN date_trunc('milliseconds', o.updated_at) END DESC,
      CASE WHEN $6 = 'manual' THEN t.rank END COLLATE "C", o.id
    LIMIT $7
  ) p;
$$;

CREATE FUNCTION chronelle_person_list_candidates(workspace_id uuid, user_id uuid, access_at timestamptz)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'display_name', o.display_name)), '[]'::jsonb)
  FROM chronelle_collection_candidates($1, $2, 'person', $3) o
  JOIN persons p ON p.workspace_id = o.workspace_id AND p.object_id = o.id;
$$;
