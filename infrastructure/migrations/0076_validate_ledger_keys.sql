-- Checks the existing ledger rows against the keys the previous migration
-- added NOT VALID. Validating takes SHARE UPDATE EXCLUSIVE on each ledger
-- table and ROW SHARE on the table its key references, so reads and writes
-- continue while it scans. Every row already met the workspace-keyed key
-- each of these replaces, so none fails.
ALTER TABLE audit_events VALIDATE CONSTRAINT audit_events_resource_fk;
ALTER TABLE object_revisions VALIDATE CONSTRAINT object_revisions_object_fk;
ALTER TABLE command_changes VALIDATE CONSTRAINT command_changes_before_revision_fk;
ALTER TABLE command_changes VALIDATE CONSTRAINT command_changes_after_revision_fk;
ALTER TABLE event_context_commands VALIDATE CONSTRAINT event_context_commands_context_object_fk;
ALTER TABLE event_context_commands VALIDATE CONSTRAINT event_context_commands_object_fk;
ALTER TABLE object_create_commands VALIDATE CONSTRAINT object_create_commands_object_fk;
