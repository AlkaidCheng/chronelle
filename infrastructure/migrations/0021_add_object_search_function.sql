-- Object search as a database function, so a deployment that reaches
-- PostgreSQL only through the CloudBase gateway's rpc route gets the same
-- full-text query, ranking, authorization, and keyset pagination as
-- CanonicalObjectSearchService. The function only reads; a TCP deployment
-- carries it unused.
--
-- A match is an active (not deleted) object of the workspace whose display
-- name satisfies websearch_to_tsquery('simple', query), optionally limited to
-- one object type, that the user may view: through workspace membership, a
-- direct grant, or a grant on the object's permission scope while that scope
-- is active, with expired grants ignored (chronelle_can_view, migration
-- 0016). Matches are ordered by ts_rank descending, then updated_at
-- descending, then id ascending.
--
-- The result is one page as jsonb: `items` holds up to page_limit matches in
-- that order with the fields of the search resource (id, objectType,
-- displayName, permissionScopeId, updatedAt at millisecond precision,
-- version); `next` is the keyset position of the last item (id, rank,
-- updatedAt at microsecond precision) when more matches follow, else null.
-- The caller encodes the cursor envelope and passes a decoded position back
-- as the after_* arguments, which must be given together; the page then
-- holds the matches that sort after that position. A principal with no
-- access gets an empty page, like the service.
--
-- Errors: PT403 when workspace_id or user_id is missing; PT422 for an empty
-- query, an unknown object type, a page limit outside 1..50, or a partial or
-- negative cursor position.
CREATE FUNCTION chronelle_object_search(
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
     AND object_type NOT IN ('event', 'task', 'expense', 'reminder', 'document') THEN
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
