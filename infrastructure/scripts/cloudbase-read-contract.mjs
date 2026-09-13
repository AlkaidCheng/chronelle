import process from "node:process";

import { AuthorizationDeniedError } from "../../packages/authorization/dist/index.js";
import { connectCloudBaseRdb } from "../../packages/db/dist/index.js";
import {
  assertApiKeyFresh,
  exitAfterFlush,
  readPageLimit,
  readRequestTimeout,
} from "./cloudbase-config.mjs";
import {
  CloudBaseCalendarReadRepository,
  CloudBaseEventReadRepository,
} from "../../packages/object-model/dist/index.js";

const required = [
  "CLOUDBASE_ENV_ID",
  "CLOUDBASE_APIKEY",
  "CLOUDBASE_CONTRACT_WORKSPACE_ID",
  "CLOUDBASE_CONTRACT_USER_ID",
  "CLOUDBASE_CONTRACT_EVENT_ID",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing CloudBase contract variables: ${missing.join(", ")}`);
  process.exit(2);
}

let requestTimeoutMs;
let pageLimit;
try {
  assertApiKeyFresh(process.env.CLOUDBASE_APIKEY);
  requestTimeoutMs = readRequestTimeout();
  pageLimit = readPageLimit();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Invalid CloudBase configuration.",
  );
  process.exit(2);
}

const workspaceId = process.env.CLOUDBASE_CONTRACT_WORKSPACE_ID;
const userId = process.env.CLOUDBASE_CONTRACT_USER_ID;
const eventId = process.env.CLOUDBASE_CONTRACT_EVENT_ID;
const principal = { type: "user", userId, workspaceId };
const client = await connectCloudBaseRdb({
  envId: process.env.CLOUDBASE_ENV_ID,
  accessKey: process.env.CLOUDBASE_APIKEY,
  requestTimeoutMs,
});
const eventReads = new CloudBaseEventReadRepository(client);
const calendarReads = new CloudBaseCalendarReadRepository(client);
const contractStartedAt = performance.now();

// Walk every page so the exact-set and overlap checks cover the whole
// collection; the bound only guards against a cursor that never ends.
const maxPages = 100;
const pages = [];
const items = [];
let cursor;
do {
  const startedAt = performance.now();
  const page = await eventReads.listEvents(principal, {
    cursor,
    limit: pageLimit,
    sort: "date",
  });
  pages.push({ count: page.items.length, ms: elapsedMs(startedAt) });
  items.push(...page.items);
  if (page.items.length > pageLimit)
    throw new Error("CloudBase returned more events than the page limit.");
  if (page.nextCursor !== null && page.items.length === 0)
    throw new Error("CloudBase returned an empty page with a next cursor.");
  cursor = page.nextCursor ?? undefined;
} while (cursor !== undefined && pages.length < maxPages);
if (cursor !== undefined)
  throw new Error(
    `CloudBase event paging did not end within ${maxPages} pages.`,
  );
const calendarStartedAt = performance.now();
const calendar = await calendarReads.listCalendarEvents(principal, eventId);
const calendarMs = elapsedMs(calendarStartedAt);
const allIds = items.map(({ id }) => id);
if (new Set(allIds).size !== allIds.length)
  throw new Error("CloudBase event cursor pages overlap.");

for (const resource of [...items, ...calendar]) {
  if (resource.workspaceId !== workspaceId)
    throw new Error(
      `CloudBase returned a cross-workspace resource: ${resource.id}`,
    );
  if (resource.deletedAt !== null)
    throw new Error(`CloudBase returned a deleted resource: ${resource.id}`);
  if (resource.objectType !== "event")
    throw new Error(`CloudBase returned a non-event resource: ${resource.id}`);
}

assertExactIds(
  "event",
  allIds,
  process.env.CLOUDBASE_CONTRACT_EXPECTED_EVENT_IDS,
);
assertExactIds(
  "calendar event",
  calendar.map(({ id }) => id),
  process.env.CLOUDBASE_CONTRACT_EXPECTED_CALENDAR_IDS,
);

const deniedEventId = process.env.CLOUDBASE_CONTRACT_DENIED_EVENT_ID;
if (deniedEventId !== undefined) {
  try {
    await calendarReads.listCalendarEvents(principal, deniedEventId);
    throw new Error("The denied CloudBase event unexpectedly returned data.");
  } catch (error) {
    if (!(error instanceof AuthorizationDeniedError)) throw error;
  }
}

console.log(
  JSON.stringify(
    {
      workspaceId,
      eventCount: allIds.length,
      calendarCount: calendar.length,
      pageLimit,
      pageCount: pages.length,
      cursorPageTested: pages.length > 1,
      queryCount: pages.length + 1,
      timingMs: {
        eventPages: pages.map(({ ms }) => ms),
        calendar: calendarMs,
        total: elapsedMs(contractStartedAt),
      },
      eventIds: allIds,
      calendarIds: calendar.map(({ id }) => id),
    },
    null,
    2,
  ),
);
exitAfterFlush(0);

function elapsedMs(startedAt) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

/** An expectation, when configured, is the complete set: extras fail like omissions. */
function assertExactIds(label, actualIds, expected) {
  const expectedIds = (expected ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (expectedIds.length === 0) return;
  const actual = new Set(actualIds);
  const missing = expectedIds.filter((id) => !actual.has(id));
  const unexpected = actualIds.filter((id) => !expectedIds.includes(id));
  if (missing.length > 0)
    throw new Error(
      `Expected CloudBase ${label}s were not returned: ${missing.join(", ")}`,
    );
  if (unexpected.length > 0)
    throw new Error(
      `CloudBase returned ${label}s outside the expected set: ${unexpected.join(", ")}`,
    );
}
