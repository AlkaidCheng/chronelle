-- Leaving a share: the grantee's own way out of an Event shared with them.
-- The function drops every grant the acting account holds on the resource
-- in the workspace, whatever their narrowing, and records one audit event
-- naming the grants. A member of the workspace holds no grant to give up,
-- and a resource the account holds no grant on reads as unavailable, the
-- same answer every other function gives for a resource out of reach.
CREATE FUNCTION chronelle_resource_share_leave(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  resource_id uuid,
  left_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  grant_ids uuid[];
BEGIN
  SELECT array_agg(g.id ORDER BY g.created_at, g.id) INTO grant_ids
  FROM resource_grants g
  JOIN objects o
    ON o.workspace_id = g.workspace_id AND o.id = g.resource_id AND o.deleted_at IS NULL
  WHERE g.workspace_id = workspace_id AND g.resource_id = resource_id
    AND g.principal_type = 'user' AND g.principal_id = user_id;
  IF grant_ids IS NULL THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  DELETE FROM resource_grants g WHERE g.workspace_id = workspace_id AND g.id = ANY (grant_ids);
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), workspace_id, 'user', user_id, 'resource.share_left', resource_id, request_id,
          jsonb_build_object('grantIds', to_jsonb(grant_ids)));
  RETURN jsonb_build_object(
    'resourceId', resource_id::text,
    'grantIds', to_jsonb(grant_ids),
    'leftAt', chronelle_iso(left_at)
  );
END
$$;
