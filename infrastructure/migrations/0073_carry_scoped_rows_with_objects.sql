-- An object changes workspace through one UPDATE of objects.workspace_id
-- that names the object and everything in its permission scope, trashed
-- records included. The rows that live with those objects follow through
-- ON UPDATE CASCADE on their (workspace_id, ...) keys: typed rows,
-- relations, grants, shares waiting on an invitation, document transfer
-- authorizations, and the sections of an Event. Two keys keep NO ACTION:
-- the permission scope, so an UPDATE that leaves a scoped record behind
-- fails, and People cards, which stay in their workspace. History (audit
-- events, revisions, command records, page revisions) is not carried.
--
-- The keys are re-added NOT VALID, which checks new rows only; the next
-- migration validates the existing ones without blocking writes. Dropping a
-- foreign key locks both tables exclusively, so a busy lock fails fast.
SET LOCAL lock_timeout = '5s';

ALTER TABLE events
  DROP CONSTRAINT events_canonical_object_fk,
  ADD CONSTRAINT events_canonical_object_fk
    FOREIGN KEY (workspace_id, object_id, object_type)
    REFERENCES objects(workspace_id, id, object_type)
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE tasks
  DROP CONSTRAINT tasks_canonical_object_fk,
  ADD CONSTRAINT tasks_canonical_object_fk
    FOREIGN KEY (workspace_id, object_id, object_type)
    REFERENCES objects(workspace_id, id, object_type)
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE expenses
  DROP CONSTRAINT expenses_canonical_object_fk,
  ADD CONSTRAINT expenses_canonical_object_fk
    FOREIGN KEY (workspace_id, object_id, object_type)
    REFERENCES objects(workspace_id, id, object_type)
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE reminders
  DROP CONSTRAINT reminders_canonical_object_fk,
  ADD CONSTRAINT reminders_canonical_object_fk
    FOREIGN KEY (workspace_id, object_id, object_type)
    REFERENCES objects(workspace_id, id, object_type)
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE documents
  DROP CONSTRAINT documents_canonical_object_fk,
  ADD CONSTRAINT documents_canonical_object_fk
    FOREIGN KEY (workspace_id, object_id, object_type)
    REFERENCES objects(workspace_id, id, object_type)
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE notes
  DROP CONSTRAINT notes_canonical_object_fk,
  ADD CONSTRAINT notes_canonical_object_fk
    FOREIGN KEY (workspace_id, object_id, object_type)
    REFERENCES objects(workspace_id, id, object_type)
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE object_relations
  DROP CONSTRAINT object_relations_source_workspace_fk,
  DROP CONSTRAINT object_relations_target_workspace_fk,
  ADD CONSTRAINT object_relations_source_workspace_fk
    FOREIGN KEY (workspace_id, source_object_id)
    REFERENCES objects(workspace_id, id)
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT object_relations_target_workspace_fk
    FOREIGN KEY (workspace_id, target_object_id)
    REFERENCES objects(workspace_id, id)
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE resource_grants
  DROP CONSTRAINT resource_grants_resource_workspace_fk,
  ADD CONSTRAINT resource_grants_resource_workspace_fk
    FOREIGN KEY (workspace_id, resource_id)
    REFERENCES objects(workspace_id, id)
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE pending_shares
  DROP CONSTRAINT pending_shares_resource_workspace_fk,
  ADD CONSTRAINT pending_shares_resource_workspace_fk
    FOREIGN KEY (workspace_id, resource_id)
    REFERENCES objects(workspace_id, id)
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE document_transfer_authorizations
  DROP CONSTRAINT document_transfers_resource_workspace_fk,
  ADD CONSTRAINT document_transfers_resource_workspace_fk
    FOREIGN KEY (workspace_id, resource_id)
    REFERENCES objects(workspace_id, id)
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- A section now names its Event within its own workspace, so it lives
-- where the Event lives and follows it. Deleting the Event still deletes
-- its sections.
ALTER TABLE sections
  DROP CONSTRAINT sections_event_id_fkey,
  ADD CONSTRAINT sections_event_workspace_fk
    FOREIGN KEY (workspace_id, event_id)
    REFERENCES objects(workspace_id, id)
    ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

-- A relation changes only with a version step and never changes identity,
-- except when its objects change workspace and carry it along: then the
-- workspace is its only change and the version stays.
CREATE OR REPLACE FUNCTION chronelle_validate_relation_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id <> OLD.workspace_id
     AND to_jsonb(NEW) - 'workspace_id' = to_jsonb(OLD) - 'workspace_id' THEN
    RETURN NEW;
  END IF;
  IF NEW.version <> OLD.version + 1 OR
     (NEW.id, NEW.workspace_id, NEW.source_object_id, NEW.target_object_id,
      NEW.relation_type, NEW.created_by, NEW.created_at) IS DISTINCT FROM
     (OLD.id, OLD.workspace_id, OLD.source_object_id, OLD.target_object_id,
      OLD.relation_type, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'relation changes must advance version and preserve identity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- A narrowed grant names an Event, and its section belongs to that Event's
-- view of the same name. The section's workspace is the Event's through
-- sections_event_workspace_fk, so it is not compared here: a grant carried
-- to another workspace may be checked before its section is.
CREATE OR REPLACE FUNCTION chronelle_resource_grant_scope_check()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.scope <> 'all' AND NOT EXISTS (
    SELECT 1 FROM objects o
    WHERE o.workspace_id = NEW.workspace_id AND o.id = NEW.resource_id AND o.object_type = 'event'
  ) THEN
    RAISE EXCEPTION 'A share narrowed to a view names an Event.' USING ERRCODE = 'PT422';
  END IF;
  IF NEW.section_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sections s
    WHERE s.id = NEW.section_id AND s.event_id = NEW.resource_id AND s.view = NEW.scope
  ) THEN
    RAISE EXCEPTION 'The section is not a section of that view of the Event.' USING ERRCODE = 'PT422';
  END IF;
  RETURN NEW;
END
$$;
