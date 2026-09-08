CREATE TABLE event_page_revisions (
  workspace_id uuid NOT NULL,
  event_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  pages jsonb NOT NULL CHECK (jsonb_typeof(pages) = 'array' AND jsonb_array_length(pages) <= 20),
  audit_event_id uuid NOT NULL UNIQUE REFERENCES audit_events(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, event_id, version),
  FOREIGN KEY (workspace_id, event_id) REFERENCES objects(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (event_id) REFERENCES events(object_id) ON DELETE RESTRICT
);

CREATE FUNCTION chronelle_reject_event_page_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'event page history is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER event_page_revisions_append_only BEFORE UPDATE OR DELETE ON event_page_revisions
FOR EACH ROW EXECUTE FUNCTION chronelle_reject_event_page_mutation();
CREATE TRIGGER event_page_revisions_no_truncate BEFORE TRUNCATE ON event_page_revisions
FOR EACH STATEMENT EXECUTE FUNCTION chronelle_reject_event_page_mutation();
