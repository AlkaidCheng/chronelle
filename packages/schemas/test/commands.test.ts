import { describe, expect, it } from "vitest";
import {
  commandExecuteRequestSchema,
  commandTransitionRequestSchema,
} from "../src/commands.js";

const id = "019d6e7d-0000-7000-8000-000000000010";
const edit = {
  objectType: "event",
  objectId: id,
  patch: { expectedVersion: 1, displayName: "Plan" },
};
const command = { operationId: id, expectedStackVersion: 0, edits: [edit] };

describe("reversible command contracts", () => {
  it("accepts bounded typed content patches and normalizes identities", () => {
    expect(
      commandExecuteRequestSchema.parse({
        ...command,
        operationId: id.toUpperCase(),
      }).operationId,
    ).toBe(id);
    expect(
      commandExecuteRequestSchema.parse({
        ...command,
        edits: [
          {
            ...edit,
            patch: { expectedVersion: 1, startsAt: "2026-09-05T12:00:00.000Z" },
          },
        ],
      }).edits[0]?.patch,
    ).toMatchObject({ startsAt: new Date("2026-09-05T12:00:00.000Z") });
  });

  it("rejects security fields, unsupported types, duplicate identities, and unbounded batches", () => {
    for (const patch of [
      { expectedVersion: 1 },
      { ...edit.patch, metadata: {} },
      { ...edit.patch, permissionScopeId: id },
      { ...edit.patch, deletedAt: null },
      { ...edit.patch, expectedVersion: 0 },
    ])
      expect(
        commandExecuteRequestSchema.safeParse({
          ...command,
          edits: [{ ...edit, patch }],
        }).success,
      ).toBe(false);
    for (const edits of [
      [],
      Array(11).fill(edit),
      [edit, { ...edit, objectId: id.toUpperCase() }],
      [{ ...edit, objectType: "expense" }],
    ]) {
      expect(
        commandExecuteRequestSchema.safeParse({ ...command, edits }).success,
      ).toBe(false);
    }
    expect(
      commandExecuteRequestSchema.safeParse({ ...command, userId: id }).success,
    ).toBe(false);
    expect(
      commandTransitionRequestSchema.safeParse({
        operationId: id,
        commandId: id,
        expectedStackVersion: -1,
      }).success,
    ).toBe(false);
  });
});
