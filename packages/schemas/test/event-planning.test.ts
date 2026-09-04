import { describe, expect, it } from "vitest";

import {
  eventCreateRequestSchema,
  eventPlanningResourceResponseSchema,
  eventUpdateRequestSchema,
  expenseCreateRequestSchema,
  relationCreateRequestSchema,
} from "../src/event-planning.js";
import { documentUploadAuthorizationRequestSchema } from "../src/documents.js";

describe("event-planning schemas", () => {
  it("normalizes typed creation input", () => {
    expect(
      eventCreateRequestSchema.parse({
        displayName: "  Opening dinner  ",
        startsAt: "2026-10-15T18:00:00Z",
        timezone: "America/Los_Angeles",
      }),
    ).toMatchObject({
      displayName: "Opening dinner",
      startsAt: new Date("2026-10-15T18:00:00Z"),
    });
    expect(
      expenseCreateRequestSchema.parse({
        displayName: "Venue deposit",
        amount: "1250.5000",
        currency: "usd",
        occurredAt: "2026-09-15T12:00:00Z",
      }),
    ).toMatchObject({ currency: "USD" });
  });

  it("requires a real update and validates relationship input", () => {
    expect(
      eventUpdateRequestSchema.safeParse({ expectedVersion: 1 }).success,
    ).toBe(false);
    expect(
      relationCreateRequestSchema.safeParse({
        relationType: "includes",
        targetObjectId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  it("accepts only a complete typed resource response", () => {
    expect(
      eventPlanningResourceResponseSchema.safeParse({
        id: "00000000-0000-7000-8000-000000000001",
        objectType: "event",
      }).success,
    ).toBe(false);
  });

  it("validates attachment metadata at the transport boundary", () => {
    const valid = {
      checksumSha256: "a".repeat(64),
      mimeType: "application/pdf",
      originalFilename: "ticket.pdf",
      parentObjectId: "00000000-0000-7000-8000-000000000001",
      sizeBytes: 1024,
    };
    expect(documentUploadAuthorizationRequestSchema.parse(valid)).toEqual(
      valid,
    );
    expect(
      documentUploadAuthorizationRequestSchema.safeParse({
        ...valid,
        originalFilename: "../ticket.pdf",
      }).success,
    ).toBe(false);
  });
});
