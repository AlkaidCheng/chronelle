import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import {
  assertCloudBaseApiKeyFresh,
  type CloudBaseRequestEvent,
  connectCloudBaseRdb,
} from "@chronelle/db";
import { z } from "zod";

import {
  cloudBaseBenchmarkWorkloads,
  type CloudBaseBenchmarkReport,
  type CloudBaseBenchmarkWorkload,
  runCloudBaseBenchmark,
} from "./cloudbase-benchmark.js";

const usage = `Usage: node dist/benchmark-cloudbase.js [options]

Options:
  --workload <name>  Run one workload; defaults to all
  --samples <count>  Measured samples from 3 to 30; defaults to 5
  --warmups <count>  Warm-up samples from 0 to 5; defaults to 1
  --json             Print the complete JSON report
  --help             Show this help

Workloads: ${cloudBaseBenchmarkWorkloads.join(", ")}`;

const { values } = parseArgs({
  options: {
    help: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    samples: { type: "string", default: "5" },
    warmups: { type: "string", default: "1" },
    workload: { type: "string" },
  },
  strict: true,
});

if (values.help) {
  console.log(usage);
  process.exit(0);
}

if (existsSync(".env")) process.loadEnvFile(".env");

const environment = z
  .object({
    CLOUDBASE_APIKEY: z.string().min(1),
    CLOUDBASE_ENV_ID: z.string().min(1),
    CLOUDBASE_REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .max(120_000)
      .default(30_000),
  })
  .parse(process.env);
const samples = z.coerce.number().int().min(3).max(30).parse(values.samples);
const warmups = z.coerce.number().int().min(0).max(5).parse(values.warmups);
const workload = z
  .enum(cloudBaseBenchmarkWorkloads)
  .optional()
  .parse(values.workload);
const selected: readonly CloudBaseBenchmarkWorkload[] =
  workload === undefined ? cloudBaseBenchmarkWorkloads : [workload];
assertCloudBaseApiKeyFresh(environment.CLOUDBASE_APIKEY);

const events: CloudBaseRequestEvent[] = [];
const client = await connectCloudBaseRdb({
  envId: environment.CLOUDBASE_ENV_ID,
  accessKey: environment.CLOUDBASE_APIKEY,
  requestTimeoutMs: environment.CLOUDBASE_REQUEST_TIMEOUT_MS,
  onRequest: (event) => events.push(event),
});

function rounded(value: number): string {
  return value.toFixed(1);
}

function print(report: CloudBaseBenchmarkReport): void {
  console.log(
    `CloudBase read benchmark (${report.samples} samples, ${report.warmups} warmups)`,
  );
  console.log("");
  console.log(
    "Workload                         p50 ms   p95 ms   calls   failures",
  );
  for (const result of report.results) {
    console.log(
      `${result.label.padEnd(32)} ${rounded(result.elapsedMs.median).padStart(7)}  ${rounded(result.elapsedMs.p95).padStart(7)}  ${rounded(result.gatewayCalls.median).padStart(6)}  ${rounded(result.failedCalls.maximum).padStart(9)}`,
    );
  }
  console.log("");
  console.log("Use --json for the complete report and per-target call counts.");
}

let code = 0;
try {
  const report = await runCloudBaseBenchmark({
    client,
    events,
    samples,
    warmups,
    workloads: selected,
  });
  if (values.json) console.log(JSON.stringify(report, null, 2));
  else print(report);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  code = 1;
}

// The CloudBase SDK keeps a timer alive, so flush output before terminating.
process.stdout.write("", () => process.exit(code));
