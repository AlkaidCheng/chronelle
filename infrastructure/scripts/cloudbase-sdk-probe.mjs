import process from "node:process";

const envId = process.env.CLOUDBASE_ENV_ID;
const apiKey = process.env.CLOUDBASE_APIKEY;

if (!envId || !apiKey) {
  console.error(
    "CLOUDBASE_ENV_ID and CLOUDBASE_APIKEY are required for the probe.",
  );
  process.exit(2);
}

const { default: cloudbase } = await import("@cloudbase/js-sdk");
const app = cloudbase.init({ env: envId, accessKey: apiKey });
const probeTable = "chronelle_connectivity_probe_87bb3e66_nonexistent";
const timeoutMs = readTimeout();
let timeout;
let result;
try {
  result = await Promise.race([
    app.rdb().from(probeTable).select("*").limit(0),
    new Promise((_, reject) => {
      timeout = setTimeout(
        () =>
          reject(
            new Error(`CloudBase SDK request timed out after ${timeoutMs}ms.`),
          ),
        timeoutMs,
      );
    }),
  ]);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "CloudBase SDK request failed.",
  );
  process.exit(1);
} finally {
  if (timeout !== undefined) clearTimeout(timeout);
}

if (result.error) {
  const code =
    typeof result.error.code === "string" ? result.error.code : "unknown";
  console.log(`CloudBase gateway responded with ${code}.`);
  console.log(
    "No records were requested; the probe table is intentionally nonexistent.",
  );
  if (code === "ACCESS_TOKEN_EXPIRED") {
    console.error(
      "Replace CLOUDBASE_APIKEY with a fresh short-lived server key and retry.",
    );
  } else if (code === "AUTHORIZATION_FAILED" || code === "UNAUTHORIZED") {
    console.error(
      "Check that CLOUDBASE_APIKEY belongs to the selected environment and has server-side RDB access.",
    );
  } else if (code !== "DATABASE_PGRST205") {
    console.error(
      "The gateway was reached, but the response did not prove the expected authenticated PostgreSQL path.",
    );
  }
  process.exitCode = code === "DATABASE_PGRST205" ? 0 : 1;
} else {
  console.error("The nonexistent probe table unexpectedly returned no error.");
  process.exitCode = 1;
}

function readTimeout() {
  const value = Number(process.env.CLOUDBASE_REQUEST_TIMEOUT_MS ?? 30_000);
  if (!Number.isInteger(value) || value < 1_000 || value > 120_000) {
    console.error(
      "CLOUDBASE_REQUEST_TIMEOUT_MS must be an integer between 1000 and 120000.",
    );
    process.exit(2);
  }
  return value;
}
