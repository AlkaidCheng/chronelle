import type { PersonResponse } from "@chronelle/schemas";
import { describe, expect, it } from "vitest";

import {
  emptyPersonFields,
  fieldsFromPerson,
  personCreatePayload,
  personUpdatePayload,
  PersonValidationError,
} from "../src/people/model";
import { friendsKey, peopleListKey, personDetailKey } from "../src/people/data";

const personId = "019d6e7d-0000-7000-8000-000000000001";
const workspaceId = "019d6e7d-0000-7000-8000-000000000002";
const commandId = "019d6e7d-0000-7000-8000-000000000003";

const person: PersonResponse = {
  id: personId,
  workspaceId,
  objectType: "person",
  displayName: "Mei Lin",
  nickname: "Mei",
  description: "Planning lead",
  contacts: [{ kind: "email", value: "mei@example.test" }],
  labelIds: [commandId],
  userId: commandId,
  createdBy: commandId,
  permissionScopeId: personId,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
  version: 4,
  archivedAt: null,
  deletedAt: null,
  customProperties: { favorite: "tea" },
  metadata: {},
};

describe("Mini Program People", () => {
  it("builds one canonical Person creation with a retry-stable command", () => {
    const payload = personCreatePayload(
      {
        displayName: "  Mei Lin  ",
        nickname: " Mei ",
        description: " ",
        contacts: [
          { kind: "email", value: " mei@example.test " },
          { kind: "phone", value: "  " },
        ],
      },
      commandId,
    );
    expect(payload).toEqual({
      commandId,
      displayName: "Mei Lin",
      nickname: "Mei",
      description: null,
      contacts: [{ kind: "email", value: "mei@example.test" }],
    });
  });

  it("updates only editable fields with a canonical expected version", () => {
    const fields = fieldsFromPerson(person);
    const payload = personUpdatePayload(
      { ...fields, nickname: "" },
      person.version,
    );
    expect(payload.expectedVersion).toBe(4);
    expect(payload.nickname).toBeNull();
    expect(payload).not.toHaveProperty("userId");
    expect(payload).not.toHaveProperty("labelIds");
    expect(payload).not.toHaveProperty("customProperties");
    expect(person.nickname).toBe("Mei");
  });

  it("rejects invalid contacts and bounds rather than sending them", () => {
    expect(() =>
      personCreatePayload(
        {
          ...emptyPersonFields(),
          displayName: "Mei",
          contacts: [{ kind: "email", value: "not an address" }],
        },
        commandId,
      ),
    ).toThrow(new PersonValidationError("contact"));
    expect(() =>
      personCreatePayload(
        { ...emptyPersonFields(), displayName: "  " },
        commandId,
      ),
    ).toThrow(new PersonValidationError("name"));
  });

  it("partitions People by workspace and Friends by account", () => {
    expect(peopleListKey(workspaceId)).toEqual(["wechat-people", workspaceId]);
    expect(peopleListKey(workspaceId, "mei")).toEqual([
      "wechat-people",
      workspaceId,
      "mei",
    ]);
    expect(personDetailKey(workspaceId, personId)).toEqual([
      "wechat-person",
      workspaceId,
      personId,
    ]);
    expect(friendsKey(personId)).toEqual(["wechat-friends", personId]);
  });
});
