-- A grant on an Event can be narrowed to one of the Event's views (To-dos,
-- Calendar, Itinerary, Expenses, Reminders, Notes) or to one section of
-- To-dos or Expenses. The narrowing lives on the grant: `scope` names the
-- view ('all' is the whole Event, as every grant was before), and
-- `section_id` names the section when the grant is narrower still. A
-- narrowed grant lets its holder open the Event (view alone on the Event
-- itself) and gives them the granted role on the records the view shows,
-- or on the section's records; it gives nothing on the other views. The
-- person may hold one grant per scope on the Event, so To-dos and
-- Expenses can be shared with the same person at different roles; the
-- whole-Event grant stands on its own. Deleting a section ends the grants
-- narrowed to it. Every SQL decision (chronelle_can_*, the held role) and
-- the application's evaluators apply the same rule.
ALTER TABLE resource_grants
  ADD COLUMN scope text NOT NULL DEFAULT 'all',
  ADD COLUMN section_id uuid REFERENCES sections(id) ON DELETE CASCADE,
  ADD COLUMN scope_key text GENERATED ALWAYS AS (scope || ':' || COALESCE(section_id::text, '')) STORED,
  ADD CONSTRAINT resource_grants_scope_valid
    CHECK (scope IN ('all', 'todos', 'calendar', 'itinerary', 'expenses', 'reminders', 'notes')),
  ADD CONSTRAINT resource_grants_section_scope
    CHECK (section_id IS NULL OR scope IN ('todos', 'expenses'));

ALTER TABLE resource_grants DROP CONSTRAINT resource_grants_principal_unique;
ALTER TABLE resource_grants
  ADD CONSTRAINT resource_grants_principal_unique
    UNIQUE (workspace_id, resource_id, principal_type, principal_id, scope_key);

CREATE INDEX resource_grants_section_idx ON resource_grants (section_id) WHERE section_id IS NOT NULL;

-- A narrowed grant names an Event, and its section belongs to that Event's
-- view of the same name.
CREATE FUNCTION chronelle_resource_grant_scope_check()
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
    WHERE s.id = NEW.section_id AND s.workspace_id = NEW.workspace_id
      AND s.event_id = NEW.resource_id AND s.view = NEW.scope
  ) THEN
    RAISE EXCEPTION 'The section is not a section of that view of the Event.' USING ERRCODE = 'PT422';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER resource_grants_scope_matches
  BEFORE INSERT OR UPDATE ON resource_grants
  FOR EACH ROW EXECUTE FUNCTION chronelle_resource_grant_scope_check();

-- Whether a grant's narrowing admits a record reached through the Event's
-- scope: a whole grant admits everything; a view admits the records it
-- shows (tasks for To-dos, schedule items for Calendar and Itinerary,
-- expenses, reminders, notes); a section admits its own tasks or expenses.
CREATE FUNCTION chronelle_grant_admits(scope text, section_id uuid, object_id uuid, object_type text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN $1 = 'all' THEN true
    WHEN $1 = 'todos' THEN $4 = 'task'
      AND ($2 IS NULL OR EXISTS (SELECT 1 FROM tasks t WHERE t.object_id = $3 AND t.section_id = $2))
    WHEN $1 = 'expenses' THEN $4 = 'expense'
      AND ($2 IS NULL OR EXISTS (SELECT 1 FROM expenses e WHERE e.object_id = $3 AND e.section_id = $2))
    WHEN $1 IN ('calendar', 'itinerary') THEN $4 = 'event'
    WHEN $1 = 'reminders' THEN $4 = 'reminder'
    WHEN $1 = 'notes' THEN $4 = 'note'
    ELSE false
  END;
$$;

-- View through membership, a grant on the object (narrowed or not: the
-- Event page opens), or a grant on the object's live scope that admits it.
CREATE OR REPLACE FUNCTION chronelle_can_view(workspace_id uuid, user_id uuid, object_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM objects o
    WHERE o.workspace_id = $1 AND o.id = $3 AND o.deleted_at IS NULL
      AND (
        EXISTS (
          SELECT 1 FROM workspace_members m
          WHERE m.workspace_id = $1 AND m.user_id = $2
        ) OR EXISTS (
          SELECT 1 FROM resource_grants g
          WHERE g.workspace_id = $1
            AND g.principal_type = 'user'
            AND g.principal_id = $2
            AND (g.expires_at IS NULL OR g.expires_at > now())
            AND g.resource_id = o.id
        ) OR EXISTS (
          SELECT 1 FROM resource_grants g
          JOIN objects scope ON scope.workspace_id = g.workspace_id AND scope.id = g.resource_id
          WHERE g.workspace_id = $1
            AND g.principal_type = 'user'
            AND g.principal_id = $2
            AND (g.expires_at IS NULL OR g.expires_at > now())
            AND g.resource_id = o.permission_scope_id
            AND scope.deleted_at IS NULL
            AND chronelle_grant_admits(g.scope, g.section_id, o.id, o.object_type)
        )
      )
  );
$$;

-- Edit through membership, a whole owner/editor grant on the object, or an
-- owner/editor grant on the object's scope that admits it.
CREATE OR REPLACE FUNCTION chronelle_can_edit(workspace_id uuid, user_id uuid, object_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM objects o WHERE o.workspace_id = $1 AND o.id = $3)
  AND (
    EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.role IN ('owner', 'editor')
    ) OR EXISTS (
      SELECT 1
      FROM resource_grants g
      JOIN objects o ON o.workspace_id = g.workspace_id AND o.id = $3
      WHERE g.workspace_id = $1
        AND g.principal_type = 'user'
        AND g.principal_id = $2
        AND g.role IN ('owner', 'editor')
        AND (g.expires_at IS NULL OR g.expires_at > now())
        AND (
          (g.resource_id = o.id AND g.scope = 'all')
          OR (g.resource_id = o.permission_scope_id
              AND chronelle_grant_admits(g.scope, g.section_id, o.id, o.object_type))
        )
    )
  );
$$;

CREATE OR REPLACE FUNCTION chronelle_can_edit_live(workspace_id uuid, user_id uuid, object_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM objects o
    WHERE o.workspace_id = $1 AND o.id = $3 AND o.deleted_at IS NULL
      AND (
        EXISTS (
          SELECT 1 FROM workspace_members m
          WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.role IN ('owner', 'editor')
        ) OR EXISTS (
          SELECT 1 FROM resource_grants g
          WHERE g.workspace_id = $1
            AND g.principal_type = 'user'
            AND g.principal_id = $2
            AND g.role IN ('owner', 'editor')
            AND (g.expires_at IS NULL OR g.expires_at > now())
            AND g.resource_id = o.id
            AND g.scope = 'all'
        ) OR EXISTS (
          SELECT 1 FROM resource_grants g
          JOIN objects scope ON scope.workspace_id = g.workspace_id AND scope.id = g.resource_id
          WHERE g.workspace_id = $1
            AND g.principal_type = 'user'
            AND g.principal_id = $2
            AND g.role IN ('owner', 'editor')
            AND (g.expires_at IS NULL OR g.expires_at > now())
            AND g.resource_id = o.permission_scope_id
            AND scope.deleted_at IS NULL
            AND chronelle_grant_admits(g.scope, g.section_id, o.id, o.object_type)
        )
      )
  );
$$;

-- Delete, share, and recover are Owner actions on the whole: a narrowed
-- owner grant reaches the records it admits, never the Event itself.
CREATE OR REPLACE FUNCTION chronelle_can_delete(workspace_id uuid, user_id uuid, object_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM objects o
    WHERE o.workspace_id = $1 AND o.id = $3 AND o.deleted_at IS NULL
      AND (
        EXISTS (
          SELECT 1 FROM workspace_members m
          WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.role = 'owner'
        ) OR EXISTS (
          SELECT 1 FROM resource_grants g
          WHERE g.workspace_id = $1
            AND g.principal_type = 'user'
            AND g.principal_id = $2
            AND g.role = 'owner'
            AND (g.expires_at IS NULL OR g.expires_at > now())
            AND g.resource_id = o.id
            AND g.scope = 'all'
        ) OR EXISTS (
          SELECT 1 FROM resource_grants g
          JOIN objects scope ON scope.workspace_id = g.workspace_id AND scope.id = g.resource_id
          WHERE g.workspace_id = $1
            AND g.principal_type = 'user'
            AND g.principal_id = $2
            AND g.role = 'owner'
            AND (g.expires_at IS NULL OR g.expires_at > now())
            AND g.resource_id = o.permission_scope_id
            AND scope.deleted_at IS NULL
            AND chronelle_grant_admits(g.scope, g.section_id, o.id, o.object_type)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION chronelle_can_recover(workspace_id uuid, user_id uuid, object_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM objects o
    WHERE o.workspace_id = $1 AND o.id = $3
      AND (
        EXISTS (
          SELECT 1 FROM workspace_members m
          WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.role = 'owner'
        ) OR EXISTS (
          SELECT 1 FROM resource_grants g
          WHERE g.workspace_id = $1
            AND g.principal_type = 'user'
            AND g.principal_id = $2
            AND g.role = 'owner'
            AND (g.expires_at IS NULL OR g.expires_at > now())
            AND (
              (g.resource_id = o.id AND g.scope = 'all')
              OR (g.resource_id = o.permission_scope_id
                  AND chronelle_grant_admits(g.scope, g.section_id, o.id, o.object_type))
            )
        )
      )
  );
$$;

-- The role held on an object: a narrowed grant on the object itself
-- holds view alone there (the Event page opens), and its role on the
-- records it admits.
CREATE OR REPLACE FUNCTION chronelle_held_role(workspace_id uuid, user_id uuid, object_id uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT held.role FROM (
    SELECT m.role FROM workspace_members m
    WHERE m.workspace_id = $1 AND m.user_id = $2
    UNION ALL
    SELECT CASE WHEN g.scope = 'all' THEN g.role ELSE 'viewer' END AS role FROM resource_grants g
    WHERE g.workspace_id = $1 AND g.principal_type = 'user' AND g.principal_id = $2
      AND (g.expires_at IS NULL OR g.expires_at > now()) AND g.resource_id = $3
    UNION ALL
    SELECT g.role FROM resource_grants g
    JOIN objects o ON o.workspace_id = $1 AND o.id = $3
    JOIN objects scope ON scope.workspace_id = g.workspace_id AND scope.id = g.resource_id
    WHERE g.workspace_id = $1 AND g.principal_type = 'user' AND g.principal_id = $2
      AND (g.expires_at IS NULL OR g.expires_at > now())
      AND g.resource_id = o.permission_scope_id AND scope.deleted_at IS NULL
      AND chronelle_grant_admits(g.scope, g.section_id, o.id, o.object_type)
  ) held
  ORDER BY chronelle_role_rank(held.role) DESC
  LIMIT 1;
$$;

-- The grant as the API reads it, with the narrowing as `scope`: null for
-- the whole, else the view and the section.
CREATE FUNCTION chronelle_grant_scope_json(scope text, section_id uuid)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN $1 = 'all' THEN 'null'::jsonb
    ELSE jsonb_build_object('view', $1, 'sectionId', $2::text)
  END;
$$;

-- ResourceGrantService.share(): the grantee is named by email, by a
-- Person, by a friend, or by the id of an account that already holds a
-- grant on the resource (the share sheet changing a role). The share is
-- narrowed to a view with `scope`, and to one of the view's sections with
-- `section_id`; the Event must be the resource then. One grant per
-- (resource, principal, scope), refreshed in place.
DROP FUNCTION chronelle_resource_share(uuid, uuid, uuid, uuid, text, text, uuid, uuid);
CREATE FUNCTION chronelle_resource_share(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  resource_id uuid,
  role text,
  principal_email text DEFAULT NULL,
  person_id uuid DEFAULT NULL,
  friend_id uuid DEFAULT NULL,
  principal_id uuid DEFAULT NULL,
  scope text DEFAULT NULL,
  section_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  connection user_connections%ROWTYPE;
  principal users%ROWTYPE;
  principal_count integer;
  grant_row resource_grants%ROWTYPE;
  grant_scope text := COALESCE(scope, 'all');
  named integer := (principal_email IS NOT NULL)::integer + (person_id IS NOT NULL)::integer
    + (friend_id IS NOT NULL)::integer + (principal_id IS NOT NULL)::integer;
BEGIN
  IF NOT chronelle_can_share(workspace_id, user_id, resource_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF named <> 1 THEN
    RAISE EXCEPTION 'Name exactly one of principalEmail, personId, friendId, and principalId.' USING ERRCODE = 'PT400';
  END IF;
  IF grant_scope NOT IN ('all', 'todos', 'calendar', 'itinerary', 'expenses', 'reminders', 'notes') THEN
    RAISE EXCEPTION 'scope names a view of the Event.' USING ERRCODE = 'PT422';
  END IF;
  IF grant_scope <> 'all' AND NOT EXISTS (
    SELECT 1 FROM objects o WHERE o.workspace_id = workspace_id AND o.id = resource_id AND o.object_type = 'event'
  ) THEN
    RAISE EXCEPTION 'A share narrowed to a view names an Event.' USING ERRCODE = 'PT422';
  END IF;
  IF section_id IS NOT NULL AND (grant_scope NOT IN ('todos', 'expenses') OR NOT EXISTS (
    SELECT 1 FROM sections s
    WHERE s.id = section_id AND s.workspace_id = workspace_id AND s.event_id = resource_id AND s.view = grant_scope
  )) THEN
    RAISE EXCEPTION 'The section is not a section of that view of the Event.' USING ERRCODE = 'PT422';
  END IF;
  IF friend_id IS NOT NULL THEN
    SELECT c.* INTO connection FROM user_connections c
    WHERE c.id = friend_id AND c.status = 'accepted'
      AND (c.requester_id = user_id OR c.addressee_id = user_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The requested user is unavailable.' USING ERRCODE = 'PT404';
    END IF;
    SELECT * INTO principal FROM users u
    WHERE u.id = CASE WHEN connection.requester_id = user_id THEN connection.addressee_id ELSE connection.requester_id END;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The requested user is unavailable.' USING ERRCODE = 'PT404';
    END IF;
  ELSIF person_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM persons p
      WHERE p.workspace_id = workspace_id AND p.object_id = person_id
        AND chronelle_can_view(workspace_id, user_id, person_id)
    ) THEN
      RAISE EXCEPTION 'The requested user is unavailable.' USING ERRCODE = 'PT404';
    END IF;
    SELECT * INTO principal FROM users u WHERE u.id = chronelle_person_account(workspace_id, person_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The requested user is unavailable.' USING ERRCODE = 'PT404';
    END IF;
  ELSIF principal_id IS NOT NULL THEN
    SELECT * INTO principal FROM users u
    WHERE u.id = principal_id AND EXISTS (
      SELECT 1 FROM resource_grants g
      WHERE g.workspace_id = workspace_id AND g.resource_id = resource_id
        AND g.principal_type = 'user' AND g.principal_id = u.id
    );
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The requested user is unavailable.' USING ERRCODE = 'PT404';
    END IF;
  ELSE
    SELECT count(*) INTO principal_count FROM users u WHERE u.email = principal_email;
    IF principal_count <> 1 THEN
      RAISE EXCEPTION 'The requested user is unavailable.' USING ERRCODE = 'PT404';
    END IF;
    SELECT * INTO principal FROM users u WHERE u.email = principal_email;
  END IF;
  IF principal.id = user_id THEN
    RAISE EXCEPTION 'A resource cannot be shared with the acting user.' USING ERRCODE = 'PT400';
  END IF;
  IF role NOT IN ('owner', 'editor', 'viewer') THEN
    RAISE EXCEPTION 'role must be owner, editor, or viewer.' USING ERRCODE = 'PT422';
  END IF;

  INSERT INTO resource_grants (id, workspace_id, resource_id, principal_type, principal_id, role, granted_by, scope, section_id)
  VALUES (chronelle_uuidv7(), workspace_id, resource_id, 'user', principal.id, role, user_id, grant_scope, section_id)
  ON CONFLICT ON CONSTRAINT resource_grants_principal_unique
  DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, expires_at = NULL
  RETURNING * INTO grant_row;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), workspace_id, 'user', user_id, 'resource.shared', resource_id, request_id,
          jsonb_build_object('grantId', grant_row.id::text, 'principalId', principal.id::text, 'role', grant_row.role)
            || CASE WHEN person_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('personId', person_id::text) END
            || CASE WHEN friend_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('friendId', friend_id::text) END
            || CASE WHEN grant_row.scope = 'all' THEN '{}'::jsonb ELSE jsonb_build_object('scope', chronelle_grant_scope_json(grant_row.scope, grant_row.section_id)) END);
  RETURN to_jsonb(grant_row) || jsonb_build_object(
    'scope', chronelle_grant_scope_json(grant_row.scope, grant_row.section_id),
    'principal', jsonb_build_object('id', principal.id::text, 'displayName', principal.display_name, 'email', principal.email)
  );
END
$$;

-- What is shared each way with one person, as before, each grant carrying
-- its narrowing.
CREATE OR REPLACE FUNCTION chronelle_person_shares_list(workspace_id uuid, user_id uuid, person_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  account uuid;
  items jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM persons p WHERE p.workspace_id = workspace_id AND p.object_id = person_id)
     OR NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = workspace_id AND m.user_id = user_id)
     OR NOT chronelle_can_view(workspace_id, user_id, person_id) THEN
    RAISE EXCEPTION 'The person is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  account := chronelle_person_account(workspace_id, person_id);
  SELECT COALESCE(jsonb_agg(item ORDER BY item->>'createdAt' DESC, item->>'id'), '[]'::jsonb) INTO items
  FROM (
    SELECT jsonb_build_object(
      'id', g.id::text, 'kind', 'grant', 'direction', 'outgoing',
      'resourceId', o.id::text, 'objectType', o.object_type, 'displayName', o.display_name,
      'role', g.role, 'createdAt', chronelle_iso(g.created_at),
      'scope', chronelle_grant_scope_json(g.scope, g.section_id)
    ) AS item
    FROM resource_grants g
    JOIN objects o ON o.workspace_id = g.workspace_id AND o.id = g.resource_id
    WHERE g.workspace_id = workspace_id
      AND g.principal_type = 'user' AND g.principal_id = account
      AND (g.expires_at IS NULL OR g.expires_at > now())
      AND o.deleted_at IS NULL
    UNION ALL
    SELECT jsonb_build_object(
      'id', p.id::text, 'kind', 'pending', 'direction', 'outgoing',
      'resourceId', o.id::text, 'objectType', o.object_type, 'displayName', o.display_name,
      'role', p.role, 'createdAt', chronelle_iso(p.created_at),
      'scope', 'null'::jsonb
    ) AS item
    FROM pending_shares p
    JOIN objects o ON o.workspace_id = p.workspace_id AND o.id = p.resource_id
    WHERE p.workspace_id = workspace_id AND p.person_id = person_id AND p.status = 'pending'
      AND o.deleted_at IS NULL
    UNION ALL
    SELECT jsonb_build_object(
      'id', g.id::text, 'kind', 'grant', 'direction', 'incoming',
      'resourceId', o.id::text, 'objectType', o.object_type, 'displayName', o.display_name,
      'role', g.role, 'createdAt', chronelle_iso(g.created_at),
      'scope', chronelle_grant_scope_json(g.scope, g.section_id)
    ) AS item
    FROM resource_grants g
    JOIN objects o ON o.workspace_id = g.workspace_id AND o.id = g.resource_id
    WHERE g.principal_type = 'user' AND g.principal_id = user_id
      AND g.granted_by = account
      AND (g.expires_at IS NULL OR g.expires_at > now())
      AND o.deleted_at IS NULL
  ) shared;
  RETURN jsonb_build_object('items', items);
END
$$;

-- Whether an account sees a section of an Event's view: a member or a
-- whole grant sees every section; a grant narrowed to the view sees them
-- all too; otherwise only the sections the account is granted on their own.
CREATE FUNCTION chronelle_section_visible(workspace_id uuid, user_id uuid, section sections)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members m WHERE m.workspace_id = $1 AND m.user_id = $2
  ) OR EXISTS (
    SELECT 1 FROM resource_grants g
    WHERE g.workspace_id = $1 AND g.principal_type = 'user' AND g.principal_id = $2
      AND (g.expires_at IS NULL OR g.expires_at > now())
      AND g.resource_id = ($3).event_id
      AND (g.scope = 'all'
        OR (g.scope = ($3).view AND (g.section_id IS NULL OR g.section_id = ($3).id)))
  );
$$;

-- The sections of a view, those the caller sees.
CREATE OR REPLACE FUNCTION chronelle_section_list(workspace_id uuid, user_id uuid, event_id uuid, view text)
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
      AND chronelle_section_visible(workspace_id, user_id, s)
  ), '[]'::jsonb);
END
$$;
