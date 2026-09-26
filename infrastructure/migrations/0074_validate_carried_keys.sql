-- Checks the existing rows against the keys the previous migration re-added
-- NOT VALID. Validating takes SHARE UPDATE EXCLUSIVE on each table and ROW
-- SHARE on objects, so reads and writes continue while it scans. A section
-- whose workspace is not its Event's fails sections_event_workspace_fk.
ALTER TABLE events VALIDATE CONSTRAINT events_canonical_object_fk;
ALTER TABLE tasks VALIDATE CONSTRAINT tasks_canonical_object_fk;
ALTER TABLE expenses VALIDATE CONSTRAINT expenses_canonical_object_fk;
ALTER TABLE reminders VALIDATE CONSTRAINT reminders_canonical_object_fk;
ALTER TABLE documents VALIDATE CONSTRAINT documents_canonical_object_fk;
ALTER TABLE notes VALIDATE CONSTRAINT notes_canonical_object_fk;
ALTER TABLE object_relations VALIDATE CONSTRAINT object_relations_source_workspace_fk;
ALTER TABLE object_relations VALIDATE CONSTRAINT object_relations_target_workspace_fk;
ALTER TABLE resource_grants VALIDATE CONSTRAINT resource_grants_resource_workspace_fk;
ALTER TABLE pending_shares VALIDATE CONSTRAINT pending_shares_resource_workspace_fk;
ALTER TABLE document_transfer_authorizations VALIDATE CONSTRAINT document_transfers_resource_workspace_fk;
ALTER TABLE sections VALIDATE CONSTRAINT sections_event_workspace_fk;
