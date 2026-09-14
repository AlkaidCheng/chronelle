-- The storage references of a workspace as a read-only database function:
-- the storage keys of its live documents, the keys named by its document
-- revision snapshots, and the keys of its upload transfers with whether the
-- transfer can still finalize. StorageInventoryService classifies them
-- against the storage provider's listing; the function returns what its
-- PostgreSQL queries return, each set capped at row_limit + 1 rows so the
-- caller can refuse a workspace beyond its inventory bound.
--
-- Errors: PT403 for a caller who is not an Owner of the workspace.
CREATE FUNCTION chronelle_storage_references(
  workspace_id uuid,
  user_id uuid,
  storage_provider text,
  observed_at timestamptz,
  row_limit integer
)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
DECLARE
  canonical jsonb;
  revisions jsonb;
  uploads jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM workspace_members m
    WHERE m.workspace_id = workspace_id AND m.user_id = user_id AND m.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  SELECT COALESCE(jsonb_agg(k.key), '[]'::jsonb) INTO canonical
  FROM (
    SELECT DISTINCT d.storage_key AS key
    FROM documents d
    WHERE d.workspace_id = workspace_id AND d.storage_provider = storage_provider
    LIMIT row_limit + 1
  ) k;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schemaVersion', r.schema_version, 'objectType', r.object_type, 'provider', r.provider, 'key', r.key)), '[]'::jsonb)
  INTO revisions
  FROM (
    SELECT DISTINCT
      rv.snapshot_schema_version AS schema_version,
      rv.snapshot ->> 'objectType' AS object_type,
      CASE WHEN jsonb_typeof(rv.snapshot -> 'storageProvider') = 'string' THEN rv.snapshot ->> 'storageProvider' END AS provider,
      rv.snapshot ->> 'storageKey' AS key
    FROM object_revisions rv
    JOIN objects o ON o.workspace_id = rv.workspace_id AND o.id = rv.object_id AND o.object_type = 'document'
    WHERE rv.workspace_id = workspace_id
    LIMIT row_limit + 1
  ) r;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', u.key, 'recoverable', u.recoverable)), '[]'::jsonb) INTO uploads
  FROM (
    SELECT t.storage_key AS key,
           bool_or(t.consumed_at IS NOT NULL OR t.finalized_at IS NOT NULL OR t.expires_at > observed_at) AS recoverable
    FROM document_transfer_authorizations t
    WHERE t.workspace_id = workspace_id AND t.storage_provider = storage_provider AND t.operation = 'upload'
    GROUP BY t.storage_key
    LIMIT row_limit + 1
  ) u;
  RETURN jsonb_build_object('canonical', canonical, 'revisions', revisions, 'uploads', uploads);
END
$$;
