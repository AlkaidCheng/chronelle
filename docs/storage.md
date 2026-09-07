# Private document storage

`StorageProvider` issues upload/download capabilities, inspects stored bytes, and
optionally enumerates storage entries for read-only inventory.
Document identity, permissions, attachment relationships, revisions, and audit
events belong to the application. Selecting a provider changes file transport,
not the canonical object model. Files are limited to 25 MiB.

The default `local-filesystem` provider uses `LOCAL_STORAGE_ROOT` and one-time
API transfer endpoints. `TencentCosStorageProvider` uses the official pinned
Node.js SDK to sign HTTPS transfers directly to a configured COS bucket.

## Configure Tencent COS

Keep credentials in server-side secret storage, never in browser variables,
source control, logs, or shared command history. Configure these API variables
alongside the existing database and authentication settings:

```dotenv
DOCUMENT_STORAGE_PROVIDER=tencent-cos
COS_BUCKET=chronelle-documents-1250000000
COS_REGION=ap-guangzhou
DOCUMENT_TRANSFER_TTL_SECONDS=300
```

`COS_SECRET_ID` and `COS_SECRET_KEY` are required. Temporary credentials also
require `COS_SECURITY_TOKEN` and their actual `COS_CREDENTIALS_EXPIRE_AT` as an
ISO UTC timestamp. URLs expire no later than those credentials. This adapter
does not refresh credentials automatically; rotate them through the deployment
secret workflow and restart the API before expiry.

Uploads request SSE-COS (AES256). Set `COS_KMS_KEY_ID` to request SSE-KMS with
that key instead; the deployment must supply the corresponding KMS permissions.
The adapter rejects transfer lifetimes longer than fifteen minutes. Keep the
default five-minute lifetime unless a shorter period meets the deployment need.

Use a dedicated, private, never-versioned bucket. The adapter checks bucket ACL
and versioning before every signature and rejects public/additional-principal
ACL grants, enabled versioning, suspended versioning, and unavailable checks.
COS's [overwrite guard](https://cloud.tencent.cn/document/product/436/7749)
does not protect version-enabled buckets. Documents currently identify immutable
keys, not COS versions, so enabling versioning requires a separate model change.

Grant the runtime identity only the required bucket configuration reads
(`cos:GetBucketACL`, `cos:GetBucketVersioning`) and object uploads/downloads
(`cos:PutObject`, `cos:GetObject`) under `workspaces/*/documents/*` in this bucket.
Inventory also needs `cos:GetBucket` listing permission, constrained to the
application's document prefixes. Validate the resource and prefix conditions
against the deployment's CAM policy; object GET permission does not authorize
bucket listing. The API never returns listing credentials or raw keys.
Verify the exact IAM policy, including private object ACL and KMS requirements,
against the configured account before deployment. Do not use administrator
credentials or grant object deletion, bucket mutation, or wildcard actions.
Bucket policies, directory permissions, public-access settings, other writers,
and lifecycle rules remain trusted deployment configuration: ACL checks alone
cannot prove effective IAM isolation. Keep this configuration stable and deny
out-of-band object replacement or deletion.

For browser transfers, configure COS CORS for the exact trusted web origin and
GET/PUT methods. Allow the upload headers returned by the adapter: `content-type`,
`content-encoding`, `x-cos-acl`, `x-cos-forbid-overwrite`, `x-cos-meta-sha256`,
`x-cos-server-side-encryption`, and the optional KMS key header. The signature also
binds `content-length`, which browsers compute from the uploaded buffer. Test
preflight and actual requests; CORS is not an authorization boundary.

The API needs outbound HTTPS to the regional COS endpoint for configuration
checks and finalization. The supplied private preview Compose network deliberately
has no API egress and does not pass COS credentials. It remains a local-storage
preview; using COS requires a reviewed deployment configuration with restricted
egress and secret injection. No bucket, policy, or cloud account is provisioned
by the application.

## Transfer guarantees and limits

- Upload authorization requires current Edit on the parent. Signed headers bind
  the key, method, size, checksum metadata, private ACL, encryption, binary content
  type, identity encoding, and create-only policy. A successful upload cannot be
  overwritten by replay when COS enforces the configured bucket policy.
- Finalization rechecks Edit and hashes the actual object stream, bounded by
  25 MiB and a 30-second transfer deadline. It rejects mismatched size/checksum,
  missing or unexpected encryption, encoded, partial, and oversized responses.
  Metadata and ETags are not treated as proof of file contents. Configuration
  calls have separate 10-second SDK timeouts; these are not an end-to-end deadline.
- Every inspection performs two configuration reads and one object GET. This
  adds latency and read traffic; streaming hashing avoids buffering a second
  complete attachment in application memory. Configuration checks are not cached.
- Download authorization requires current View. URLs bind binary content type,
  attachment disposition, and private/no-store response caching. Redirects are
  rejected during server-side inspection. Storage keys appear within signed URLs;
  document API payloads do not expose a separate storage key or secret key.
- Direct COS URLs are bearer capabilities and can be reused until expiry.
  Revoking a grant blocks subsequent authorization/finalization but cannot cancel
  an already-issued direct download. Keep URLs out of logs and analytics.
- Application audits record authorization issuance and canonical finalization.
  Direct uploads/downloads do not call local consumption endpoints; configure
  protected COS access logging for actual transfers. Access-log retention and
  redaction must protect credentials, filenames, and URL query strings.
- Changing the configured bucket or provider does not migrate existing files.
  A mismatched provider ID is unavailable; a changed bucket can orphan references.
  Keep configuration stable, and design an explicit migration before switching
  any populated store.
- Failed/abandoned uploads may leave private, unreferenced objects. No automatic
  purge is implemented. Retention, encrypted backups, and restore
  procedures require deployment policy and evidence before deletion is enabled.

## Read-only inventory

Both adapters support the existing workspace-owner
[storage inventory](storage-reconciliation.md). COS lists only the active
workspace's document prefix, using a flat delimiter and at most 1000 entries per
request. It reads bucket policy and listing metadata, not object contents or
checksums. Nested prefixes remain unsupported entries and are never traversed.
Listing requires no additional REST endpoint, database migration, or client input.

The adapter validates response scope, encoding, page bounds, and continuation
progress. Missing/malformed pages, denied cloud calls, cancellation, or an
application limit produce an unavailable report without partial counts.
Cancellation is checked between SDK calls and entries; an in-flight SDK request
can take longer than the inventory's ten-second observation window to settle.

COS [listing is eventually consistent](https://www.tencentcloud.com/document/product/436/30614).
Recent writes may be absent even after a completed listing. Inventory retains its
observational, retain-all contract: an absent entry is not proof of missing bytes,
and neither counts nor a successful scan authorize repair or deletion. Listing
does not verify content integrity, encryption, or immediate download availability
for archived storage classes. Current workspace ownership is checked again after
the cloud calls complete.

## Validation

`pnpm check` includes shared local/COS key and metadata contracts, real SDK
signature-binding tests, and PostgreSQL API tests for inherited access, denied
writes, corrupted/missing files, expiry, duplicate finalization, and permission
revocation during inspection. COS network responses in those tests are simulated.
Inventory tests exercise pagination, encoded keys, malformed responses, cancellation,
owner-only access, retained trash, pending uploads, and revocation during listing.
The container and browser gates exercise the default local provider.

Before enabling COS, use synthetic files in an explicitly designated test prefix
to verify actual IAM permissions, anonymous denial, browser CORS, zero-byte and
25 MiB transfers, byte-for-byte downloads, expiry, overwrite/replay rejection,
encryption, credential rotation, audit logging, and revoked-user denial of new
authorizations. Include a multi-page inventory and a recent-write observation,
verify listing IAM prefix restrictions, and confirm that denied or interrupted
listings expose no partial counts. Verify that public ACL/versioning changes fail closed in a
disposable bucket, not a populated one. Retain evidence without signed URLs or
credentials. Live COS validation is a required deployment gate, not established
by the simulated tests. Development authentication still blocks public launch.
