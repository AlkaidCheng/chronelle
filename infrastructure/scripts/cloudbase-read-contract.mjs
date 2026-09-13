import process from "node:process";

import { AuthorizationDeniedError } from "../../packages/authorization/dist/index.js";
import { connectCloudBaseRdb } from "../../packages/db/dist/index.js";
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

const workspaceId = process.env.CLOUDBASE_CONTRACT_WORKSPACE_ID;
const userId = process.env.CLOUDBASE_CONTRACT_USER_ID;
const eventId = process.env.CLOUDBASE_CONTRACT_EVENT_ID;
const principal = { type: "user", userId, workspaceId };
const client = await connectCloudBaseRdb({
  envId: process.env.CLOUDBASE_ENV_ID,
  accessKey: process.env.CLOUDBASE_APIKEY,
});
const eventReads = new CloudBaseEventReadRepository(client);
const calendarReads = new CloudBaseCalendarReadRepository(client);

const firstPage = await eventReads.listEvents(principal, {
  limit: 50,
  sort: "date",
});
const calendar = await calendarReads.listCalendarEvents(principal, eventId);
const secondPage =
  firstPage.nextCursor === null
    ? { items: [] }
    : await eventReads.listEvents(principal, {
        cursor: firstPage.nextCursor,
        limit: 50,
        sort: "date",
      });
const allIds = [...firstPage.items, ...secondPage.items].map(({ id }) => id);
if (new Set(allIds).size !== allIds.length)
  throw new Error("CloudBase event cursor pages overlap.");

for (const resource of [...firstPage.items, ...secondPage.items, ...calendar]) {
  if (resource.workspaceId !== workspaceId)
    throw new Error(
      `CloudBase returned a cross-workspace resource: ${resource.id}`,
    );
  if (resource.deletedAt !== null)
    throw new Error(`CloudBase returned a deleted resource: ${resource.id}`);
  if (resource.objectType !== "event")
    throw new Error(`CloudBase returned a non-event resource: ${resource.id}`);
}

const expectedEventIds = (
  process.env.CLOUDBASE_CONTRACT_EXPECTED_EVENT_IDS ?? ""
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
for (const expectedId of expectedEventIds) {
  if (!new Set(allIds).has(expectedId))
    throw new Error(`Expected CloudBase event was not returned: ${expectedId}`);
}

const expectedCalendarIds = (
  process.env.CLOUDBASE_CONTRACT_EXPECTED_CALENDAR_IDS ?? ""
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const calendarIds = new Set(calendar.map(({ id }) => id));
for (const expectedId of expectedCalendarIds) {
  if (!calendarIds.has(expectedId))
    throw new Error(
      `Expected CloudBase calendar event was not returned: ${expectedId}`,
    );
}

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
      cursorPageTested: firstPage.nextCursor !== null,
      eventIds: allIds,
      calendarIds: calendar.map(({ id }) => id),
    },
    null,
    2,
  ),
);
