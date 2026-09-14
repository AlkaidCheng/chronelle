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

// R3 evidence: can one gateway rpc call run an audited single-object
// mutation as a transaction? Requires the functions in
// infrastructure/cloudbase/rpc-probe.sql to be applied to the environment.
// The probe Event stays in staging soft-deleted, because its audit and
// revision rows are append-only by design.

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
    "The rpc contract mutates the CloudBase environment; set CLOUDBASE_CONTRACT_ALLOW_WRITES=true to run it against staging.",
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
const forbiddenUserId = process.env.CLOUDBASE_CONTRACT_FORBIDDEN_USER_ID;
const client = await connectCloudBaseRdb({
  envId: process.env.CLOUDBASE_ENV_ID,
  accessKey: process.env.CLOUDBASE_APIKEY,
  requestTimeoutMs,
});

const steps = [];
const startedAt = performance.now();
let probeId;

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

async function revisionCount() {
  const rows = await client.select("object_revisions", {
    columns: "object_version",
    filters: [
      { column: "workspace_id", operator: "eq", value: workspaceId },
      { column: "object_id", operator: "eq", value: probeId },
    ],
  });
  return rows.length;
}

async function currentVersion() {
  const [row] = await client.select("objects", {
    columns: "version,display_name",
    filters: [
      { column: "workspace_id", operator: "eq", value: workspaceId },
      { column: "id", operator: "eq", value: probeId },
    ],
  });
  return row;
}

const update = (args) =>
  client.rpc("chronelle_probe_update_event", {
    workspace_id: workspaceId,
    user_id: userId,
    request_id: createId(),
    object_id: probeId,
    ...args,
  });

try {
  await step("create through rpc", async () => {
    try {
      const created = await client.rpc("chronelle_probe_create_event", {
        workspace_id: workspaceId,
        user_id: userId,
        request_id: createId(),
        display_name: `R3 rpc probe ${createId()}`,
        timezone: "UTC",
      });
      probeId = created.id;
      return { version: created.version, revisions: await revisionCount() };
    } catch (error) {
      // The gateway prefixes PostgREST codes, for example DATABASE_PGRST202.
      if (
        error instanceof CloudBaseRpcError &&
        error.code.endsWith("PGRST202")
      ) {
        console.error(
          "The probe functions are not installed; apply infrastructure/cloudbase/rpc-probe.sql to the environment first.",
        );
        process.exit(2);
      }
      throw error;
    }
  });

  await step("update with the current version", async () => {
    const updated = await update({
      expected_version: 1,
      display_name: "R3 rpc probe v2",
    });
    if (updated.version !== 2)
      throw new Error("fresh update: version was not advanced to 2.");
    return { version: updated.version, revisions: await revisionCount() };
  });

  await step("update with a stale version", () =>
    expectRejection("stale update", () =>
      update({ expected_version: 1, display_name: "stale" }),
    ),
  );

  if (forbiddenUserId !== undefined) {
    await step("update as a principal without edit access", () =>
      expectRejection("forbidden update", () =>
        client.rpc("chronelle_probe_update_event", {
          workspace_id: workspaceId,
          user_id: forbiddenUserId,
          request_id: createId(),
          object_id: probeId,
          expected_version: 2,
          display_name: "forbidden",
        }),
      ),
    );
  }

  await step("raise after every write", async () => {
    const outcome = await expectRejection("injected failure", () =>
      update({
        expected_version: 2,
        display_name: "must not persist",
        fail_after: true,
      }),
    );
    const row = await currentVersion();
    const revisions = await revisionCount();
    if (row?.version !== 2 || row.display_name !== "R3 rpc probe v2")
      throw new Error("injected failure: the object changed.");
    if (revisions !== 2)
      throw new Error(`injected failure: ${revisions} revisions remain.`);
    return { ...outcome, version: row.version, revisions };
  });

  await step("race four rpc updates on one version", async () => {
    const results = await Promise.all(
      [1, 2, 3, 4].map((contender) =>
        update({
          expected_version: 2,
          display_name: `R3 rpc probe v3 by ${contender}`,
        }).then(
          (value) => ({ ok: true, value }),
          (error) => ({ ok: false, error }),
        ),
      ),
    );
    const winners = results.filter((result) => result.ok);
    const losers = results.filter((result) => !result.ok);
    if (winners.length !== 1)
      throw new Error(`race: ${winners.length} updates succeeded.`);
    for (const loser of losers) {
      if (!(loser.error instanceof CloudBaseRpcError)) throw loser.error;
    }
    const row = await currentVersion();
    if (row?.version !== 3 || row.display_name !== winners[0].value.displayName)
      throw new Error("race: the stored row does not match the winner.");
    return {
      contenders: results.length,
      winners: winners.length,
      loserCodes: losers.map((loser) => loser.error.code),
      version: 3,
      revisions: await revisionCount(),
    };
  });
} finally {
  if (probeId !== undefined) {
    await step("soft-delete probe", async () => {
      const rows = await client.update(
        "objects",
        { deleted_at: new Date().toISOString() },
        {
          filters: [
            { column: "workspace_id", operator: "eq", value: workspaceId },
            { column: "id", operator: "eq", value: probeId },
          ],
          columns: "id",
        },
      );
      return { affected: rows.length };
    });
  }
}

console.log(
  JSON.stringify(
    {
      workspaceId,
      probeId,
      capabilities: client.capabilities,
      steps,
      timingMs: { total: elapsedMs(startedAt) },
    },
    null,
    2,
  ),
);
exitAfterFlush(0);
