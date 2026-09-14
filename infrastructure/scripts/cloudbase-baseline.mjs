import process from "node:process";

import { connectCloudBaseRdb } from "../../packages/db/dist/index.js";
import {
  assertApiKeyFresh,
  exitAfterFlush,
  readRequestTimeout,
} from "./cloudbase-config.mjs";

// Captures the revision baseline through the gateway: every canonical object
// whose current version has no revision receives its baseline revision, as
// db:baseline-revisions does through a PostgreSQL connection. Stop all API
// writers first. Exercises chronelle_revision_baseline (migration 0029).

const required = ["CLOUDBASE_ENV_ID", "CLOUDBASE_APIKEY"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing CloudBase variables: ${missing.join(", ")}`);
  process.exit(2);
}
if (process.env.CLOUDBASE_CONTRACT_ALLOW_WRITES !== "true") {
  console.error(
    "The baseline writes revisions; set CLOUDBASE_CONTRACT_ALLOW_WRITES=true to run it.",
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

const client = await connectCloudBaseRdb({
  envId: process.env.CLOUDBASE_ENV_ID,
  accessKey: process.env.CLOUDBASE_APIKEY,
  requestTimeoutMs,
});
const startedAt = performance.now();
const captured = await client.rpc("chronelle_revision_baseline", {});
const readiness = await client.rpc("chronelle_backend_readiness", {});
console.log(
  JSON.stringify(
    {
      captured,
      objectsWithoutBaseline: readiness.objectsWithoutBaseline,
      timingMs: Math.round(performance.now() - startedAt),
    },
    null,
    2,
  ),
);
exitAfterFlush(0);
