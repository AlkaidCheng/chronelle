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
const result = await Promise.race([
  app.rdb().from(probeTable).select("*").limit(0),
  new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error("CloudBase SDK request timed out.")),
      30_000,
    ),
  ),
]);

if (result.error) {
  const code =
    typeof result.error.code === "string" ? result.error.code : "unknown";
  console.log(`CloudBase gateway responded with ${code}.`);
  console.log(
    "No records were requested; the probe table is intentionally nonexistent.",
  );
  process.exitCode = code === "DATABASE_PGRST205" ? 0 : 1;
} else {
  console.error("The nonexistent probe table unexpectedly returned no error.");
  process.exitCode = 1;
}
