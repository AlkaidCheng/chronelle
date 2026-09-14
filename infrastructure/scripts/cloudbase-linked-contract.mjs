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
// predicate, the child is deleted and recovered the same way, and its first
// revision is restored. Exercises chronelle_event_context_create (migration
// 0016), chronelle_relation_lifecycle (0017), chronelle_object_delete and
// chronelle_object_recover (0018), and chronelle_object_restore (0019)
// against the real gateway. The probes end soft-deleted through the delete
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
