# Reversible content commands

The command API applies and reverses Event/Task content edits. Each successful
Execute, Undo, or Redo is a new mutation of the same canonical objects, with
new versions, immutable revisions, and audit events. Existing PATCH endpoints
remain supported but do not add entries to a reversible stack. The web editors
still use those PATCH endpoints; command controls are not yet implemented.

## Contract

| Endpoint                  | Purpose                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `GET /api/commands`       | Current user's stack version and eligible heads in the selected workspace |
| `POST /api/commands`      | Apply 1-10 distinct Event/Task content edits atomically                   |
| `POST /api/commands/undo` | Reverse the pinned undo head                                              |
| `POST /api/commands/redo` | Reapply the pinned redo head                                              |

Requests use the existing bearer credential and workspace header. The server
derives the user and workspace; clients cannot name another user's stack.
Unknown fields and duplicate object IDs are rejected. An edit allows display
name, custom properties, and the existing Event/Task typed fields. Metadata,
permission scopes, grants, object creation, trash, links, financial facts,
reminders, and document transfers are not eligible.

With an authenticated `ChronelleApiClient`, a reversible edit replaces a direct
patch call such as:

```ts
await client.updateEvent(event.id, {
  expectedVersion: event.version,
  displayName: "Launch evening",
});
```

The command equivalent reads and pins both the stack and object versions:

```ts
const stack = await client.getCommandState();
const command = {
  operationId: crypto.randomUUID(),
  expectedStackVersion: stack.version,
  edits: [
    {
      objectType: "event" as const,
      objectId: event.id,
      patch: { expectedVersion: event.version, displayName: "Launch evening" },
    },
  ],
};
const receipt = await client.executeCommand(command);

const undo = {
  operationId: crypto.randomUUID(),
  commandId: receipt.commandId,
  expectedStackVersion: receipt.stackVersion,
};
const undone = await client.undoCommand(undo);
await client.redoCommand({
  operationId: crypto.randomUUID(),
  commandId: receipt.commandId,
  expectedStackVersion: undone.stackVersion,
});
```

Retain the exact request and operation ID across an uncertain network retry.
Do not generate a new ID or replace its version preconditions automatically.
After a successful receipt, refetch canonical resources and stack state.
Receipts contain IDs and resulting versions, not content; a replay returns the
original receipt even when later mutations have advanced those versions.

## Conflicts and retries

The active stack retains at most 50 commands per user/workspace. Each command
references its before/after object revisions. Undo and Redo advance trusted
current-version expectations so consecutive inverses can run without treating
their own writes as collaborator conflicts.

A new command drops redo. If its input crosses an intervening untracked edit,
it also drops the reachable undo branch before adding the new command. This
conservative boundary prevents an older inverse from overwriting that edit
after the new command is undone. Dropping a branch never deletes durable history.

Out-of-band edits, including existing PATCH, restoration, scope changes, and
trash/recovery, invalidate affected inverse preconditions through object versions.
The stack query marks a conflicting undo unavailable and omits a stale redo.
An inverse request still checks live versions and fails with `409 version_conflict`.
Unrelated resource edits do not invalidate a command. A stale stack/head fails
with `409 command_stack_conflict`. Refresh state and ask for a new decision;
there is no automatic rebase or overwrite mode.

Operation IDs are scoped by user/workspace across all three mutation endpoints.
Matching retries return the same receipt without further writes; changed input
returns `409 command_conflict`. Current View permission on every affected object
is required even for receipt replay. Unavailable resources return the usual
generic 404. Stack heads require current Edit on every member and expose no
names, content, or historical permission data.

## Transactions and storage

The workspace authorization fence is acquired before reading the stack or
authorizing objects. All members require current Edit and an expected object
version. Typed services, revision writes, stack CAS, command records, and the
receipt audit commit together. A failure anywhere rolls the entire command back.
Command writes serialize within a workspace, including across users, following
the existing security-writer protocol. Direct object writers retain their CAS;
a racing edit makes the command fail without partial effects.

Migration `0009_add_reversible_commands.sql` adds:

- `command_stacks`: mutable heads and trusted object versions, scoped by user/workspace.
- `reversible_commands`: immutable command identities.
- `command_changes`: immutable same-workspace before/after revision references.
- `command_receipts`: immutable idempotency results linked to an audit event.

Object revisions retain mutation kind `updated`. Their associated audit metadata
includes command ID, operation ID, and `execute`, `undo`, or `redo` direction.
Each command also writes one `command.execute`, `command.undo`, or `command.redo`
audit with all resulting object versions. The existing History UI shows the new
revisions as edits; command-specific labels and controls are a separate UI step.

The migration is additive. Apply it before starting an API exposing these routes;
there is no new baseline or data backfill. Earlier API/web versions can continue
using their existing endpoints. Rolling back the API leaves command records
intact, but edits made during rollback can invalidate inverse preconditions.
There is no permanent command-history deletion or archival policy yet.
