-- Sections split an Event's To-dos and Expenses views into named groups.
-- A section is a vocabulary of the Event the way labels are of the
-- workspace: not a canonical object, not versioned, not in Trash. It is
-- created, edited, moved, and deleted by whoever may edit the Event through
-- the chronelle_section_* functions; deleting one leaves its records loose.
-- A Task or Expense carries at most one section, and only a section of the
-- matching view of the Event it belongs to.
CREATE TABLE sections (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  view text NOT NULL,
  name text NOT NULL,
  description text,
  rank text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT sections_view CHECK (view IN ('todos', 'expenses')),
  CONSTRAINT sections_name_length CHECK (length(name) BETWEEN 1 AND 120),
  CONSTRAINT sections_name_trimmed CHECK (name = btrim(name)),
  CONSTRAINT sections_description_length CHECK (description IS NULL OR length(description) BETWEEN 1 AND 2000),
  CONSTRAINT sections_description_trimmed CHECK (description IS NULL OR description = btrim(description)),
  CONSTRAINT sections_rank_valid CHECK (rank ~ '^[0-9]{11}(\.[0-9]*[1-9])?$')
);
CREATE INDEX sections_event_view_idx ON sections (workspace_id, event_id, view, rank, id);

ALTER TABLE tasks ADD COLUMN section_id uuid REFERENCES sections(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN section_id uuid REFERENCES sections(id) ON DELETE SET NULL;
CREATE INDEX tasks_section_idx ON tasks (section_id) WHERE section_id IS NOT NULL;
CREATE INDEX expenses_section_idx ON expenses (section_id) WHERE section_id IS NOT NULL;

-- The section row as the API serializes it.
CREATE FUNCTION chronelle_section_serialize(section sections)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'id', section.id::text,
    'workspaceId', section.workspace_id::text,
    'eventId', section.event_id::text,
    'view', section.view,
    'name', section.name,
    'description', section.description,
    'rank', section.rank,
    'createdAt', chronelle_iso(section.created_at),
    'updatedAt', chronelle_iso(section.updated_at)
  );
$$;

CREATE FUNCTION chronelle_assert_section_view(view text)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF view IS NULL OR view NOT IN ('todos', 'expenses') THEN
    RAISE EXCEPTION 'view is todos or expenses.' USING ERRCODE = 'PT422';
  END IF;
END
$$;

-- The service's assertSectionName(), with the same message.
CREATE FUNCTION chronelle_assert_section_name(name text)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF name IS NULL OR name <> btrim(name) OR length(name) < 1 OR length(name) > 120 THEN
    RAISE EXCEPTION 'A section name is 1 to 120 characters without surrounding spaces.' USING ERRCODE = 'PT422';
  END IF;
END
$$;

-- A rank between two neighbours: rankBetween() in the shared package. The
-- midpoint of two decimals at whatever precision separates them; a null
-- before means the start and a null after the end.
CREATE FUNCTION chronelle_rank_between(before text, after text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  low text;
  scale integer;
  midpoint numeric;
  digits text;
  decimals text;
BEGIN
  IF before IS NULL AND after IS NULL THEN
    RETURN '00000001000';
  END IF;
  IF after IS NULL THEN
    RETURN lpad((split_part(before, '.', 1)::bigint + 1000)::text, 11, '0');
  END IF;
  IF before IS NOT NULL AND before >= after THEN
    RAISE EXCEPTION 'Ranks must be in order.' USING ERRCODE = 'PT422';
  END IF;
  low := COALESCE(before, '00000000000');
  scale := greatest(length(split_part(low, '.', 2)), length(split_part(after, '.', 2))) + 1;
  midpoint := div(
    (split_part(low, '.', 1) || rpad(split_part(low, '.', 2), scale, '0'))::numeric
      + (split_part(after, '.', 1) || rpad(split_part(after, '.', 2), scale, '0'))::numeric,
    2
  );
  digits := lpad(midpoint::text, 11 + scale, '0');
  decimals := rtrim(right(digits, scale), '0');
  RETURN CASE WHEN decimals = '' THEN left(digits, length(digits) - scale)
    ELSE left(digits, length(digits) - scale) || '.' || decimals END;
END
$$;

-- The rank a section takes at a place among its siblings: after the named
-- section, first when after is null, or last when no place is given.
-- The moving section itself never counts as a neighbour.
CREATE FUNCTION chronelle_section_rank_at(workspace_id uuid, event_id uuid, view text, section_id uuid, placement jsonb)
RETURNS text LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  after_id uuid;
  before_rank text;
  after_rank text;
BEGIN
  IF placement IS NULL OR NOT placement ? 'afterSectionId' THEN
    SELECT s.rank INTO before_rank FROM sections s
    WHERE s.workspace_id = workspace_id AND s.event_id = event_id AND s.view = view
      AND (section_id IS NULL OR s.id <> section_id)
    ORDER BY s.rank DESC, s.id DESC LIMIT 1;
    RETURN chronelle_rank_between(before_rank, NULL);
  END IF;
  after_id := (placement ->> 'afterSectionId')::uuid;
  IF after_id IS NOT NULL THEN
    SELECT s.rank INTO before_rank FROM sections s
    WHERE s.workspace_id = workspace_id AND s.event_id = event_id AND s.view = view AND s.id = after_id
      AND (section_id IS NULL OR s.id <> section_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'afterSectionId must name another section of this view.' USING ERRCODE = 'PT422';
    END IF;
  END IF;
  SELECT s.rank INTO after_rank FROM sections s
  WHERE s.workspace_id = workspace_id AND s.event_id = event_id AND s.view = view
    AND (section_id IS NULL OR s.id <> section_id)
    AND (before_rank IS NULL OR s.rank > before_rank OR (s.rank = before_rank AND s.id > after_id))
  ORDER BY s.rank ASC, s.id ASC LIMIT 1;
  RETURN chronelle_rank_between(before_rank, after_rank);
END
$$;

CREATE FUNCTION chronelle_section_create(workspace_id uuid, user_id uuid, event_id uuid, input jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  view text := input ->> 'view';
  name text := input ->> 'name';
  description text := input ->> 'description';
  created sections%ROWTYPE;
BEGIN
  IF NOT chronelle_can_edit(workspace_id, user_id, event_id) OR NOT EXISTS (
    SELECT 1 FROM objects o
    WHERE o.workspace_id = workspace_id AND o.id = event_id AND o.object_type = 'event' AND o.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  PERFORM chronelle_assert_section_view(view);
  PERFORM chronelle_assert_section_name(name);
  PERFORM chronelle_assert_description(description);
  -- Siblings are locked so two placements never compute the same neighbours.
  PERFORM 1 FROM sections s
  WHERE s.workspace_id = workspace_id AND s.event_id = event_id AND s.view = view FOR UPDATE;
  INSERT INTO sections (id, workspace_id, event_id, view, name, description, rank, created_by)
  VALUES (chronelle_uuidv7(), workspace_id, event_id, view, name, description,
    chronelle_section_rank_at(workspace_id, event_id, view, NULL, input), user_id)
  RETURNING * INTO created;
  RETURN chronelle_section_serialize(created);
END
$$;

CREATE FUNCTION chronelle_section_update(workspace_id uuid, user_id uuid, section_id uuid, changes jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  current_section sections%ROWTYPE;
BEGIN
  SELECT * INTO current_section FROM sections s
  WHERE s.workspace_id = workspace_id AND s.id = section_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT404';
  END IF;
  IF NOT chronelle_can_edit(workspace_id, user_id, current_section.event_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF changes ? 'name' THEN
    PERFORM chronelle_assert_section_name(changes ->> 'name');
  END IF;
  IF changes ? 'description' THEN
    PERFORM chronelle_assert_description(changes ->> 'description');
  END IF;
  IF changes ? 'afterSectionId' THEN
    PERFORM 1 FROM sections s
    WHERE s.workspace_id = workspace_id AND s.event_id = current_section.event_id AND s.view = current_section.view
      AND s.id <> section_id FOR UPDATE;
  END IF;
  UPDATE sections s
  SET name = CASE WHEN changes ? 'name' THEN changes ->> 'name' ELSE s.name END,
      description = CASE WHEN changes ? 'description' THEN changes ->> 'description' ELSE s.description END,
      rank = CASE WHEN changes ? 'afterSectionId'
        THEN chronelle_section_rank_at(workspace_id, s.event_id, s.view, s.id, changes)
        ELSE s.rank END,
      updated_at = now()
  WHERE s.id = section_id
  RETURNING * INTO current_section;
  RETURN chronelle_section_serialize(current_section);
END
$$;

-- Deleting a section leaves its records in the view without a section.
CREATE FUNCTION chronelle_section_delete(workspace_id uuid, user_id uuid, section_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  current_section sections%ROWTYPE;
BEGIN
  SELECT * INTO current_section FROM sections s
  WHERE s.workspace_id = workspace_id AND s.id = section_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT404';
  END IF;
  IF NOT chronelle_can_edit(workspace_id, user_id, current_section.event_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  DELETE FROM sections s WHERE s.id = section_id;
  RETURN chronelle_section_serialize(current_section);
END
$$;

-- The sections of one view of an Event in their order, for a viewer of the Event.
CREATE FUNCTION chronelle_section_list(workspace_id uuid, user_id uuid, event_id uuid, view text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
BEGIN
  IF NOT chronelle_can_view(workspace_id, user_id, event_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  PERFORM chronelle_assert_section_view(view);
  RETURN COALESCE((
    SELECT jsonb_agg(chronelle_section_serialize(s) ORDER BY s.rank, s.id)
    FROM sections s
    WHERE s.workspace_id = workspace_id AND s.event_id = event_id AND s.view = view
  ), '[]'::jsonb);
END
$$;

-- A record may carry a section only of the given view of the Event whose
-- scope it inherits; a self-scoped record belongs to no Event's view.
CREATE FUNCTION chronelle_assert_section_member(workspace_id uuid, object_id uuid, section_id uuid, view text)
RETURNS void LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
BEGIN
  IF section_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sections s
    JOIN objects o ON o.workspace_id = s.workspace_id AND o.id = object_id
    WHERE s.workspace_id = workspace_id AND s.id = section_id AND s.view = view
      AND s.event_id = o.permission_scope_id AND o.permission_scope_id <> o.id
  ) THEN
    RAISE EXCEPTION 'sectionId must name a section of this view of the record''s Event.' USING ERRCODE = 'PT422';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION chronelle_task_serialize(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT chronelle_serialize_object($1, $2) || jsonb_build_object(
    'objectType', 'task',
    'status', t.status,
    'dueOn', t.due_on::text,
    'dueAt', chronelle_iso(t.due_at),
    'durationMinutes', t.duration_minutes,
    'repeatRule', t.repeat_rule,
    'repeatUntil', t.repeat_until::text,
    'completedAt', chronelle_iso(t.completed_at),
    'parentTaskId', t.parent_task_id::text,
    'assigneeId', t.assignee_person_id::text,
    'location', t.location,
    'description', t.description,
    'rank', t.rank,
    'sectionId', t.section_id::text,
    'labelIds', chronelle_task_label_ids($1, $2)
  )
  FROM tasks t
  WHERE t.workspace_id = $1 AND t.object_id = $2;
$$;

CREATE OR REPLACE FUNCTION chronelle_task_insert(workspace_id uuid, object_id uuid, input jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  status text := COALESCE(input ->> 'status', 'todo');
  due_on date := chronelle_calendar_date(input -> 'dueOn');
  due_at timestamptz := chronelle_instant(input -> 'dueAt', 'dueAt');
  duration_minutes integer := (input ->> 'durationMinutes')::integer;
  repeat_rule text := input ->> 'repeatRule';
  repeat_until date := chronelle_calendar_date(input -> 'repeatUntil');
  completed_at timestamptz := chronelle_instant(input -> 'completedAt', 'completedAt');
  parent_task_id uuid := (input ->> 'parentTaskId')::uuid;
  assignee_person_id uuid := (input ->> 'assigneeId')::uuid;
  location text := input ->> 'location';
  description text := input ->> 'description';
  rank text := COALESCE(input ->> 'rank', chronelle_next_task_rank(workspace_id));
  section_id uuid := (input ->> 'sectionId')::uuid;
  scope_id uuid;
BEGIN
  PERFORM chronelle_assert_task_state(status, due_on, due_at, completed_at);
  PERFORM chronelle_assert_task_duration(due_at, duration_minutes);
  PERFORM chronelle_assert_task_repeat(due_on, due_at, repeat_rule, repeat_until);
  PERFORM chronelle_assert_task_location(location);
  PERFORM chronelle_assert_description(description);
  PERFORM chronelle_assert_rank(rank);
  SELECT o.permission_scope_id INTO scope_id FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = object_id;
  PERFORM chronelle_assert_task_parent(workspace_id, object_id, parent_task_id, scope_id);
  PERFORM chronelle_assert_task_assignee(workspace_id, assignee_person_id);
  PERFORM chronelle_assert_section_member(workspace_id, object_id, section_id, 'todos');
  INSERT INTO tasks (object_id, workspace_id, status, due_on, due_at, duration_minutes, repeat_rule, repeat_until, completed_at, parent_task_id, assignee_person_id, location, description, rank, section_id)
  VALUES (object_id, workspace_id, status, due_on, due_at, duration_minutes, repeat_rule, repeat_until, completed_at, parent_task_id, assignee_person_id, location, description, rank, section_id);
  IF input ? 'labelIds' THEN
    PERFORM chronelle_task_set_labels(workspace_id, object_id, input -> 'labelIds');
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION chronelle_task_validate(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  current_task tasks%ROWTYPE;
  next_due_on date;
  next_due_at timestamptz;
  scope_id uuid;
BEGIN
  SELECT * INTO current_task FROM tasks t
  WHERE t.workspace_id = workspace_id AND t.object_id = object_id;
  next_due_on := CASE WHEN changes ? 'dueOn' THEN chronelle_calendar_date(changes -> 'dueOn') ELSE current_task.due_on END;
  next_due_at := CASE WHEN changes ? 'dueAt' THEN chronelle_instant(changes -> 'dueAt', 'dueAt') ELSE current_task.due_at END;
  PERFORM chronelle_assert_task_state(
    COALESCE(changes ->> 'status', current_task.status),
    next_due_on,
    next_due_at,
    CASE WHEN changes ? 'completedAt' THEN chronelle_instant(changes -> 'completedAt', 'completedAt') ELSE current_task.completed_at END
  );
  PERFORM chronelle_assert_task_duration(
    next_due_at,
    CASE WHEN changes ? 'durationMinutes' THEN (changes ->> 'durationMinutes')::integer ELSE current_task.duration_minutes END
  );
  -- Clearing the rule clears its end, as apply does.
  PERFORM chronelle_assert_task_repeat(
    next_due_on,
    next_due_at,
    CASE WHEN changes ? 'repeatRule' THEN changes ->> 'repeatRule' ELSE current_task.repeat_rule END,
    CASE
      WHEN changes ? 'repeatRule' AND changes ->> 'repeatRule' IS NULL THEN NULL
      WHEN changes ? 'repeatUntil' THEN chronelle_calendar_date(changes -> 'repeatUntil')
      ELSE current_task.repeat_until END
  );
  IF changes ? 'rank' THEN
    PERFORM chronelle_assert_rank(changes ->> 'rank');
  END IF;
  IF changes ? 'parentTaskId' AND (changes ->> 'parentTaskId')::uuid IS DISTINCT FROM current_task.parent_task_id THEN
    SELECT o.permission_scope_id INTO scope_id FROM objects o
    WHERE o.workspace_id = workspace_id AND o.id = object_id;
    PERFORM chronelle_assert_task_parent(workspace_id, object_id, (changes ->> 'parentTaskId')::uuid, scope_id);
  END IF;
  IF changes ? 'assigneeId' AND (changes ->> 'assigneeId')::uuid IS DISTINCT FROM current_task.assignee_person_id THEN
    PERFORM chronelle_assert_task_assignee(workspace_id, (changes ->> 'assigneeId')::uuid);
  END IF;
  IF changes ? 'location' THEN
    PERFORM chronelle_assert_task_location(changes ->> 'location');
  END IF;
  IF changes ? 'description' THEN
    PERFORM chronelle_assert_description(changes ->> 'description');
  END IF;
  IF changes ? 'sectionId' THEN
    PERFORM chronelle_assert_section_member(workspace_id, object_id, (changes ->> 'sectionId')::uuid, 'todos');
  END IF;
END
$$;

-- Apply also serves a revision restore, which never carries a rank or a section.
CREATE OR REPLACE FUNCTION chronelle_task_apply(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  next_due_on date;
  next_due_at timestamptz;
BEGIN
  SELECT
    CASE WHEN changes ? 'dueOn' THEN chronelle_calendar_date(changes -> 'dueOn') ELSE t.due_on END,
    CASE WHEN changes ? 'dueAt' THEN chronelle_instant(changes -> 'dueAt', 'dueAt') ELSE t.due_at END
  INTO next_due_on, next_due_at
  FROM tasks t WHERE t.workspace_id = workspace_id AND t.object_id = object_id;
  UPDATE tasks t
  SET status = COALESCE(changes ->> 'status', t.status),
      due_on = next_due_on,
      due_at = next_due_at,
      duration_minutes = CASE
        WHEN next_due_at IS NULL THEN NULL
        WHEN changes ? 'durationMinutes' THEN (changes ->> 'durationMinutes')::integer
        ELSE t.duration_minutes END,
      repeat_rule = CASE
        WHEN next_due_on IS NULL AND next_due_at IS NULL THEN NULL
        WHEN changes ? 'repeatRule' THEN changes ->> 'repeatRule'
        ELSE t.repeat_rule END,
      repeat_until = CASE
        WHEN next_due_on IS NULL AND next_due_at IS NULL THEN NULL
        WHEN changes ? 'repeatRule' AND changes ->> 'repeatRule' IS NULL THEN NULL
        WHEN changes ? 'repeatUntil' THEN chronelle_calendar_date(changes -> 'repeatUntil')
        ELSE t.repeat_until END,
      completed_at = CASE WHEN changes ? 'completedAt' THEN chronelle_instant(changes -> 'completedAt', 'completedAt') ELSE t.completed_at END,
      parent_task_id = CASE WHEN changes ? 'parentTaskId' THEN (changes ->> 'parentTaskId')::uuid ELSE t.parent_task_id END,
      assignee_person_id = CASE WHEN changes ? 'assigneeId' THEN (changes ->> 'assigneeId')::uuid ELSE t.assignee_person_id END,
      location = CASE WHEN changes ? 'location' THEN changes ->> 'location' ELSE t.location END,
      description = CASE WHEN changes ? 'description' THEN changes ->> 'description' ELSE t.description END,
      rank = CASE WHEN changes ? 'rank' THEN changes ->> 'rank' ELSE t.rank END,
      section_id = CASE WHEN changes ? 'sectionId' THEN (changes ->> 'sectionId')::uuid ELSE t.section_id END
  WHERE t.workspace_id = workspace_id AND t.object_id = object_id;
  IF changes ? 'labelIds' THEN
    PERFORM chronelle_task_set_labels(workspace_id, object_id, changes -> 'labelIds');
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION chronelle_expense_serialize(workspace_id uuid, object_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT chronelle_serialize_object($1, $2) || jsonb_build_object(
    'objectType', 'expense',
    'amount', e.amount::text,
    'currency', e.currency,
    'occurredAt', chronelle_iso(e.occurred_at),
    'sectionId', e.section_id::text
  )
  FROM expenses e
  WHERE e.workspace_id = $1 AND e.object_id = $2;
$$;

CREATE OR REPLACE FUNCTION chronelle_expense_insert(workspace_id uuid, object_id uuid, input jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  amount text := input ->> 'amount';
  currency text := input ->> 'currency';
  occurred_at timestamptz := chronelle_instant(input -> 'occurredAt', 'occurredAt');
  section_id uuid := (input ->> 'sectionId')::uuid;
BEGIN
  PERFORM chronelle_assert_expense_state(amount, currency, occurred_at);
  PERFORM chronelle_assert_section_member(workspace_id, object_id, section_id, 'expenses');
  INSERT INTO expenses (object_id, workspace_id, amount, currency, occurred_at, section_id)
  VALUES (object_id, workspace_id, amount::numeric, currency, occurred_at, section_id);
END
$$;

CREATE OR REPLACE FUNCTION chronelle_expense_validate(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  current_expense expenses%ROWTYPE;
BEGIN
  SELECT * INTO current_expense FROM expenses e
  WHERE e.workspace_id = workspace_id AND e.object_id = object_id;
  PERFORM chronelle_assert_expense_state(
    COALESCE(changes ->> 'amount', current_expense.amount::text),
    COALESCE(changes ->> 'currency', current_expense.currency),
    COALESCE(chronelle_instant(changes -> 'occurredAt', 'occurredAt'), current_expense.occurred_at)
  );
  IF changes ? 'sectionId' THEN
    PERFORM chronelle_assert_section_member(workspace_id, object_id, (changes ->> 'sectionId')::uuid, 'expenses');
  END IF;
END
$$;

-- Apply also serves a revision restore, which never carries a section.
CREATE OR REPLACE FUNCTION chronelle_expense_apply(workspace_id uuid, object_id uuid, changes jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
BEGIN
  UPDATE expenses e
  SET amount = COALESCE((changes ->> 'amount')::numeric, e.amount),
      currency = COALESCE(changes ->> 'currency', e.currency),
      occurred_at = COALESCE(chronelle_instant(changes -> 'occurredAt', 'occurredAt'), e.occurred_at),
      section_id = CASE WHEN changes ? 'sectionId' THEN (changes ->> 'sectionId')::uuid ELSE e.section_id END
  WHERE e.workspace_id = workspace_id AND e.object_id = object_id;
END
$$;
