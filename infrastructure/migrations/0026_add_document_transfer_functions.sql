-- Document transfers as database functions: recording an upload or
-- download authorization, consuming a transfer once, and finalizing an
-- upload into a Document attached to its parent. The storage provider is
-- untouched: the service still issues the signed transfer, stores or reads
-- the bytes, and inspects the stored object; these functions carry the
-- rows DocumentService writes around those steps, each call in one
-- transaction with its audit event.
--
-- Errors follow DocumentService: PT403 unavailable (the parent is not a
-- live Event, Task, or Expense the caller may edit; the document is not
-- viewable), PT404 for a transfer that is missing, consumed, expired, or
-- already finalized.

-- DocumentService.authorizeUpload() and authorizeDownload(): the transfer
-- row and its audit event. `transfer` carries the authorization's fields
-- (id, operation, tokenHash, resourceId, storageProvider, storageKey,
-- originalFilename, mimeType, sizeBytes as text, checksumSha256, createdAt,
-- expiresAt); the caller is the authorizer.
CREATE FUNCTION chronelle_document_transfer_authorize(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  transfer jsonb
)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  operation text := transfer ->> 'operation';
  resource_id uuid := (transfer ->> 'resourceId')::uuid;
  resource objects%ROWTYPE;
BEGIN
  IF operation NOT IN ('upload', 'download') THEN
    RAISE EXCEPTION 'operation must be upload or download.' USING ERRCODE = 'PT422';
  END IF;
  SELECT * INTO resource FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = resource_id AND o.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF operation = 'upload' THEN
    IF resource.object_type NOT IN ('event', 'task', 'expense')
       OR NOT chronelle_can_edit_live(workspace_id, user_id, resource_id) THEN
      RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
    END IF;
  ELSIF resource.object_type <> 'document' OR NOT chronelle_can_view(workspace_id, user_id, resource_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;

  INSERT INTO document_transfer_authorizations (id, workspace_id, operation, token_hash, resource_id, storage_provider,
    storage_key, original_filename, mime_type, size_bytes, checksum_sha256, authorized_by, created_at, expires_at)
  VALUES ((transfer ->> 'id')::uuid, workspace_id, operation, transfer ->> 'tokenHash', resource_id,
          transfer ->> 'storageProvider', transfer ->> 'storageKey', transfer ->> 'originalFilename',
          transfer ->> 'mimeType', (transfer ->> 'sizeBytes')::bigint, transfer ->> 'checksumSha256', user_id,
          (transfer ->> 'createdAt')::timestamptz, (transfer ->> 'expiresAt')::timestamptz);
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), workspace_id, 'user', user_id, 'document.' || operation || '_authorized', resource_id, request_id,
          jsonb_build_object('transferAuthorizationId', transfer ->> 'id'));
END
$$;

-- DocumentService.receiveUpload() and consumeDownload(): a transfer is
-- consumed once, before it expires; a download also requires that its
-- authorizer may still view the document. The audit event names the
-- authorizer as the actor.
CREATE FUNCTION chronelle_document_transfer_consume(
  transfer_id uuid,
  operation text,
  consumed_at timestamptz,
  request_id uuid
)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  transfer document_transfer_authorizations%ROWTYPE;
BEGIN
  SELECT * INTO transfer FROM document_transfer_authorizations t
  WHERE t.id = transfer_id AND t.operation = operation
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The document transfer is unavailable.' USING ERRCODE = 'PT404';
  END IF;
  IF operation = 'download' AND NOT chronelle_can_view(transfer.workspace_id, transfer.authorized_by, transfer.resource_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  UPDATE document_transfer_authorizations t
  SET consumed_at = consumed_at
  WHERE t.id = transfer_id AND t.consumed_at IS NULL AND t.expires_at > consumed_at;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The document transfer is unavailable.' USING ERRCODE = 'PT404';
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata)
  VALUES (chronelle_uuidv7(), transfer.workspace_id, 'user', transfer.authorized_by,
          CASE operation WHEN 'upload' THEN 'document.uploaded' ELSE 'document.downloaded' END,
          transfer.resource_id, request_id, jsonb_build_object('transferAuthorizationId', transfer_id::text));
END
$$;

-- DocumentService.finalizeUpload(): the caller's unfinalized upload becomes
-- a Document on the parent's permission scope, attached to the parent by an
-- `attached_to` relation, with the document.created audit event and the
-- version-1 revision. The service has already verified the stored bytes.
-- Returns {document: rows, relationId, relationVersion}.
CREATE FUNCTION chronelle_document_finalize(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  transfer_id uuid,
  document_id uuid,
  relation_id uuid,
  finalized_at timestamptz,
  encryption_mode text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  transfer document_transfer_authorizations%ROWTYPE;
  parent objects%ROWTYPE;
  audit_id uuid := chronelle_uuidv7();
  written_at timestamptz := now();
BEGIN
  SELECT * INTO transfer FROM document_transfer_authorizations t
  WHERE t.id = transfer_id AND t.workspace_id = workspace_id AND t.authorized_by = user_id
    AND t.operation = 'upload' AND t.finalized_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR (transfer.consumed_at IS NULL AND transfer.expires_at <= finalized_at) THEN
    RAISE EXCEPTION 'The document transfer is unavailable.' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO parent FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = transfer.resource_id AND o.deleted_at IS NULL;
  IF NOT FOUND OR parent.object_type NOT IN ('event', 'task', 'expense')
     OR NOT chronelle_can_edit_live(workspace_id, user_id, transfer.resource_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;

  UPDATE document_transfer_authorizations t
  SET consumed_at = COALESCE(t.consumed_at, finalized_at), finalized_at = finalized_at
  WHERE t.id = transfer_id;
  INSERT INTO objects (id, workspace_id, object_type, display_name, created_by, permission_scope_id, created_at, updated_at)
  VALUES (document_id, workspace_id, 'document', transfer.original_filename, user_id, parent.permission_scope_id,
          written_at, written_at);
  INSERT INTO documents (object_id, workspace_id, storage_provider, storage_key, original_filename, mime_type,
                         size_bytes, checksum_sha256, encryption_mode)
  VALUES (document_id, workspace_id, transfer.storage_provider, transfer.storage_key, transfer.original_filename,
          transfer.mime_type, transfer.size_bytes, transfer.checksum_sha256, encryption_mode);
  INSERT INTO object_relations (id, workspace_id, source_object_id, relation_type, target_object_id, created_by, created_at)
  VALUES (relation_id, workspace_id, document_id, 'attached_to', parent.id, user_id, written_at);
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
  VALUES (audit_id, workspace_id, 'user', user_id, 'document.created', document_id, request_id,
          jsonb_build_object('parentObjectId', parent.id::text, 'permissionScopeId', parent.permission_scope_id::text,
                             'relationId', relation_id::text, 'transferAuthorizationId', transfer_id::text, 'version', 1),
          written_at);
  INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
  VALUES (chronelle_uuidv7(), workspace_id, document_id, 1, 'created', NULL,
          'user', user_id, request_id, audit_id, 1, chronelle_object_snapshot(workspace_id, document_id), written_at);
  RETURN jsonb_build_object(
    'document', chronelle_document_rows(workspace_id, document_id),
    'relationId', relation_id::text,
    'relationVersion', 1);
END
$$;
