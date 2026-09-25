import type {
  ObjectAccessResponse,
  PendingShare,
  SentInvitation,
} from "@livtales/schemas";
import { describe, expect, it, vi } from "vitest";

import {
  applySharingChange,
  pendingInvitationUrl,
  sharingAccess,
} from "../src/sharing/model";

const objectId = "019d6e7d-0000-7000-8000-000000000001";
const invitationId = "019d6e7d-0000-7000-8000-000000000002";
const now = "2026-09-22T00:00:00.000Z";

function access(
  source: ObjectAccessResponse["source"],
  actions: ObjectAccessResponse["actions"],
): ObjectAccessResponse {
  return { resourceId: objectId, source, actions, narrowing: null };
}

const pending: PendingShare = {
  id: "019d6e7d-0000-7000-8000-000000000003",
  workspaceId: objectId,
  resourceId: objectId,
  role: "viewer",
  status: "pending",
  kind: "invitation",
  itemId: invitationId,
  person: { id: objectId, displayName: "Guest" },
  email: null,
  grantedBy: objectId,
  createdAt: now,
};

const sent: SentInvitation = {
  id: invitationId,
  kind: "invitation",
  email: null,
  channel: "link",
  inviteUrl: "https://chronelle.example/invite/opaque-token-1234567890",
  message: null,
  personId: objectId,
  workspaceId: objectId,
  createdAt: now,
  expiresAt: now,
};

describe("Mini Program Event sharing", () => {
  it("reports a completed write even when the share list cannot refresh", async () => {
    const write = vi.fn(async () => undefined);
    const onWritten = vi.fn();
    const refresh = vi.fn(async () => {
      expect(onWritten).toHaveBeenCalledOnce();
      throw new Error("read failed");
    });
    await expect(applySharingChange(write, refresh, onWritten)).resolves.toBe(
      false,
    );
    expect(write).toHaveBeenCalledOnce();
    expect(onWritten).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not refresh or report success when the write fails", async () => {
    const refresh = vi.fn(async () => true);
    const onWritten = vi.fn();
    await expect(
      applySharingChange(
        async () => {
          throw new Error("write failed");
        },
        refresh,
        onWritten,
      ),
    ).rejects.toThrow("write failed");
    expect(refresh).not.toHaveBeenCalled();
    expect(onWritten).not.toHaveBeenCalled();
  });

  it("derives management from actions and leaving from direct-grant provenance", () => {
    expect(sharingAccess(access({ kind: "own" }, ["view", "share"]))).toEqual({
      canManage: true,
      canLeave: false,
    });
    expect(
      sharingAccess(
        access(
          {
            kind: "direct",
            grantedBy: { id: objectId, displayName: "Host" },
            role: "viewer",
          },
          ["view"],
        ),
      ),
    ).toEqual({ canManage: false, canLeave: true });
    expect(sharingAccess(access({ kind: "own" }, ["view"]))).toEqual({
      canManage: false,
      canLeave: false,
    });
  });

  it("offers only the invitation URL returned for the matching pending share", () => {
    expect(pendingInvitationUrl(pending, [sent])).toBe(sent.inviteUrl);
    expect(
      pendingInvitationUrl(pending, [{ ...sent, id: objectId }]),
    ).toBeNull();
    expect(
      pendingInvitationUrl({ ...pending, email: "guest@example.test" }, [sent]),
    ).toBeNull();
    expect(
      pendingInvitationUrl({ ...pending, kind: "connection" }, [sent]),
    ).toBeNull();
    expect(
      pendingInvitationUrl(pending, [{ ...sent, kind: "connection" }]),
    ).toBeNull();
  });
});
