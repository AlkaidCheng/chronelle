# Permissions

Authorization is an application-layer service with one operation:

```text
can(principal, action, resource)
```

Authentication establishes identity. It does not decide what that identity can
access. Human requests and future share-link or AI tool calls use the same
authorization service.

## Initial roles

- Owner can view, comment, edit, share, and soft-delete a resource.
- Editor can view, comment, and edit a resource.
- Viewer can view a resource.

The implemented policy accepts the strongest applicable role from workspace
membership, a direct resource grant, or a grant on the resource's canonical
permission scope. Expired grants and grants targeting deleted objects do not
apply. It does not support explicit deny precedence or field-level grants.

Owner and Editor workspace members can create self-scoped objects. Creating an
inheriting object requires Edit on the selected permission scope. Viewer access
never permits creation or mutation.

The persistence kernel stores exactly one `permission_scope_id` per canonical
object. Its composite foreign key requires the scope and resource to share a
workspace. A self-scope stops inheritance. Direct V1A grants target users who
may be outside the resource workspace so an owner can share one Event without
granting workspace membership. The grant's resource must still belong to its
declared workspace, which prevents a forged cross-workspace resource link.

Object references never grant access. APIs, projections, searches, attachment
URLs, and relation traversal must independently authorize every protected
resource they return.

The Event collection is also a protected query. It selects candidates only in
the active workspace and applies `can(principal, view, event)` to every returned
Event. A relationship or workspace ID alone cannot make an Event appear.

Creating a relationship requires Edit on its source and View on its target.
Listing relationships first authorizes the requested object, then omits links
whose other endpoint is unavailable to the caller. Removing a relationship
requires Edit on its source and leaves both objects intact.

`permission_scope_id = id` stops inheritance. Any other value selects exactly
one object in the same workspace as the inheritance source. Relation rows are
never consulted when evaluating access.

The active workspace is request context, not a grant. A user can select a
workspace only through membership or an active grant to a non-deleted resource
inside it. Resource authorization additionally requires the resource workspace
to match that active workspace. Missing and unauthorized resources use the same
external error shape so forged IDs do not reveal existence.

PostgreSQL row-level security is planned as defense in depth for workspace
isolation. Fine-grained authorization remains in the application layer so its
decisions are testable and consistent across clients.
