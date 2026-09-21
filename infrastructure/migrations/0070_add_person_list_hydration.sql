-- Hydrate one selected Person page in a single snapshot. Candidate selection
-- remains separate so locale-sensitive filtering and ordering stay in the
-- application. Visibility is checked again before canonical state is returned.
CREATE FUNCTION chronelle_person_list_hydrate(
  workspace_id uuid, user_id uuid, person_ids jsonb, access_at timestamptz
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH requested AS MATERIALIZED (
    SELECT value::uuid AS id, ordinality
    FROM jsonb_array_elements_text($3) WITH ORDINALITY
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'object', to_jsonb(o),
    'person', to_jsonb(p),
    'contacts', chronelle_person_contacts($1, o.id),
    'labels', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name))
      FROM person_labels pl
      JOIN labels l
        ON l.workspace_id = pl.workspace_id AND l.id = pl.label_id
      WHERE pl.workspace_id = $1 AND pl.person_id = o.id
    ), '[]'::jsonb)
  ) ORDER BY requested.ordinality), '[]'::jsonb)
  FROM requested
  JOIN chronelle_collection_candidates($1, $2, 'person', $4) visible
    ON visible.id = requested.id
  JOIN objects o
    ON o.workspace_id = visible.workspace_id AND o.id = visible.id
  JOIN persons p
    ON p.workspace_id = o.workspace_id AND p.object_id = o.id;
$$;

-- CloudBase shared PostgreSQL maps server credentials to service_role. Keep
-- browser roles and PUBLIC from calling this authorization-bearing function;
-- local PostgreSQL installations may not define those managed-service roles.
REVOKE ALL ON FUNCTION chronelle_person_list_hydrate(uuid, uuid, jsonb, timestamptz) FROM PUBLIC;
DO $acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION chronelle_person_list_hydrate(uuid, uuid, jsonb, timestamptz) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION chronelle_person_list_hydrate(uuid, uuid, jsonb, timestamptz) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION chronelle_person_list_hydrate(uuid, uuid, jsonb, timestamptz) TO service_role';
  END IF;
END
$acl$;
