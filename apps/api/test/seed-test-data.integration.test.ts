import { resolve } from "node:path";

import { disconnectedDatabase } from "@livtales/db";
import {
  applyMigrations,
  createCloudBaseLiveReader,
  createCloudBaseRpcDouble,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { createAppDependencies } from "../src/dependencies.js";
import { RecordingEmailSender } from "../src/seed/recording-email-sender.js";
import { seedAccounts, seedTestData } from "../src/seed/test-data.js";

const migrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);
const password = "correct horse battery";
const webBaseUrl = "https://livtales.example";

// The seed goes through the HTTP contract, so it is run on both backends:
// the PostgreSQL app, and the app composed for the gateway with the rpc
// functions called locally. Every write of the ported families goes
// through a function; the RDB write transport is never reached.
const transportWrite = () =>
  Promise.reject(new Error("The seed writes through the rpc functions."));
const backends = {
  postgres: (database: TestDatabase, email: RecordingEmailSender) =>
    createAppDependencies(database.connection, undefined, {
      email,
      friends: { webBaseUrl },
    }),
  cloudbase: (database: TestDatabase, email: RecordingEmailSender) =>
    createAppDependencies(disconnectedDatabase("the seed test"), undefined, {
      cloudBaseRdb: {
        ...createCloudBaseLiveReader(database.connection.db),
        rpc: createCloudBaseRpcDouble(database.connection.sql),
        insert: transportWrite,
        update: transportWrite,
        delete: transportWrite,
      },
      cloudBaseWrites: true,
      email,
      friends: { webBaseUrl },
    }),
};

let database: TestDatabase;
let app: FastifyInstance;
let email: RecordingEmailSender;

beforeEach(async () => {
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    migrationDirectory,
  );
  email = new RecordingEmailSender();
});

afterEach(async () => {
  await app.close();
  await database.close();
});

async function signIn(username: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in",
    payload: { login: username, password },
  });
  expect(response.statusCode).toBe(200);
  const session = response.json() as {
    accessToken: string;
    user: { id: string; onboardedAt: string | null; locale: string | null };
    workspace: { id: string };
  };
  return {
    headers: { authorization: `Bearer ${session.accessToken}` },
    user: session.user,
    workspaceId: session.workspace.id,
  };
}

// The seed makes a few hundred requests; on the gateway double every read
// snapshots the database again, which takes well over vitest's default.
const seedTimeout = 120_000;

describe.each(Object.entries(backends))(
  "the test data seed on %s",
  (_backend, compose) => {
    it(
      "creates the three accounts and their data once, and leaves an existing set alone",
      { timeout: seedTimeout },
      async () => {
        app = buildApp(compose(database, email));
        const today = new Date("2026-09-19T03:00:00.000Z");
        const report = await seedTestData(app, email, { password, today });
        expect(report.accounts.map((account) => account.status)).toEqual([
          "created",
          "created",
          "created",
        ]);
        expect(report.invitationLink).toMatch(
          new RegExp(`^${webBaseUrl}/invite/[A-Za-z0-9_-]{16,}$`, "u"),
        );
        expect(report.created).toMatchObject({
          event: expect.any(Number),
          task: expect.any(Number),
          person: 3,
          note: 5,
          label: 3,
        });
        expect(report.created.event).toBeGreaterThanOrEqual(20);

        // Mei: past the Welcome step, a friend of Kai, asked by Ana, an
        // emailed invitation and a link waiting; three events of her own.
        const mei = await signIn("mei-lin");
        expect(mei.user.onboardedAt).not.toBeNull();
        const friends = (
          await app.inject({
            method: "GET",
            url: "/api/friends",
            headers: mei.headers,
          })
        ).json() as {
          friends: { displayName: string }[];
          incoming: { requester: { displayName: string } }[];
          sent: {
            kind: string;
            channel: string | null;
            email: string | null;
          }[];
        };
        expect(friends.friends.map((friend) => friend.displayName)).toEqual([
          "Kai Tanaka",
        ]);
        expect(friends.incoming.map((r) => r.requester.displayName)).toEqual([
          "Ana Souza",
        ]);
        expect(friends.sent).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ channel: "link", email: null }),
            expect.objectContaining({
              channel: "email",
              email: "tanaka.family@example.com",
            }),
          ]),
        );
        const events = (
          await app.inject({
            method: "GET",
            url: "/api/events?query=&scope=mine&filter=all&sort=date",
            headers: mei.headers,
          })
        ).json() as {
          items: { displayName: string; location: string | null }[];
        };
        expect(events.items.map((event) => event.displayName).sort()).toEqual([
          "Kyoto in November",
          "Quarterly budget review",
          "Team offsite",
        ]);
        // Kai's share reaches Mei's own list beside her events.
        const shared = (
          await app.inject({
            method: "GET",
            url: "/api/events?query=&scope=shared&filter=all&sort=date",
            headers: mei.headers,
          })
        ).json() as {
          items: {
            displayName: string;
            access: { sharedBy: { displayName: string } | null };
          }[];
        };
        expect(
          shared.items.map((event) => [
            event.displayName,
            event.access.sharedBy?.displayName,
          ]),
        ).toEqual([["Kai's birthday dinner", "Kai Tanaka"]]);

        // Kyoto: the itinerary carries the places, a share waits on the
        // Tanakas, Trash holds the dropped task, the note has two versions.
        const kyoto = events.items.find(
          (e) => e.displayName === "Kyoto in November",
        );
        const kyotoId = (kyoto as unknown as { id: string }).id;
        const itinerary = (
          await app.inject({
            method: "GET",
            url: `/api/events/${kyotoId}/itinerary`,
            headers: mei.headers,
          })
        ).json() as {
          items: { displayName: string; location: string | null }[];
        };
        expect(itinerary.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              displayName: "Fushimi Inari, the lower loop",
              location: "Fushimi Inari Taisha, main gate",
            }),
          ]),
        );
        const shares = (
          await app.inject({
            method: "GET",
            url: `/api/objects/${kyotoId}/shares`,
            headers: mei.headers,
          })
        ).json() as {
          items: { role: string }[];
          pending: { person: { displayName: string } | null }[];
        };
        expect(shares.items.map((share) => share.role)).toEqual(["viewer"]);
        expect(
          shares.pending.map((share) => share.person?.displayName),
        ).toEqual(["The Tanakas"]);
        const trash = (
          await app.inject({
            method: "GET",
            url: "/api/trash",
            headers: mei.headers,
          })
        ).json() as { items: { displayName: string }[] };
        expect(trash.items.map((item) => item.displayName)).toEqual([
          "Karaoke night (dropped)",
        ]);
        const notes = (
          await app.inject({
            method: "GET",
            url: `/api/events/${kyotoId}/notes`,
            headers: mei.headers,
          })
        ).json() as { items: { displayName: string; version: number }[] };
        expect(
          notes.items.find((note) => note.displayName === "What to bring")
            ?.version,
        ).toBe(2);

        // Kai reads in Simplified Chinese and reaches Kyoto in Mei's
        // workspace through the share.
        const kai = await signIn("kai-tanaka");
        expect(kai.user.locale).toBe("zh-Hans");
        const kyotoForKai = await app.inject({
          method: "GET",
          url: `/api/events/${kyotoId}`,
          headers: { ...kai.headers, "x-workspace-id": mei.workspaceId },
        });
        expect(kyotoForKai.statusCode).toBe(200);

        // A second run signs the accounts in and creates nothing.
        const again = await seedTestData(app, email, { password, today });
        expect(again.accounts.map((account) => account.status)).toEqual([
          "exists",
          "exists",
          "exists",
        ]);
        expect(again.created).toEqual({});
        expect(again.invitationLink).toBeNull();
        const eventsAgain = (
          await app.inject({
            method: "GET",
            url: "/api/events?query=&scope=mine&filter=all&sort=date",
            headers: mei.headers,
          })
        ).json() as { items: unknown[] };
        expect(eventsAgain.items).toHaveLength(3);
      },
    );

    it(
      "refuses to continue when an account exists with another password",
      { timeout: seedTimeout },
      async () => {
        app = buildApp(compose(database, email));
        await seedTestData(app, email, { password });
        await expect(
          seedTestData(app, email, { password: "another password entirely" }),
        ).rejects.toThrow(
          `The account ${seedAccounts[0]?.username} exists with another password`,
        );
      },
    );
  },
);
