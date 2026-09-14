-- The revision baseline as a database function: every canonical object
-- whose current version has no revision receives the object.baselined audit
-- event and the baseline revision of its current state, as
-- baselineObjectRevisions() records them through a PostgreSQL connection.
-- A deployment that reaches the database only through the gateway runs it
-- before enabling the CloudBase backend. Stop all API writers first; the
-- tables are locked for the call. Returns the number of baselines captured.
--
-- Errors: PT422 when an object has revisions but none for its current
-- version, which the baseline cannot repair.
CREATE FUNCTION chronelle_revision_baseline()
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
            WHERE r.workspace_id = o.workspace_id AND r.object_id = o.id) AS latest
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
