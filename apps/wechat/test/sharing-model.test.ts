import type {
  ObjectAccessResponse,
  PendingShare,
  SentInvitation,
} from "@chronelle/schemas";
import { describe, expect, it } from "vitest";

import { pendingInvitationUrl, sharingAccess } from "../src/sharing/model";

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
