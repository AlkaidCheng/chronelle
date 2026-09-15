-- An Event may include People, the same way it includes tasks, expenses,
-- reminders, and documents, so an event page can show who is involved.
-- The compatibility rule is the only change; linked creation and relation
-- lifecycle already dispatch by type.
CREATE OR REPLACE FUNCTION chronelle_relation_compatible(source_type text, relation_type text, target_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE relation_type
    WHEN 'includes' THEN
      source_type = 'event' AND target_type IN ('event', 'task', 'expense', 'reminder', 'document', 'person')
    WHEN 'reminds_about' THEN
      source_type = 'reminder' AND target_type IN ('event', 'task')
    WHEN 'attached_to' THEN
      source_type = 'document' AND target_type IN ('event', 'task', 'expense')
    WHEN 'related_to' THEN true
    ELSE false
  END;
$$;
