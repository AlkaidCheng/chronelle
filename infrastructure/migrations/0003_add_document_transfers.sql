CREATE TABLE document_transfer_authorizations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  operation text NOT NULL,
  token_hash text NOT NULL,
  resource_id uuid NOT NULL,
  storage_provider text NOT NULL,
  storage_key text NOT NULL,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  checksum_sha256 text NOT NULL,
  authorized_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  finalized_at timestamptz,
  CONSTRAINT document_transfers_resource_workspace_fk
    FOREIGN KEY (workspace_id, resource_id)
    REFERENCES objects(workspace_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT document_transfers_operation_valid
    CHECK (operation IN ('upload', 'download')),
  CONSTRAINT document_transfers_token_hash_valid
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT document_transfers_token_hash_unique
    UNIQUE (token_hash),
  CONSTRAINT document_transfers_storage_provider_not_blank
    CHECK (btrim(storage_provider) <> ''),
  CONSTRAINT document_transfers_storage_key_not_blank
    CHECK (btrim(storage_key) <> ''),
  CONSTRAINT document_transfers_original_filename_not_blank
    CHECK (btrim(original_filename) <> ''),
  CONSTRAINT document_transfers_mime_type_not_blank
    CHECK (btrim(mime_type) <> ''),
  CONSTRAINT document_transfers_size_nonnegative
    CHECK (size_bytes >= 0),
  CONSTRAINT document_transfers_checksum_valid
    CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT document_transfers_expiry_after_creation
    CHECK (expires_at > created_at),
  CONSTRAINT document_transfers_consumed_after_creation
    CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CONSTRAINT document_transfers_finalized_after_consumption
    CHECK (
      finalized_at IS NULL
      OR (
        operation = 'upload'
        AND consumed_at IS NOT NULL
        AND finalized_at >= consumed_at
      )
    )
);

CREATE INDEX document_transfers_resource_created_idx
  ON document_transfer_authorizations (
    workspace_id,
    resource_id,
    created_at DESC
  );

CREATE INDEX document_transfers_pending_expiry_idx
  ON document_transfer_authorizations (operation, expires_at)
  WHERE consumed_at IS NULL;
