import { ApiClientError } from "@chronelle/api-client";
import type { RecoveryPreview } from "@chronelle/schemas";
import { describe, expect, it } from "vitest";

import {
  recoveryErrorKind,
  recoveryPreviewQueryKey,
  recoveryTarget,
  reviewRecovery,
  trashObjectTypes,
  trashQueryKey,
  trashTypeLabels,
} from "../src/recovery/data";

const workspaceId = "019d6e7d-0000-7000-8000-000000000001";
const objectId = "019d6e7d-0000-7000-8000-000000000002";

function preview(change: Partial<RecoveryPreview> = {}): RecoveryPreview {
  return {
    object: {
      id: objectId,
      objectType: "event",
      displayName: "Garden evening",
      version: 7,
      deletedAt: "2030-07-01T10:00:00.000Z",
    },
    canRecover: true,
    blockedReason: null,
    ...change,
  };
}

describe("Mini Program Trash recovery", () => {
  it("uses the preview's canonical identity and current version", () => {
    expect(recoveryTarget(preview())).toEqual({
      id: objectId,
      expectedVersion: 7,
    });
    expect(recoveryTarget(preview({ canRecover: false }))).toBeNull();
  });

  it("requires fresh matching recovery details before confirmation", () => {
    const displayed = preview();
    expect(reviewRecovery(displayed, preview())).toEqual({
      status: "ready",
      target: { id: objectId, expectedVersion: 7 },
    });
    expect(
      reviewRecovery(
        displayed,
        preview({ object: { ...displayed.object, version: 8 } }),
      ),
    ).toEqual({ status: "changed" });
    expect(
      reviewRecovery(
        displayed,
        preview({ canRecover: false, blockedReason: "Restore parent first." }),
      ),
    ).toEqual({ status: "blocked" });
  });

  it("separates access loss, version conflicts, and other failures", () => {
    expect(recoveryErrorKind(new ApiClientError(403, "forbidden", ""))).toBe(
      "unavailable",
    );
    expect(recoveryErrorKind(new ApiClientError(404, "not_found", ""))).toBe(
      "unavailable",
    );
    expect(recoveryErrorKind(new ApiClientError(409, "conflict", ""))).toBe(
      "conflict",
    );
    expect(recoveryErrorKind(new Error("offline"))).toBe("request");
  });

  it("partitions list and preview caches by workspace and filter", () => {
    expect(trashQueryKey(workspaceId, null)).toEqual([
      "wechat-trash",
      workspaceId,
      null,
    ]);
    expect(trashQueryKey(workspaceId, "event")).not.toEqual(
      trashQueryKey(workspaceId, null),
    );
    expect(recoveryPreviewQueryKey(workspaceId, objectId)).toEqual([
      "wechat-recovery-preview",
      workspaceId,
      objectId,
    ]);
  });

  it("labels every type supported by the server Trash filter", () => {
    expect(trashObjectTypes).toHaveLength(7);
    for (const type of trashObjectTypes)
      expect(trashTypeLabels[type]).toBeTruthy();
  });
});
