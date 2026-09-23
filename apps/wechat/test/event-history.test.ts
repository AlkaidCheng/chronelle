import { ApiClientError } from "@chronelle/api-client";
import type { RevisionRestorePreview } from "@chronelle/schemas";
import { describe, expect, it } from "vitest";

import {
  historyFieldLabel,
  historyValue,
  isHistoryPermissionLoss,
  restoreRequestForPreview,
  reviewRestoration,
} from "../src/events/history";

const preview: RevisionRestorePreview = {
  objectId: "019d6e7d-0000-7000-8000-000000000001",
  sourceRevisionId: "019d6e7d-0000-7000-8000-000000000002",
  sourceVersion: 2,
  currentVersion: 5,
  canRestore: true,
  changes: [],
  preservedFields: [],
};

describe("Event history restore review", () => {
  it("pins the write to the version displayed and freshly reviewed", () => {
    expect(reviewRestoration(preview, preview, 5, true)).toEqual({
      status: "ready",
      request: { expectedVersion: 5 },
    });
    expect(restoreRequestForPreview(preview, false)).toBeNull();
  });

  it("requires a new review when the canonical version changes", () => {
    expect(
      reviewRestoration(preview, { ...preview, currentVersion: 6 }, 6, true),
    ).toEqual({ status: "changed" });
    expect(reviewRestoration(preview, preview, 6, true)).toEqual({
      status: "changed",
    });
    expect(
      reviewRestoration(
        preview,
        {
          ...preview,
          sourceRevisionId: "019d6e7d-0000-7000-8000-000000000003",
        },
        5,
        true,
      ),
    ).toEqual({ status: "changed" });
  });

  it("never offers a write after edit permission or eligibility is lost", () => {
    expect(reviewRestoration(preview, preview, 5, false)).toEqual({
      status: "readonly",
    });
    expect(
      reviewRestoration(preview, { ...preview, canRestore: false }, 5, true),
    ).toEqual({ status: "unavailable" });
    expect(
      isHistoryPermissionLoss(new ApiClientError(403, "forbidden", "Denied")),
    ).toBe(true);
    expect(
      isHistoryPermissionLoss(new ApiClientError(404, "not_found", "Missing")),
    ).toBe(true);
    expect(
      isHistoryPermissionLoss(
        new ApiClientError(409, "version_conflict", "Stale"),
      ),
    ).toBe(false);
  });

  it("distinguishes missing historical values from explicit false and zero", () => {
    expect(historyValue(null, false, "en-US")).toBe("Not set");
    expect(historyValue(false, true, "en-US")).toBe("No");
    expect(historyValue(0, true, "zh-CN")).toBe("0");
    expect(
      historyFieldLabel(
        {
          field: "customProperties.reference",
          label: "Custom property: reference",
          valueType: "json",
          before: null,
          after: false,
          beforePresent: false,
          afterPresent: true,
          restorable: true,
        },
        "zh-CN",
      ),
    ).toBe("自定义属性：reference");
  });
});
