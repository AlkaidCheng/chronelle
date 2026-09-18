-- What is shared each way with one person, for the person's page: the live
-- grants the caller's workspace holds for the person's account ("you
-- shared"), the shares queued for the person while an invitation waits,
-- and the live grants the person's account gave the caller ("they shared").
-- Each item names the record (id, type, name), the role, the direction, and
-- when it was granted or queued; expired grants and records in Trash are
-- left out. The person's account is the linked one, else the one account
-- with the person's email, as chronelle_resource_share resolves a person
-- grantee; a person without an account has queued shares only. The caller
-- must be a member of the workspace who can view the person: what the
-- workspace shared is the workspace's to see, not a guest's.
CREATE FUNCTION chronelle_person_shares_list(workspace_id uuid, user_id uuid, person_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  person persons%ROWTYPE;
  account uuid;
  items jsonb;
BEGIN
  SELECT * INTO person FROM persons p WHERE p.workspace_id = workspace_id AND p.object_id = person_id;
  IF NOT FOUND
     OR NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = workspace_id AND m.user_id = user_id)
     OR NOT chronelle_can_view(workspace_id, user_id, person_id) THEN
    RAISE EXCEPTION 'The person is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  account := person.user_id;
  IF account IS NULL AND person.email IS NOT NULL
     AND (SELECT count(*) FROM users u WHERE u.email = lower(person.email)) = 1 THEN
    SELECT u.id INTO account FROM users u WHERE u.email = lower(person.email);
  END IF;
  SELECT COALESCE(jsonb_agg(item ORDER BY item->>'createdAt' DESC, item->>'id'), '[]'::jsonb) INTO items
  FROM (
    SELECT jsonb_build_object(
      'id', g.id::text, 'kind', 'grant', 'direction', 'outgoing',
      'resourceId', o.id::text, 'objectType', o.object_type, 'displayName', o.display_name,
      'role', g.role, 'createdAt', chronelle_iso(g.created_at)
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
      'role', p.role, 'createdAt', chronelle_iso(p.created_at)
    ) AS item
    FROM pending_shares p
    JOIN objects o ON o.workspace_id = p.workspace_id AND o.id = p.resource_id
    WHERE p.workspace_id = workspace_id AND p.person_id = person_id AND p.status = 'pending'
      AND o.deleted_at IS NULL
    UNION ALL
    SELECT jsonb_build_object(
      'id', g.id::text, 'kind', 'grant', 'direction', 'incoming',
      'resourceId', o.id::text, 'objectType', o.object_type, 'displayName', o.display_name,
      'role', g.role, 'createdAt', chronelle_iso(g.created_at)
    ) AS item
    FROM resource_grants g
    JOIN objects o ON o.workspace_id = g.workspace_id AND o.id = g.resource_id
    WHERE account IS NOT NULL
      AND g.principal_type = 'user' AND g.principal_id = user_id AND g.granted_by = account
      AND (g.expires_at IS NULL OR g.expires_at > now())
      AND o.deleted_at IS NULL
  ) shared;
  RETURN jsonb_build_object('items', items);
END
$$;
