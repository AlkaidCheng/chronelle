-- Backend readiness as a read-only database function: the chronelle_*
-- functions installed in the current schema and the number of live
-- canonical objects whose current version has no revision. A deployment
-- that runs on the gateway alone calls it at startup instead of connecting
-- to PostgreSQL, refusing to serve until every function it relies on is
-- present and the revision baseline holds.
CREATE FUNCTION chronelle_backend_readiness()
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
        ON r.workspace_id = o.workspace_id AND r.object_id = o.id AND r.object_version = o.version
      WHERE r.id IS NULL
    )
  );
$$;
