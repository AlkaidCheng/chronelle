import { createHash } from "node:crypto";
import process from "node:process";

import {
  CloudBaseRpcError,
  connectCloudBaseRdb,
  createId,
} from "../../packages/db/dist/index.js";
import {
  assertApiKeyFresh,
  exitAfterFlush,
  readRequestTimeout,
} from "./cloudbase-config.mjs";

// Cross-object evidence: one gateway rpc call creates a child on an Event's
// scope, the includes relation, both audit rows, and the command record, or
// none of them; the relation is then removed and recovered under its version
// predicate, the child is deleted and recovered the same way, its first
// revision is restored, it is moved to its own scope and back, the Event's
// page layout is saved and restored, and both probes are renamed as one
// reversible command that is replayed, undone, and redone. Exercises
// chronelle_event_context_create (migration 0016), chronelle_relation_lifecycle
// (0017), chronelle_object_delete and chronelle_object_recover (0018),
// chronelle_object_restore (0019), chronelle_object_scope_update (0020),
// chronelle_event_layout_update and chronelle_event_layout_restore (0022),
// chronelle_command_execute and chronelle_command_transition (0023),
// chronelle_command_state (0024), chronelle_storage_references (0025), the
// document transfer functions (0026), and chronelle_identity_sign_in (0027)
// against the real gateway. The
// transfer steps record the rows around a storage transfer without moving
// bytes: the finalized probe Document names a key that was never written. The probes end soft-deleted through the delete
// function, because their audit and revision rows are append-only.

const required = [
  "CLOUDBASE_ENV_ID",
  "CLOUDBASE_APIKEY",
  "CLOUDBASE_CONTRACT_WORKSPACE_ID",
  "CLOUDBASE_CONTRACT_USER_ID",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing CloudBase contract variables: ${missing.join(", ")}`);
  process.exit(2);
}
if (process.env.CLOUDBASE_CONTRACT_ALLOW_WRITES !== "true") {
  console.error(
    "The linked contract mutates the CloudBase environment; set CLOUDBASE_CONTRACT_ALLOW_WRITES=true to run it against staging.",
  );
  process.exit(2);
}

let requestTimeoutMs;
try {
  assertApiKeyFresh(process.env.CLOUDBASE_APIKEY);
  requestTimeoutMs = readRequestTimeout();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Invalid CloudBase configuration.",
  );
  process.exit(2);
}

const workspaceId = process.env.CLOUDBASE_CONTRACT_WORKSPACE_ID;
const userId = process.env.CLOUDBASE_CONTRACT_USER_ID;
const client = await connectCloudBaseRdb({
  envId: process.env.CLOUDBASE_ENV_ID,
  accessKey: process.env.CLOUDBASE_APIKEY,
  requestTimeoutMs,
});

const steps = [];
const startedAt = performance.now();
const probes = [];

async function step(name, run) {
  const stepStartedAt = performance.now();
  const outcome = await run();
  steps.push({ name, ms: elapsedMs(stepStartedAt), ...outcome });
}

function elapsedMs(from) {
  return Math.max(0, Math.round(performance.now() - from));
}

async function expectRejection(label, call) {
  try {
    await call();
  } catch (error) {
    if (error instanceof CloudBaseRpcError)
      return { rejected: true, status: error.status, code: error.code };
    throw error;
  }
  throw new Error(`${label}: the gateway accepted the call.`);
}

// The service's canonical request hash, so a replay is recognised.
function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    );
  return value;
}
function requestHash(eventId, resource, relationMetadata) {
  return createHash("sha256")
    .update(
      JSON.stringify(canonicalJson({ eventId, resource, relationMetadata })),
    )
    .digest("hex");
}
function commandHash(direction, input) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalJson({ direction, input })))
    .digest("hex");
}

async function countRows(table, filters) {
  const rows = await client.select(table, { columns: "id", filters });
  return rows.length;
}

async function linkedRows(eventId) {
  const scope = [
    { column: "workspace_id", operator: "eq", value: workspaceId },
  ];
  return {
    children: await countRows("objects", [
      ...scope,
      { column: "permission_scope_id", operator: "eq", value: eventId },
    ]),
    relations: await countRows("object_relations", [
      ...scope,
      { column: "source_object_id", operator: "eq", value: eventId },
    ]),
    relationAudits: await countRows("audit_events", [
      ...scope,
      { column: "resource_id", operator: "eq", value: eventId },
      { column: "action", operator: "eq", value: "relation.created" },
    ]),
  };
}

const linked = (eventId, commandId, resource, relationMetadata = {}, hash) =>
  client.rpc("chronelle_event_context_create", {
    workspace_id: workspaceId,
    user_id: userId,
    request_id: createId(),
    event_id: eventId,
    command_id: commandId,
    request_hash: hash ?? requestHash(eventId, resource, relationMetadata),
    resource,
    relation_metadata: relationMetadata,
  });

let eventId;
try {
  await step("create the context Event", async () => {
    try {
      const created = await client.rpc("chronelle_event_create", {
        workspace_id: workspaceId,
        user_id: userId,
        request_id: createId(),
        input: { displayName: `Linked probe ${createId()}` },
      });
      eventId = created.object.id;
      probes.push(eventId);
      return { eventId };
    } catch (error) {
      if (
        error instanceof CloudBaseRpcError &&
        error.code.endsWith("PGRST202")
      ) {
        console.error(
          "The write functions are not installed; apply migrations 0012 through 0016 to the environment first.",
        );
        process.exit(2);
      }
      throw error;
    }
  });

  const commandId = createId();
  const resource = {
    objectType: "task",
    displayName: "Linked probe task",
    dueAt: "2030-10-16T18:00:00.000Z",
  };
  let first;
  let linkedState;
  await step("create a linked Task through rpc", async () => {
    first = await linked(eventId, commandId, resource, { order: 1 });
    probes.push(first.resource.id);
    if (first.resource.permissionScopeId !== eventId)
      throw new Error("linked create: the child is not on the Event's scope.");
    linkedState = await linkedRows(eventId);
    return {
      childId: first.resource.id,
      relationId: first.relationId,
      ...linkedState,
    };
  });

  await step("replay the same command", async () => {
    const again = await linked(eventId, commandId, resource, { order: 1 });
    if (
      again.resource.id !== first.resource.id ||
      again.relationId !== first.relationId
    )
      throw new Error("replay: a different result was returned.");
    return { sameResult: true, ...(await linkedRows(eventId)) };
  });

  await step("reject the command with different input", async () => {
    const outcome = await expectRejection("command conflict", () =>
      linked(eventId, commandId, { ...resource, displayName: "Changed" }),
    );
    return { ...outcome, ...(await linkedRows(eventId)) };
  });

  await step("raise after every write", async () => {
    // The command record's hash check fails last, after the child, the
    // relation, and both audit rows were written inside the function.
    const outcome = await expectRejection("injected failure", () =>
      linked(eventId, createId(), resource, {}, "not-a-hash"),
    );
    // Counts are compared with the state after the first create; the
    // self-scoped Event counts itself among the objects on its scope.
    const rows = await linkedRows(eventId);
    if (JSON.stringify(rows) !== JSON.stringify(linkedState))
      throw new Error("injected failure: rows were persisted.");
    return { ...outcome, ...rows };
  });

  const lifecycle = (expectedVersion, deletedAt) =>
    client.rpc("chronelle_relation_lifecycle", {
      workspace_id: workspaceId,
      user_id: userId,
      request_id: createId(),
      relation_id: first.relationId,
      expected_version: expectedVersion,
      deleted_at: deletedAt,
    });

  await step("remove the relation", async () => {
    const removed = await lifecycle(1, new Date().toISOString());
    if (removed.version !== 2 || removed.deleted_at === null)
      throw new Error("remove: the relation was not removed at version 2.");
    return { version: removed.version };
  });

  await step("remove with a stale version", () =>
    expectRejection("stale removal", () =>
      lifecycle(1, new Date().toISOString()),
    ),
  );

  await step("recover the relation", async () => {
    const recovered = await lifecycle(2, null);
    if (recovered.version !== 3 || recovered.deleted_at !== null)
      throw new Error("recover: the relation was not recovered at version 3.");
    return { version: recovered.version };
  });

  const objectLifecycle = (
    functionName,
    objectId,
    expectedVersion,
    extra = {},
  ) =>
    client.rpc(functionName, {
      workspace_id: workspaceId,
      user_id: userId,
      request_id: createId(),
      object_id: objectId,
      expected_version: expectedVersion,
      ...extra,
    });

  await step("delete the child", async () => {
    const deletion = await objectLifecycle(
      "chronelle_object_delete",
      first.resource.id,
      1,
      { deleted_at: new Date().toISOString() },
    );
    if (deletion.version !== 2)
      throw new Error("delete: the child was not deleted at version 2.");
    return { version: deletion.version };
  });

  // A deleted object is no longer deletable, so this is refused as
  // unavailable rather than as a stale version.
  await step("delete the deleted child", () =>
    expectRejection("repeated deletion", () =>
      objectLifecycle("chronelle_object_delete", first.resource.id, 1, {
        deleted_at: new Date().toISOString(),
      }),
    ),
  );

  await step("recover the child", async () => {
    const rows = await objectLifecycle(
      "chronelle_object_recover",
      first.resource.id,
      2,
    );
    if (rows.object.version !== 3 || rows.object.deleted_at !== null)
      throw new Error("recover: the child was not recovered at version 3.");
    return { version: rows.object.version };
  });

  await step("restore the child's first revision", async () => {
    // The application's restoration policy selects the content; here the
    // version-1 snapshot's name and Task fields stand in for it.
    const [revision] = await client.select("object_revisions", {
      columns: "id,snapshot",
      filters: [
        { column: "workspace_id", operator: "eq", value: workspaceId },
        { column: "object_id", operator: "eq", value: first.resource.id },
        { column: "object_version", operator: "eq", value: 1 },
      ],
    });
    if (revision === undefined)
      throw new Error("restore: the first revision is missing.");
    const { displayName, customProperties, status, dueAt, completedAt } =
      revision.snapshot;
    const rows = await objectLifecycle(
      "chronelle_object_restore",
      first.resource.id,
      3,
      {
        source_revision_id: revision.id,
        source_version: 1,
        content: {
          displayName: `${displayName} (restored)`,
          customProperties,
          status,
          dueAt,
          completedAt,
        },
      },
    );
    if (rows.object.version !== 4)
      throw new Error("restore: the child was not restored at version 4.");
    return { version: rows.object.version };
  });

  const moveScope = (expectedVersion, permissionScopeId) =>
    client.rpc("chronelle_object_scope_update", {
      workspace_id: workspaceId,
      user_id: userId,
      request_id: createId(),
      object_id: first.resource.id,
      expected_version: expectedVersion,
      permission_scope_id: permissionScopeId,
      updated_at: new Date().toISOString(),
    });

  await step("detach the child from the Event's scope", async () => {
    const rows = await moveScope(4, first.resource.id);
    if (
      rows.object.version !== 5 ||
      rows.object.permission_scope_id !== first.resource.id
    )
      throw new Error("scope: the child was not detached at version 5.");
    return { version: rows.object.version };
  });

  await step("reject a scope change with a stale version", () =>
    expectRejection("stale scope change", () => moveScope(4, eventId)),
  );

  await step("attach the child to the Event's scope again", async () => {
    const rows = await moveScope(5, eventId);
    if (
      rows.object.version !== 6 ||
      rows.object.permission_scope_id !== eventId
    )
      throw new Error("scope: the child was not attached at version 6.");
    return { version: rows.object.version };
  });

  const layoutPages = [
    {
      id: createId(),
      name: "Overview",
      components: [{ id: createId(), kind: "calendar" }],
    },
  ];
  await step("save the Event's layout", async () => {
    const layout = await client.rpc("chronelle_event_layout_update", {
      workspace_id: workspaceId,
      user_id: userId,
      request_id: createId(),
      event_id: eventId,
      expected_version: 0,
      pages: layoutPages,
    });
    if (layout.version !== 1 || layout.pages.length !== 1)
      throw new Error("layout: the first version was not saved.");
    return { version: layout.version };
  });

  await step("restore the empty layout", async () => {
    const layout = await client.rpc("chronelle_event_layout_restore", {
      workspace_id: workspaceId,
      user_id: userId,
      request_id: createId(),
      event_id: eventId,
      expected_version: 1,
      target_version: 0,
    });
    if (layout.version !== 2 || layout.pages.length !== 0)
      throw new Error(
        "layout: the empty layout was not restored at version 2.",
      );
    return { version: layout.version };
  });

  // Both probes renamed as one reversible command. The stack belongs to the
  // contract user, so its version and the probes' versions are read first.
  const probeState = async () => {
    const rows = await client.select("objects", {
      columns: "id,version,display_name",
      filters: [
        { column: "workspace_id", operator: "eq", value: workspaceId },
        { column: "id", operator: "in", value: [eventId, first.resource.id] },
      ],
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      event: byId.get(eventId),
      child: byId.get(first.resource.id),
    };
  };
  const transition = (direction, input) =>
    client.rpc("chronelle_command_transition", {
      workspace_id: workspaceId,
      user_id: userId,
      request_id: createId(),
      operation_id: input.operationId,
      command_id: input.commandId,
      expected_stack_version: input.expectedStackVersion,
      direction,
      request_hash: commandHash(direction, input),
    });
  const commandState = () =>
    client.rpc("chronelle_command_state", {
      workspace_id: workspaceId,
      user_id: userId,
    });
  let stackVersion;
  let commandRequest;
  let executed;
  await step("rename both probes as one command", async () => {
    const [stack] = await client.select("command_stacks", {
      columns: "version",
      filters: [
        { column: "workspace_id", operator: "eq", value: workspaceId },
        { column: "user_id", operator: "eq", value: userId },
      ],
    });
    stackVersion = stack?.version ?? 0;
    const before = await probeState();
    commandRequest = {
      operationId: createId(),
      expectedStackVersion: stackVersion,
      edits: [
        {
          objectType: "event",
          objectId: eventId,
          patch: {
            expectedVersion: before.event.version,
            displayName: `${before.event.display_name} (command)`,
          },
        },
        {
          objectType: "task",
          objectId: first.resource.id,
          patch: {
            expectedVersion: before.child.version,
            displayName: `${before.child.display_name} (command)`,
          },
        },
      ],
    };
    executed = await client.rpc("chronelle_command_execute", {
      workspace_id: workspaceId,
      user_id: userId,
      request_id: createId(),
      operation_id: commandRequest.operationId,
      expected_stack_version: stackVersion,
      edits: commandRequest.edits,
      request_hash: commandHash("execute", commandRequest),
    });
    const after = await probeState();
    if (
      executed.direction !== "execute" ||
      executed.stackVersion !== stackVersion + 1 ||
      executed.objects.length !== 2 ||
      after.event.version !== before.event.version + 1 ||
      after.child.version !== before.child.version + 1 ||
      !after.child.display_name.endsWith("(command)")
    )
      throw new Error("command: the edits were not applied as one command.");
    return { stackVersion: executed.stackVersion };
  });

  await step("replay the command", async () => {
    const again = await client.rpc("chronelle_command_execute", {
      workspace_id: workspaceId,
      user_id: userId,
      request_id: createId(),
      operation_id: commandRequest.operationId,
      expected_stack_version: stackVersion,
      edits: commandRequest.edits,
      request_hash: commandHash("execute", commandRequest),
    });
    if (JSON.stringify(again) !== JSON.stringify(executed))
      throw new Error("command: the replay returned a different receipt.");
    return { replayed: true };
  });

  await step("undo the command", async () => {
    const receipt = await transition("undo", {
      operationId: createId(),
      commandId: commandRequest.operationId,
      expectedStackVersion: stackVersion + 1,
    });
    const state = await probeState();
    if (
      receipt.direction !== "undo" ||
      receipt.stackVersion !== stackVersion + 2 ||
      state.child.display_name.endsWith("(command)")
    )
      throw new Error("command: the undo did not restore both probes.");
    return { stackVersion: receipt.stackVersion };
  });

  await step("read the state after the undo", async () => {
    const state = await commandState();
    if (
      state.version !== stackVersion + 2 ||
      state.undo !== null ||
      state.redo?.commandId !== commandRequest.operationId ||
      state.redo.available !== true
    )
      throw new Error("command state: the redo head is not the command.");
    return { version: state.version, redo: state.redo.commandId };
  });

  await step("reject a redo with a stale stack version", () =>
    expectRejection("stale redo", () =>
      transition("redo", {
        operationId: createId(),
        commandId: commandRequest.operationId,
        expectedStackVersion: stackVersion + 1,
      }),
    ),
  );

  await step("redo the command", async () => {
    const receipt = await transition("redo", {
      operationId: createId(),
      commandId: commandRequest.operationId,
      expectedStackVersion: stackVersion + 2,
    });
    const state = await probeState();
    if (
      receipt.direction !== "redo" ||
      receipt.stackVersion !== stackVersion + 3 ||
      !state.child.display_name.endsWith("(command)")
    )
      throw new Error("command: the redo did not reapply both probes.");
    return { stackVersion: receipt.stackVersion };
  });

  await step("read the state after the redo", async () => {
    const state = await commandState();
    if (
      state.version !== stackVersion + 3 ||
      state.redo !== null ||
      state.undo?.commandId !== commandRequest.operationId ||
      state.undo.available !== true
    )
      throw new Error("command state: the undo head is not the command.");
    return { version: state.version, undo: state.undo.commandId };
  });

  // A document transfer without bytes: the authorization, its consumption,
  // the finalization into an attached Document, and a download authorization
  // consumed once. The Document joins the probes retired at the end.
  const transferId = createId();
  const documentId = createId();
  const documentKey = `workspaces/${workspaceId}/documents/${transferId}`;
  const checksum = "0".repeat(64);
  const at = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
  const authorize = (transfer) =>
    client.rpc("chronelle_document_transfer_authorize", {
      workspace_id: workspaceId,
      user_id: userId,
      request_id: createId(),
      transfer,
    });
  const consume = (id, operation) =>
    client.rpc("chronelle_document_transfer_consume", {
      transfer_id: id,
      operation,
      consumed_at: at(0),
      request_id: createId(),
    });
  await step("authorize an upload to the Event", async () => {
    await authorize({
      id: transferId,
      operation: "upload",
      tokenHash: createHash("sha256").update(transferId).digest("hex"),
      resourceId: eventId,
      storageProvider: "local-filesystem",
      storageKey: documentKey,
      originalFilename: "probe.txt",
      mimeType: "text/plain",
      sizeBytes: "5",
      checksumSha256: checksum,
      createdAt: at(0),
      expiresAt: at(300_000),
    });
    return { transferId };
  });
  await step("consume the upload", async () => {
    await consume(transferId, "upload");
    return { consumed: true };
  });
  await step("reject a second consumption", () =>
    expectRejection("consumed upload", () => consume(transferId, "upload")),
  );
  await step("finalize the upload into a Document", async () => {
    const attachment = await client.rpc("chronelle_document_finalize", {
      workspace_id: workspaceId,
      user_id: userId,
      request_id: createId(),
      transfer_id: transferId,
      document_id: documentId,
      relation_id: createId(),
      finalized_at: at(0),
      encryption_mode: "filesystem-permissions",
    });
    probes.push(documentId);
    if (
      attachment.document?.object?.id !== documentId ||
      attachment.document?.document?.storage_key !== documentKey ||
      attachment.relationVersion !== 1
    )
      throw new Error("finalize: the Document was not attached at version 1.");
    return { documentId, relationId: attachment.relationId };
  });
  await step("reject a second finalization", () =>
    expectRejection("finalized upload", () =>
      client.rpc("chronelle_document_finalize", {
        workspace_id: workspaceId,
        user_id: userId,
        request_id: createId(),
        transfer_id: transferId,
        document_id: createId(),
        relation_id: createId(),
        finalized_at: at(0),
        encryption_mode: "filesystem-permissions",
      }),
    ),
  );
  const downloadId = createId();
  await step("authorize and consume a download", async () => {
    await authorize({
      id: downloadId,
      operation: "download",
      tokenHash: createHash("sha256").update(downloadId).digest("hex"),
      resourceId: documentId,
      storageProvider: "local-filesystem",
      storageKey: documentKey,
      originalFilename: "probe.txt",
      mimeType: "text/plain",
      sizeBytes: "5",
      checksumSha256: checksum,
      createdAt: at(0),
      expiresAt: at(300_000),
    });
    await consume(downloadId, "download");
    return { downloadId };
  });

  await step("read the layout history through the table route", async () => {
    const revisions = await client.select("event_page_revisions", {
      columns: "version,pages,created_at",
      filters: [
        { column: "workspace_id", operator: "eq", value: workspaceId },
        { column: "event_id", operator: "eq", value: eventId },
      ],
      order: [{ column: "version", ascending: false }],
    });
    if (revisions.length !== 2 || revisions[0].version !== 2)
      throw new Error("layout history: expected versions 2 and 1.");
    return { versions: revisions.map((revision) => revision.version) };
  });

  await step("sign the contract user in again", async () => {
    const [user] = await client.select("users", {
      columns: "identity_provider,provider_subject,email,display_name",
      filters: [{ column: "id", operator: "eq", value: userId }],
      limit: 1,
    });
    if (user === undefined)
      throw new Error("sign-in: the contract user is missing.");
    const signedIn = await client.rpc("chronelle_identity_sign_in", {
      identity_provider: user.identity_provider,
      provider_subject: user.provider_subject,
      email: user.email,
      display_name: user.display_name,
      request_id: createId(),
    });
    if (signedIn.user?.id !== userId || signedIn.createdWorkspace !== false)
      throw new Error("sign-in: the existing user was not recognised.");
    return {
      createdWorkspace: signedIn.createdWorkspace,
      personalWorkspace: signedIn.workspace?.id === workspaceId,
    };
  });

  await step("read the storage references", async () => {
    const references = await client.rpc("chronelle_storage_references", {
      workspace_id: workspaceId,
      user_id: userId,
      storage_provider: "local-filesystem",
      observed_at: new Date().toISOString(),
      row_limit: 100,
    });
    if (
      !Array.isArray(references.canonical) ||
      !Array.isArray(references.revisions) ||
      !Array.isArray(references.uploads)
    )
      throw new Error("storage references: the sets are not lists.");
    return {
      canonical: references.canonical.length,
      revisions: references.revisions.length,
      uploads: references.uploads.length,
    };
  });
} finally {
  if (probes.length > 0) {
    await step("delete the probes", async () => {
      const deleted = [];
      for (const objectId of probes.reverse()) {
        const [row] = await client.select("objects", {
          columns: "version,deleted_at",
          filters: [
            { column: "workspace_id", operator: "eq", value: workspaceId },
            { column: "id", operator: "eq", value: objectId },
          ],
        });
        if (row === undefined || row.deleted_at !== null) continue;
        await client.rpc("chronelle_object_delete", {
          workspace_id: workspaceId,
          user_id: userId,
          request_id: createId(),
          object_id: objectId,
          expected_version: row.version,
          deleted_at: new Date().toISOString(),
        });
        deleted.push(objectId);
      }
      return { affected: deleted.length };
    });
  }
}

console.log(
  JSON.stringify(
    {
      workspaceId,
      eventId,
      capabilities: client.capabilities,
      steps,
      timingMs: { total: elapsedMs(startedAt) },
    },
    null,
    2,
  ),
);
exitAfterFlush(0);
