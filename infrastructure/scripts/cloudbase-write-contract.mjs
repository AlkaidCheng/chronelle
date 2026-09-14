import process from "node:process";

import { connectCloudBaseRdb, createId } from "../../packages/db/dist/index.js";
import {
  assertApiKeyFresh,
  exitAfterFlush,
  readRequestTimeout,
} from "./cloudbase-config.mjs";

// R2 evidence: can a single-object write through the gateway enforce an
// explicit version predicate? The harness creates one probe Event, exercises
// compare-and-set against it, and deletes it. It writes no audit rows: the
// transport has no transactions or server-side functions, so an audit record
// could only follow the update as a separate request, and that gap is the
// finding this report records.

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
    "The write contract mutates the CloudBase environment; set CLOUDBASE_CONTRACT_ALLOW_WRITES=true to run it against staging.",
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

const probeId = createId();
const probeName = `R2 write probe ${probeId}`;
const columns = "id,workspace_id,display_name,version,updated_at";
const byId = (version) => [
  { column: "workspace_id", operator: "eq", value: workspaceId },
  { column: "id", operator: "eq", value: probeId },
  { column: "version", operator: "eq", value: version },
];
const steps = [];
const startedAt = performance.now();

async function step(name, run) {
  const stepStartedAt = performance.now();
  const outcome = await run();
  steps.push({ name, ms: elapsedMs(stepStartedAt), ...outcome });
}

function elapsedMs(from) {
  return Math.max(0, Math.round(performance.now() - from));
}

function expectRows(label, rows, count) {
  if (rows.length !== count)
    throw new Error(
      `${label}: expected ${count} row(s), received ${rows.length}.`,
    );
}

let created = false;
try {
  await step("insert probe", async () => {
    const rows = await client.insert(
      "objects",
      [
        {
          id: probeId,
          workspace_id: workspaceId,
          object_type: "event",
          display_name: probeName,
          created_by: userId,
          permission_scope_id: probeId,
        },
      ],
      { columns },
    );
    expectRows("insert probe", rows, 1);
    created = true;
    await client.insert("events", [
      { object_id: probeId, workspace_id: workspaceId, timezone: "UTC" },
    ]);
    return { version: rows[0].version };
  });

  await step("update with the current version", async () => {
    const rows = await client.update(
      "objects",
      {
        display_name: `${probeName} v2`,
        version: 2,
        updated_at: new Date().toISOString(),
      },
      { filters: byId(1), columns },
    );
    expectRows("fresh update", rows, 1);
    if (rows[0].version !== 2)
      throw new Error("fresh update: version was not advanced to 2.");
    return { affected: rows.length, version: rows[0].version };
  });

  await step("update with a stale version", async () => {
    const rows = await client.update(
      "objects",
      { display_name: `${probeName} stale`, version: 2 },
      { filters: byId(1), columns },
    );
    expectRows("stale update", rows, 0);
    return { affected: rows.length, conflict: true };
  });

  await step("update with a foreign workspace predicate", async () => {
    const rows = await client.update(
      "objects",
      { display_name: `${probeName} foreign`, version: 3 },
      {
        filters: [
          { column: "workspace_id", operator: "eq", value: createId() },
          { column: "id", operator: "eq", value: probeId },
          { column: "version", operator: "eq", value: 2 },
        ],
        columns,
      },
    );
    expectRows("foreign workspace update", rows, 0);
    return { affected: rows.length };
  });

  await step("race four updates on the same version", async () => {
    const contenders = [1, 2, 3, 4];
    const results = await Promise.all(
      contenders.map((contender) =>
        client.update(
          "objects",
          {
            display_name: `${probeName} v3 by ${contender}`,
            version: 3,
            updated_at: new Date().toISOString(),
          },
          { filters: byId(2), columns },
        ),
      ),
    );
    const winners = results.filter((rows) => rows.length === 1);
    if (winners.length !== 1)
      throw new Error(
        `race: expected exactly one winner, ${winners.length} updates reported a row.`,
      );
    const [current] = await client.select("objects", {
      columns,
      filters: byId(3),
    });
    if (
      current === undefined ||
      current.display_name !== winners[0][0].display_name
    )
      throw new Error("race: the stored row does not match the single winner.");
    return {
      contenders: contenders.length,
      winners: winners.length,
      version: 3,
    };
  });

  await step("reject a constraint violation", async () => {
    try {
      await client.update(
        "objects",
        { version: 0 },
        { filters: byId(3), columns },
      );
    } catch (error) {
      const code = typeof error?.code === "string" ? error.code : "unknown";
      const [current] = await client.select("objects", {
        columns,
        filters: byId(3),
      });
      if (current === undefined)
        throw new Error(
          "constraint: the row changed despite the rejected write.",
        );
      return { rejected: true, code };
    }
    throw new Error("constraint: version 0 was accepted.");
  });
} finally {
  if (created) {
    await step("delete probe", async () => {
      const events = await client.delete("events", {
        filters: [
          { column: "workspace_id", operator: "eq", value: workspaceId },
          { column: "object_id", operator: "eq", value: probeId },
        ],
        columns: "object_id",
      });
      const objects = await client.delete("objects", {
        filters: [
          { column: "workspace_id", operator: "eq", value: workspaceId },
          { column: "id", operator: "eq", value: probeId },
        ],
        columns: "id",
      });
      const remaining = await client.select("objects", {
        columns: "id",
        filters: [{ column: "id", operator: "eq", value: probeId }],
      });
      expectRows("delete probe", remaining, 0);
      return { events: events.length, objects: objects.length };
    });
  }
}

console.log(
  JSON.stringify(
    {
      workspaceId,
      probeId,
      capabilities: client.capabilities,
      auditAtomicity:
        "unsupported: no transaction or server-side function on the gateway path, so an audit row could only follow the update as a separate request",
      steps,
      timingMs: { total: elapsedMs(startedAt) },
    },
    null,
    2,
  ),
);
exitAfterFlush(0);
