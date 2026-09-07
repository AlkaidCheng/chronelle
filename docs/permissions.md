# Permissions

Revision history uses current View permission, including content saved before a
collaborator was invited. It never uses saved permissions. History reads authorize
and fetch within one consistent database snapshot; revoked access applies to
subsequent requests. Deleted resources remain unavailable through normal history
endpoints. See [Object revisions](revisions.md) for disclosure and redaction rules.

Comparisons and previews require current View. Content restore requires current
Edit and the expected version, and never replays grants, scopes, or lifecycle
state. Canonical creation and updates, context and relationship creation,
restoration, recovery, and permission mutations acquire the same workspace
transaction lock before their final authorization decision. A revocation or
scope change that wins the lock is observed by waiting mutations. Version
checks remain necessary for drafts read before acquiring the lock.
Administrative SQL and future membership writers must follow this protocol.

Authorization is an application-layer service with one operation:

```text
can(principal, action, resource)
```

Authentication establishes identity. It does not decide what that identity can
access. Human requests and future share-link or AI tool calls use the same
authorization service.

## Consistent reads

`withReadAuthorization` binds policy checks and database retrieval to one
repeatable-read, read-only transaction. Object detail and access actions, Event
lists and projections, relation and attachment traversal, search, grant lists,
history, restoration previews, Trash, and command-state reads use this boundary.
Nested readers share the same transaction and evaluator, including all members
of a projection. No permission decision is cached across requests.

Grant expiry is evaluated at a fixed application-clock instant for each read
boundary. A read already authorized in its snapshot may finish after revocation,
scope changes, deletion, or expiry. It can return only the state visible in that
snapshot, not subsequent private edits or newly added grant recipients. A later
read evaluates the current policy. This does not retract bytes already sent or
promise one snapshot across separate HTTP requests.

Identity resolution and workspace listing each use their own read boundary.
The selected workspace is still context, not authority: protected resource
services check access again in their own transaction. A session response may
therefore contain an earlier authorized active workspace while a newer workspace
list omits it. That earlier workspace metadata is never refreshed after its
authorization boundary has closed.

These reads do not take the workspace mutation lock or span storage/network I/O.
They hold a database connection until the callback completes. Keep callbacks
short; snapshot isolation does not bound query count, collection size, or pool
wait time. Protected writes continue to use `withStableAuthorization` and version
checks, not read-only snapshots.

## Initial roles

Execute, Undo, and Redo require current Edit on every command member under the
workspace authorization fence. Stack state is scoped by authenticated user and
workspace; heads without current Edit are omitted. Idempotent receipt replay
requires current View on every affected object and never returns saved content.
No inverse replays permissions or security metadata. See [Commands](commands.md).

- Owner can view, comment, edit, share, soft-delete, and recover a resource.
- Editor can view, comment, and edit a resource.
- Viewer can view a resource.

The implemented policy accepts the strongest applicable role from workspace
membership, a direct resource grant, or a grant on the resource's canonical
permission scope. Expired grants do not apply. Normal access excludes grants
targeting deleted objects; the explicit Owner-only recovery policy resolves
tombstones without enabling normal reads. It does not support explicit deny
precedence or field-level grants. See [Recovery](recovery.md).

Owner and Editor workspace members can create self-scoped objects. Creating an
inheriting object requires Edit on the selected permission scope. Viewer access
never permits creation or mutation.

The persistence kernel stores exactly one `permission_scope_id` per canonical
object. Its composite foreign key requires the scope and resource to share a
workspace. A self-scope stops inheritance. Direct V1 grants target users who
may be outside the resource workspace so an owner can share one Event without
granting workspace membership. The grant's resource must still belong to its
declared workspace, which prevents a forged cross-workspace resource link.

Resource owners can create, list, and revoke direct grants through the same
authorization boundary. The browser offers Owner and Viewer; the API also
accepts Editor. A development recipient is resolved by normalized email and
must have signed in once so a canonical user exists. Revocation removes the
active grant row and records an immutable `resource.share_revoked` audit event,
so access disappears on the next request while the administrative history
remains available in the audit log.

Object references never grant access. APIs, projections, searches, attachment
URLs, and relation traversal must independently authorize every protected
resource they return.

Document upload authorization requires Edit on the Event, Task, or Expense
being attached to. The resulting Document inherits that parent's canonical
permission scope. Finalization rechecks Edit so a revoked user cannot turn an
earlier upload into a canonical object. Listing attachments requires View on
the parent and separately authorizes every Document; inaccessible attachments
contribute only to a generic count.

Download authorization requires View on the canonical Document. Local
downloads use an opaque, expiring, one-time bearer credential and recheck View
when bytes are requested, so revoking a grant invalidates an already-issued
download. Viewers can download inherited files but cannot upload, replace, or
unlink them. Storage keys and permanent public URLs are never returned.

Storage I/O runs outside the workspace lock. Upload/download authorization
records are written only after permission is rechecked under that lock.
Finalization rechecks Edit and reads the parent's current permission scope
before creating the Document. Local download consumption rechecks View and
expiry after reading the file, before committing the consumption and its
audit event. Revocation that commits during storage I/O prevents completion.
A download already authorized and consumed may finish sending its bytes;
revocation does not retract a response already in progress.

The lock is per workspace, so unrelated workspaces can still write concurrently.
Within one workspace, protected mutations serialize. This deliberately favors
correct ordering; measure contention before introducing finer-grained locks.
Remote signed transfers retain their storage provider's expiry/revocation
semantics and require separate adapter validation.

The [storage inventory](storage-reconciliation.md) requires Owner workspace
membership through `AuthorizationService.assertWorkspaceOwner`. A resource Owner
grant does not confer this authority. Ownership is checked before starting,
inside the read-only reference snapshot, and after storage I/O. Only aggregate
counts are returned, including canonical trash and history references; no object
identities or file keys are disclosed.

The Event collection is also a protected query. It selects candidates only in
the active workspace and applies `can(principal, view, event)` to every returned
Event. A relationship or workspace ID alone cannot make an Event appear.

Search follows the same rule. It selects only active candidates from the
authenticated workspace, calls `can(principal, view, resource)` for each one,
and returns no total computed from unauthorized rows. Object-type filters do
not weaken that decision. A directly shared Event and its inheriting children
can appear; a related self-scoped object cannot.

Creating a relationship requires Edit on its source and View on its target.
Listing relationships first authorizes the requested object, then omits links
whose other endpoint is unavailable to the caller. Removing a relationship
requires Edit on its source and leaves both objects intact.

`permission_scope_id = id` stops inheritance. Any other value selects exactly
one object in the same workspace as the inheritance source. Relation rows are
never consulted when evaluating access.

Changing a permission scope is an Owner operation and uses the object's
optimistic version. V1 permits an object to become self-scoped or to inherit
from a self-scoped Event in the same workspace. Event detail omits inaccessible
related resources and returns only a generic locked-relation count; object
identities, types, and business fields are not exposed.

The active workspace is request context, not a grant. A user can select a
workspace only through membership or an active grant to a non-deleted resource,
or an active Owner grant to a tombstone for recovery. Resource authorization additionally requires the resource workspace
to match that active workspace. Missing and unauthorized resources use the same
external error shape so forged IDs do not reveal existence.

PostgreSQL row-level security remains deferred defense in depth. The current
pooled connection uses one table-owning role and does not bind every protected
query to a transaction-local workspace setting. Policies in that model would
be bypassable or could reuse session state across requests. RLS will be enabled
with a separate least-privilege runtime role and transaction-scoped workspace
context. Fine-grained authorization remains in the application layer so its
decisions are testable and consistent across clients.
