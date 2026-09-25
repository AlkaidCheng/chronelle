import { describe, expect, it } from "vitest";

import {
  DatabaseUnavailableError,
  disconnectedDatabase,
} from "../src/client.js";
import { objects } from "../src/schema.js";

describe("disconnectedDatabase", () => {
  it("fails every database and SQL use with the reason and closes quietly", async () => {
    const connection = disconnectedDatabase("LIVTALES_BACKEND=cloudbase");
    expect(() => connection.db.select().from(objects)).toThrow(
      new DatabaseUnavailableError("LIVTALES_BACKEND=cloudbase"),
    );
    expect(() => connection.sql`select 1`).toThrow(DatabaseUnavailableError);
    await expect(connection.close()).resolves.toBeUndefined();
    // A connection that is awaited by mistake must not be mistaken for a thenable.
    await expect(Promise.resolve(connection.db)).resolves.toBeDefined();
  });
});
