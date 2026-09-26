# Storage reconciliation

Workspace owners can obtain a read-only inventory through
`GET /api/workspace/storage-inventory` or `LivTalesApiClient.getStorageInventory()`.
The active workspace comes from authenticated request context, not a query
parameter. No parameters are accepted. Existing clients are unaffected and no
migration is needed.

```bash
curl http://localhost:4000/api/workspace/storage-inventory \
  --header "authorization: Bearer $ACCESS_TOKEN" \
  --header "x-workspace-id: $WORKSPACE_ID"
```

The response contains the workspace, configured provider, observation start/end
times, and aggregate counts. It never includes filenames, storage keys, object
IDs, checksums, or transfer credentials. Responses are private and non-cacheable.
There is no inventory screen yet.

## What the counts mean

References are distinct keys, not numbers of revisions or relationships.
`references.canonical` includes every Document for the configured provider,
including archived, trashed, and unlinked Documents. `references.historicalOnly`
includes keys found only in document revisions. Overlapping current/history keys
count once, as canonical. Missing reference counts mean no eligible regular file
was observed for that key; an unsupported entry at that key also counts as missing.

Each entry the workspace accounts for has one category. These are the immediate
entries in `workspaces/<workspace-id>/documents`, less the files another
workspace's records name, plus the files its own references name under another
workspace's prefix (see [Files of moved records](#files-of-moved-records)). The
categories take the following precedence:

| Entry count      | Meaning                                                                               |
| ---------------- | ------------------------------------------------------------------------------------- |
| `unsupported`    | Directory, symbolic/hard link, special file, or unexpected key shape; never traversed |
| `canonical`      | Regular file referenced by a canonical Document                                       |
| `historicalOnly` | Regular file referenced only by document history                                      |
| `pendingUpload`  | Remaining file with an unexpired, consumed, or finalized upload authorization         |
| `expiredUpload`  | Remaining file with only expired, unconsumed upload authorizations                    |
| `unreferenced`   | Remaining regular file with a document-shaped key and no observed reference           |

Consumed uploads can still finalize after their authorization expires. They must
not be treated as abandoned on expiry. Upload authorizations without stored files
do not contribute to entry counts. Download authorizations do not create separate
storage ownership. Relationship deletion and soft deletion never remove a file's
canonical reference.

## Files of moved records

A file keeps its storage key when its record moves to another workspace: the key
is an opaque address and nothing is copied, so it can carry the prefix of the
workspace it was uploaded in. The inventory counts a file in the workspace whose
records name it, whatever prefix its key carries:

- References may name a key under any workspace's document prefix. A moved
  Document, trashed or not, is a canonical reference of the workspace it lives
  in, and a moved upload authorization is an upload of that workspace.
- The scan lists the workspace's own prefix and, for each other prefix under
  which its references name a key, that prefix too, counting there only the
  entries its references name. Such a key with no regular file there counts as
  missing, as any other reference does.
- An entry under the workspace's own prefix that its references do not name,
  but a Document or upload authorization of another workspace names for the same
  provider, belongs to that workspace's report. It is left out of this one
  rather than counted as `unreferenced`.

So each file counts in one report: that of the workspace whose records name it,
or, when no record names it, that of the workspace whose prefix holds it. The
lookup of other workspaces' records takes only keys under the caller's own
prefix, reads Document and upload authorization rows by exact key, and returns
nothing but which of those keys to leave out; no count, key, or identifier of
another workspace reaches the report. Document history is not looked up across
workspaces: a Document's key never changes, so its history names the key its
row names.

## Consistency and retention

The report explicitly returns `consistency: "observational"` and
`retentionPolicy: "retain-all"`. Reference queries and their owner check share
the authorization package's read-only repeatable-read boundary. The snapshot
keeps reference classification consistent with that check even if another request
finalizes an upload before the reference queries finish. A later inventory sees
the finalized document. Storage enumeration follows after that transaction closes;
the lookup of other workspaces' records, when an entry under the workspace's own
prefix has no reference, runs after enumeration in a second read-only snapshot
with its own owner check. Database and storage observations are not atomic.
Concurrent uploads, finalization, or moves can change classifications during a
scan. Recheck after writers are quiescent when investigating a discrepancy.

Local uploads keep in-progress bytes in private `.upload-*` directories. Inventory
counts these directories as unsupported without opening them. Between publication
and staging cleanup, the completed final file has multiple hard links and is also
unsupported. After normal cleanup, that file is eligible for reference
classification. A scan racing with cleanup can return `503 inventory_unavailable`
if an observed entry disappears before inspection; retry after writers settle.

An interrupted process can leave the staging link behind. Matching upload retries
preserve it because they remove only their own staging directory. Inventory then
continues to count the final file as unsupported, and a canonical reference to it
as missing, even when its bytes are intact. Neither a retry nor an inventory scan
repairs or removes abandoned links. Investigate these observations under the
retention policy before changing files.

This report is not a deletion manifest. Every category is retained. It performs
no file writes, database mutations, audit writes, purge, or automatic repair.
A future retention workflow needs an explicit retention policy and fresh
transactional checks that preserve trash, history, and recoverable transfers.

## Authorization and operational limits

`AuthorizationService.assertWorkspaceOwner` requires Owner workspace membership.
An Owner grant on an individual Event is insufficient. The service checks before
starting, inside the reference snapshot, inside the lookup of other workspaces'
records when there is one, and after storage I/O. A revocation observed by the
final check suppresses the report; a response already authorized cannot be
retracted.

The service allows one scan per workspace and two scans per API service instance.
Additional requests receive `429 inventory_busy`. This is not a distributed rate
limiter. Each reference query and the combined distinct-key set are capped at
10,000; each listed prefix is capped at 10,000 immediate entries, including a
prefix listed for moved files, where the entries not counted still count toward
that cap. SQL statements have a five-second timeout. Enumeration checks one
ten-second abort signal across all its listings between I/O operations; a
blocked filesystem syscall or in-flight cloud request may take longer to settle.

Unsupported providers, unreadable or unknown-version document revisions, limits,
cancellation, and storage errors return `503 inventory_unavailable`, with no
partial counts or internal error details. These conditions require investigation,
not removal. A generic `404 resource_unavailable` hides unauthorized workspaces.

The local and Tencent COS adapters support inventory. Other adapters must implement
the optional `StorageProvider.listObjects` capability; there is no local fallback.
The configured local root must already exist and be private. A missing workspace
document directory is empty; a missing storage root is unavailable. Symbolic
links in the root or prefix are rejected. Directory identities are rechecked
after enumeration to detect replacement. Node pathname operations do not provide
race-proof traversal against a hostile process with the same filesystem access;
the storage root and its ancestors must remain under trusted administration.
Nested directories are reported as unsupported entries, not recursively scanned.

COS enumeration uses a flat document prefix, with at most 1000 entries per page.
Nested prefixes are unsupported and are not traversed. The adapter rejects
unexpected scope, malformed encodings, duplicate keys, and missing or inconsistent
continuation markers. The application retains the same 10,000-entry cap and
post-enumeration owner check; no local fallback is used for a configured COS store.
No object bodies or signed transfer URLs are fetched to produce the report.

COS listings can lag recent writes, and listing an archived object does not prove
it can be downloaded immediately. Counts are not a content-integrity or encryption
check. See [COS storage](storage.md#read-only-inventory) for required listing IAM
permissions, consistency limits, and live deployment validation.

This adds no cloud provisioning, production backup encryption,
retention duration, or public-launch authorization.
