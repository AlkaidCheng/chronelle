# Permissions

Authorization is an application-layer service with one conceptual operation:

```text
can(principal, action, resource)
```

Authentication establishes identity. It does not decide what that identity can
access. Human requests, share-link requests, and future AI tool calls will all
use the same authorization service.

## Initial roles

- Owner can view, edit, share, and soft-delete a resource.
- Editor can view and edit a resource.
- Viewer can view a resource.

V1 will support direct grants and inheritance from one canonical permission
scope. A resource can inherit or stop inheritance. It will not support explicit
deny precedence or field-level grants.

Object references never grant access. APIs, projections, searches, attachment
URLs, and relation traversal must independently authorize every protected
resource they return.

PostgreSQL row-level security is planned as defense in depth for workspace
isolation. Fine-grained authorization remains in the application layer so its
decisions are testable and consistent across clients.
