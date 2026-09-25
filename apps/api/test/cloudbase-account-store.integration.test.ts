import { resolve } from "node:path";

import type { UserRow } from "@livtales/db";
import {
  applyMigrations,
  createCloudBaseRpcDouble,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthIdentity } from "../src/authentication/auth-provider.js";
import {
  InvalidRequestError,
  UsernameTakenError,
  UserUnavailableError,
} from "../src/errors.js";
import { CloudBaseFriendStore } from "../src/friends/cloudbase-friend-store.js";
import {
  FriendConflictError,
  type FriendStore,
  FriendUnavailableError,
  InvalidFriendRequestError,
  PostgresFriendStore,
} from "../src/friends/friend-store.js";
import { CloudBaseIdentityStore } from "../src/identity/cloudbase-identity-store.js";
import {
  type IdentityStore,
  PostgresIdentityStore,
} from "../src/identity/identity-store.js";

// The chronelle_account_update, chronelle_users_search, chronelle_user_lookup,
// and chronelle_friend_request functions must leave and return what the
// PostgreSQL stores leave and return: the same account, the same search
// results in the same order, the same refusals with the same statuses.

let database: TestDatabase;
let reference: PostgresIdentityStore;
let identities: { postgres: IdentityStore; cloudbase: IdentityStore };
let friends: { postgres: FriendStore; cloudbase: FriendStore };
let counter = 0;
const clock = () => new Date("2030-08-01T12:00:00.000Z");
const requestId = () =>
  `01a0a000-0000-7000-8000-${String(++counter).padStart(12, "0")}`;

async function account(
  suffix: string,
  displayName?: string,
  username?: string,
): Promise<UserRow> {
  const auth: AuthIdentity = {
    provider: "test",
    subject: `subject-${suffix}`,
    email: `${suffix}@example.test`,
    displayName: displayName ?? `Person ${suffix}`,
    ...(username !== undefined && { username }),
  };
  return (await reference.signIn(auth, requestId())).user;
}

beforeAll(async () => {
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    resolve(import.meta.dirname, "../../../infrastructure/migrations"),
  );
  reference = new PostgresIdentityStore(database.connection.db);
  const rpc = createCloudBaseRpcDouble(database.connection.sql);
  identities = {
    postgres: reference,
    cloudbase: new CloudBaseIdentityStore({
      rpc,
      select: () => {
        throw new Error("The table route is not used here.");
      },
    }),
  };
  friends = {
    postgres: new PostgresFriendStore(database.connection.db, clock),
    cloudbase: new CloudBaseFriendStore({ rpc }),
  };
});

afterAll(async () => {
  await database?.close();
});

const backends = () =>
  [
    ["postgres", () => identities.postgres, () => friends.postgres],
    ["cloudbase", () => identities.cloudbase, () => friends.cloudbase],
  ] as const;

const summary = (user: UserRow, relation = "none") => ({
  id: user.id,
  displayName: user.displayName,
  username: user.username,
  relation,
});

describe.each(backends())("%s account store", (name, identity, friendStore) => {
  it("gives a new account the username it chose, else one from its name, numbered when taken", async () => {
    const signIn = (suffix: string, displayName: string, username?: string) =>
      identity().signIn(
        {
          provider: "test",
          subject: `subject-${name}-${suffix}`,
          email: `${name}-${suffix}@example.test`,
          displayName,
          ...(username !== undefined && { username }),
        },
        requestId(),
      );
    // From the name: letters and digits, hyphens between, lowercased.
    const first = await signIn("slug-1", `Zoe ${name} O'Neil`);
    expect(first.user.username).toBe(`zoe-${name}-o-neil`);
    // The same name again is numbered; a third goes on counting.
    expect((await signIn("slug-2", `Zoe ${name} O'Neil`)).user.username).toBe(
      `zoe-${name}-o-neil2`,
    );
    expect((await signIn("slug-3", `zoe ${name} o neil`)).user.username).toBe(
      `zoe-${name}-o-neil3`,
    );
    // A name with nothing usable, or too short, falls back to a letter or "user".
    expect((await signIn("slug-4", "陈爷爷")).user.username).toMatch(
      /^user\d*$/u,
    );
    expect((await signIn("slug-5", "42")).user.username).toMatch(/^u42\d*$/u);
    // The chosen username wins when free and well formed, and only then.
    expect(
      (await signIn("slug-6", "Anyone", `${name}_chosen`)).user.username,
    ).toBe(`${name}_chosen`);
    await expect(signIn("slug-7", "Anyone", `${name}_CHOSEN`)).rejects.toThrow(
      UsernameTakenError,
    );
    await expect(signIn("slug-8", "Anyone", "1abc")).rejects.toThrow(
      InvalidRequestError,
    );
    // Signing in again keeps the username the account has.
    expect((await signIn("slug-1", "Renamed")).user.username).toBe(
      `zoe-${name}-o-neil`,
    );
    // Availability, for the sign-up screen.
    expect(await identity().usernameAvailable(`${name}_chosen`)).toBe(false);
    expect(await identity().usernameAvailable(`${name}_Chosen`)).toBe(false);
    expect(await identity().usernameAvailable(`${name}_free`)).toBe(true);
    expect(await identity().usernameAvailable("1abc")).toBe(false);
  });

  it("sets the name and the discovery switches, completes the Welcome step once, and keeps the username as chosen", async () => {
    const ana = await account(`${name}-acct-ana`, undefined, `${name}-Ana`);
    expect(ana.username).toBe(`${name}-Ana`);
    expect(ana.findByName).toBe(true);
    expect(ana.findByEmail).toBe(true);
    // An identity that is not a password account brings its name.
    expect(ana.onboardedAt).not.toBeNull();
    // A password account has the Welcome step ahead until it says so;
    // the moment then stays.
    const pw = await identity().signIn(
      {
        provider: "password",
        subject: `${name}-pw@example.test`,
        email: `${name}-pw@example.test`,
        displayName: `${name}-pw`,
        username: `${name}-pw`,
      },
      "00000000-0000-7000-8000-000000000042",
    );
    expect(pw.user.onboardedAt).toBeNull();
    const named = await identity().updateAccount(pw.user.id, {
      displayName: `  ${name} Person  `,
      onboarded: true,
    });
    expect(named.displayName).toBe(`${name} Person`);
    expect(named.onboardedAt).not.toBeNull();
    const once = await identity().updateAccount(pw.user.id, {
      onboarded: true,
    });
    expect(once.onboardedAt?.getTime()).toBe(named.onboardedAt?.getTime());
    const hidden = await identity().updateAccount(ana.id, {
      findByEmail: false,
    });
    expect(hidden.findByEmail).toBe(false);
    expect(hidden.findByName).toBe(true);
    expect(hidden.username).toBe(`${name}-Ana`);
    expect(hidden.updatedAt.getTime()).toBeGreaterThanOrEqual(
      ana.updatedAt.getTime(),
    );
    const shown = await identity().updateAccount(ana.id, {
      findByName: false,
      findByEmail: true,
    });
    expect(shown.findByName).toBe(false);
    expect(shown.findByEmail).toBe(true);
    await expect(
      identity().updateAccount("00000000-0000-7000-8000-000000000000", {
        findByName: false,
      }),
    ).rejects.toThrow(UserUnavailableError);
  });

  it("finds people by @username, name, or exact email as each account allows, and never the searcher", async () => {
    // Both backends share one database: the family name carries the
    // backend so one search sees only its own accounts.
    const chen = name === "postgres" ? "ChenPg" : "ChenCb";
    const me = await account(`${name}-find-me`, `${chen} Me`, `${name}chen`);
    await account(`${name}-find-wei`, `${chen} Wei`, `${name}chenwei`);
    const li = await account(`${name}-find-li`, `${chen} Li`, `${name}chen-li`);
    const shy = await account(`${name}-find-shy`, `${chen} Shy`, `${name}shy`);
    const hidden = await account(`${name}-find-hidden`, `Hidden ${chen}`);
    await identity().updateAccount(shy.id, { findByName: false });
    await identity().updateAccount(hidden.id, { findByEmail: false });
    const search = (q: string) => identity().searchUsers(me.id, q);

    // By name: containing, case-insensitive, those who allow it; the
    // searcher is left out even though the name matches.
    const byName = await search(chen.toLowerCase());
    expect(byName.map((item) => item.displayName)).toEqual([
      `${chen} Li`,
      `${chen} Wei`,
      `Hidden ${chen}`,
    ]);
    expect(byName[2]?.username).toBe(`hidden-${chen.toLowerCase()}`);
    expect(byName[0]).toEqual(summary({ ...li, username: `${name}chen-li` }));

    // By @username: a prefix, the exact one first.
    expect((await search(`@${name}chen`)).map((item) => item.username)).toEqual(
      [`${name}chen-li`, `${name}chenwei`],
    );
    expect((await search(`@${name}SHY`)).map((item) => item.username)).toEqual([
      `${name}shy`,
    ]);

    // By email: the exact address, unless hidden.
    expect(await search(`${name}-find-li@example.test`)).toEqual([
      summary({ ...li, username: `${name}chen-li` }),
    ]);
    expect(await search(`${name}-FIND-LI@example.test`)).toHaveLength(1);
    expect(await search(`${name}-find-hidden@example.test`)).toEqual([]);
    expect(await search(`${name}-find-li@example`)).toEqual([]);

    // Too short, wildcards as themselves, and never the searcher, even by
    // their own name.
    expect(await search("c")).toEqual([]);
    expect(await search("%")).toEqual([]);
    expect(
      (await search(`${chen} Me`)).map((item) => item.displayName),
    ).not.toContain(`${chen} Me`);
  });

  it("orders a name search with the exact username first, then username prefixes, then names", async () => {
    const me = await account(`${name}-order-me`);
    await account(`${name}-order-a`, "Zed Order", `${name}ord`);
    await account(`${name}-order-b`, `Amy ${name}ord`, `${name}orderly`);
    await account(`${name}-order-c`, "Bob Nobody", `${name}ordinary`);
    const items = await identity().searchUsers(me.id, `${name}ord`);
    expect(items.map((item) => item.username)).toEqual([
      `${name}ord`,
      `${name}orderly`,
      `${name}ordinary`,
    ]);
    const capped = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        account(`${name}-many-${index}`, `Many ${name} ${index}`),
      ),
    );
    expect(capped).toHaveLength(12);
    expect(await identity().searchUsers(me.id, `Many ${name}`)).toHaveLength(
      10,
    );
  });

  it("ranks a name search: word prefix, then contains, then similarity; folds accents; forgives a typo", async () => {
    const tag = name === "postgres" ? "Vpg" : "Vcb";
    const me = await account(`${name}-rank-me`);
    const rows = [
      [`${name}-rank-a`, `${tag}ronica Adams`, `${name}rank_a`],
      [`${name}-rank-b`, `Anna ${tag}ronica`, `${name}rank_b`],
      [`${name}-rank-c`, `Dev${tag}ronica Lee`, `${name}rank_c`],
      [`${name}-rank-d`, `${tag}r\u00f3nica Est\u00e9vez`, `${name}rank_d`],
      [`${name}-rank-f`, `Unrelated Person`, `${name}rank_f`],
    ] as const;
    for (const [suffix, displayName, username] of rows)
      await account(suffix, displayName, username);
    const search = async (q: string) =>
      (await identity().searchUsers(me.id, q)).map((item) => item.displayName);

    // Word prefixes (start of the name, or of a later word) before a
    // mid-word match; an accented name is found by its plain letters.
    const found = await search(`${tag}ronica`);
    expect(found.slice(0, 3).sort()).toEqual(
      [
        `${tag}ronica Adams`,
        `Anna ${tag}ronica`,
        `${tag}r\u00f3nica Est\u00e9vez`,
      ].sort(),
    );
    expect(found[3]).toBe(`Dev${tag}ronica Lee`);
    expect(found).toHaveLength(4);
    // Accents in the query fold the same way; the name that contains the
    // whole text comes first, names sharing its long word follow by
    // similarity.
    expect((await search(`${tag}r\u00f3nica adams`))[0]).toBe(
      `${tag}ronica Adams`,
    );
    // A typo in a full name still finds it, by similarity; a shared word
    // with an otherwise different name does not.
    expect((await search(`${tag}ronica estvez`))[0]).toBe(
      `${tag}r\u00f3nica Est\u00e9vez`,
    );
    expect(await search(`${tag}ronica person`)).not.toContain(
      "Unrelated Person",
    );
    // Short text stays literal: a prefix, no near miss.
    expect(await search(`${tag}r`)).toEqual(
      expect.arrayContaining([`${tag}ronica Adams`]),
    );
  });

  it("looks a code up by username with the relation, and requests a friend by id", async () => {
    const ana = await account(`${name}-req-ana`);
    const ben = await account(`${name}-req-ben`, undefined, `${name}reqben`);
    const cid = await account(`${name}-req-cid`);
    expect(await identity().lookupUser(ana.id, `${name}REQBEN`)).toEqual(
      summary({ ...ben, username: `${name}reqben` }),
    );
    await expect(
      identity().lookupUser(ana.id, `${name}nobody`),
    ).rejects.toThrow(UserUnavailableError);

    const sent = await friendStore().request(ana.id, {
      addresseeId: ben.id,
      message: "From the code",
      personId: null,
      workspaceId: null,
      dailyLimit: 0,
      requestId: requestId(),
    });
    expect(sent.kind).toBe("connection");
    expect(sent.item.email).toBe(`${name}-req-ben@example.test`);
    expect(sent.item.message).toBe("From the code");
    expect(sent.recipient?.userId).toBe(ben.id);
    expect(sent.sender.displayName).toBe(`Person ${name}-req-ana`);

    // The relation follows on both sides, and in a search.
    expect(
      (await identity().lookupUser(ana.id, `${name}reqben`)).relation,
    ).toBe("requested");
    expect(
      (await identity().searchUsers(ben.id, `${name}-req-ana@example.test`))[0]
        ?.relation,
    ).toBe("incoming");
    const request = (from: UserRow, to: UserRow) =>
      friendStore().request(from.id, {
        addresseeId: to.id,
        message: null,
        personId: null,
        workspaceId: null,
        dailyLimit: 0,
        requestId: requestId(),
      });
    await expect(request(ana, ben)).rejects.toThrow(
      new FriendConflictError("An invitation is already waiting."),
    );
    await expect(request(ben, ana)).rejects.toThrow(
      new FriendConflictError("This person has already invited you."),
    );
    await friendStore().respond(ben.id, sent.item.id, true, requestId());
    expect(
      (await identity().lookupUser(ana.id, `${name}reqben`)).relation,
    ).toBe("friend");
    await expect(request(ana, ben)).rejects.toThrow(
      new FriendConflictError("You are already friends."),
    );
    await expect(request(ana, ana)).rejects.toThrow(
      new InvalidFriendRequestError("You cannot add yourself."),
    );
    await expect(
      friendStore().request(ana.id, {
        addresseeId: "00000000-0000-7000-8000-000000000000",
        message: null,
        personId: null,
        workspaceId: null,
        dailyLimit: 0,
        requestId: requestId(),
      }),
    ).rejects.toThrow(FriendUnavailableError);
    await expect(
      friendStore().request(ana.id, {
        addresseeId: cid.id,
        message: " padded ",
        personId: null,
        workspaceId: null,
        dailyLimit: 0,
        requestId: requestId(),
      }),
    ).rejects.toThrow(InvalidFriendRequestError);
    // The daily allowance counts requests with invitations.
    await expect(
      friendStore().request(ana.id, {
        addresseeId: cid.id,
        message: null,
        personId: null,
        workspaceId: null,
        dailyLimit: 1,
        requestId: requestId(),
      }),
    ).rejects.toThrow("Too many invitations today.");
  });
});
