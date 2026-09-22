import { describe, expect, it } from "vitest";

import {
  emptyEventFields,
  EventEditorValidationError,
  eventCreatePayload,
  eventUpdatePayload,
  fieldsFromEvent,
  localCalendarDate,
  sameEventFields,
  type EventEditorFields,
} from "../src/events/editor";
import { uuidV4FromBytes } from "../src/events/command-id";

const commandId = "019d6e7d-0000-7000-8000-000000000010";

function fields(change: Partial<EventEditorFields> = {}): EventEditorFields {
  return {
    ...emptyEventFields("America/Los_Angeles", new Date(2030, 6, 3)),
    displayName: "Garden evening",
    ...change,
  };
}

function event(change: Record<string, unknown> = {}) {
  return {
    id: "019d6e7d-0000-7000-8000-000000000001",
    workspaceId: "019d6e7d-0000-7000-8000-000000000002",
    objectType: "event" as const,
    displayName: "Garden evening",
    createdBy: "019d6e7d-0000-7000-8000-000000000003",
    permissionScopeId: "019d6e7d-0000-7000-8000-000000000001",
    createdAt: "2030-07-01T10:00:00.000Z",
    updatedAt: "2030-07-01T10:00:00.000Z",
    version: 3,
    archivedAt: null,
    deletedAt: null,
    customProperties: {},
    metadata: {},
    startsOn: null,
    endsOn: null,
    startsAt: null,
    endsAt: null,
    timezone: null,
    isAllDay: false,
    location: null,
    description: null,
    ...change,
  };
}

function expectIssue(action: () => unknown, issue: string) {
  try {
    action();
    throw new Error("Expected Event editor validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(EventEditorValidationError);
    expect((error as EventEditorValidationError).issue).toBe(issue);
  }
}

describe("Mini Program Event editor", () => {
  it("starts a new draft with a local calendar date but no schedule", () => {
    const now = new Date(2030, 6, 3, 23, 50);
    expect(localCalendarDate(now)).toBe("2030-07-03");
    expect(emptyEventFields("Asia/Shanghai", now)).toMatchObject({
      mode: "undated",
      startDate: "2030-07-03",
      startTime: "09:00",
      timeZone: "Asia/Shanghai",
    });
  });

  it("creates an idempotent undated Event payload", () => {
    expect(
      eventCreatePayload(
        fields({
          description: "  Bring tea.  ",
          location: "  Courtyard  ",
          mode: "undated",
        }),
        commandId,
      ),
    ).toEqual({
      commandId,
      description: "Bring tea.",
      displayName: "Garden evening",
      endsAt: null,
      endsOn: null,
      isAllDay: false,
      location: "Courtyard",
      startsAt: null,
      startsOn: null,
      timezone: null,
    });
  });

  it("preserves date-only and multi-day semantics", () => {
    expect(
      eventCreatePayload(
        fields({
          endDate: "2030-07-05",
          mode: "dates",
          startDate: "2030-07-03",
        }),
        commandId,
      ),
    ).toMatchObject({
      startsOn: "2030-07-03",
      endsOn: "2030-07-05",
      startsAt: null,
      endsAt: null,
      isAllDay: true,
    });
  });

  it("converts wall-clock values in the Event time zone", () => {
    expect(
      eventCreatePayload(
        fields({
          endDate: "2030-07-03",
          endTime: "11:15",
          mode: "timed",
          startDate: "2030-07-03",
          startTime: "09:30",
        }),
        commandId,
      ),
    ).toMatchObject({
      startsAt: "2030-07-03T16:30:00.000Z",
      endsAt: "2030-07-03T18:15:00.000Z",
      startsOn: null,
      endsOn: null,
      timezone: "America/Los_Angeles",
    });
  });

  it("rejects a nonexistent daylight-saving wall time", () => {
    expectIssue(
      () =>
        eventCreatePayload(
          fields({
            mode: "timed",
            startDate: "2030-03-10",
            startTime: "02:30",
          }),
          commandId,
        ),
      "invalid-local-time",
    );
  });

  it.each([
    [{ displayName: "" }, "name-required"],
    [
      { mode: "dates", startDate: "2030-07-05", endDate: "2030-07-03" },
      "end-before-start",
    ],
    [
      { mode: "timed", startDate: "2030-07-03", endDate: "2030-07-04" },
      "end-incomplete",
    ],
  ] as const)("validates incomplete editor state", (change, issue) => {
    expectIssue(() => eventCreatePayload(fields(change), commandId), issue);
  });

  it("reads canonical date-only and timed Events back into editor fields", () => {
    expect(
      fieldsFromEvent(
        event({ startsOn: "2030-07-03", endsOn: "2030-07-05" }),
        "UTC",
      ),
    ).toMatchObject({
      mode: "dates",
      startDate: "2030-07-03",
      endDate: "2030-07-05",
    });
    expect(
      fieldsFromEvent(
        event({
          startsAt: "2030-07-03T16:30:00.000Z",
          endsAt: "2030-07-03T18:15:00.000Z",
          timezone: "America/Los_Angeles",
        }),
        "UTC",
      ),
    ).toMatchObject({
      mode: "timed",
      startDate: "2030-07-03",
      startTime: "09:30",
      endDate: "2030-07-03",
      endTime: "11:15",
    });
  });

  it("carries the canonical expected version on updates", () => {
    expect(eventUpdatePayload(fields(), 7)).toMatchObject({
      displayName: "Garden evening",
      expectedVersion: 7,
    });
  });

  it("compares every persisted editor field", () => {
    const baseline = fields();
    expect(sameEventFields(baseline, { ...baseline })).toBe(true);
    expect(
      sameEventFields(baseline, { ...baseline, description: "Changed" }),
    ).toBe(false);
  });

  it("derives a valid v4 command id from native random bytes", () => {
    expect(uuidV4FromBytes(new Uint8Array(16).fill(255))).toBe(
      "ffffffff-ffff-4fff-bfff-ffffffffffff",
    );
    expect(() => uuidV4FromBytes(new Uint8Array(15))).toThrow(
      "A UUID requires 16 bytes.",
    );
  });
});
