import type {
  ObjectAccessResponse,
  PendingShare,
  SentInvitation,
} from "@chronelle/schemas";

export const shareRoles = ["viewer", "editor", "owner"] as const;
export type ShareRole = (typeof shareRoles)[number];

export function sharingAccess(access: ObjectAccessResponse): {
  readonly canManage: boolean;
  readonly canLeave: boolean;
} {
  return {
    canManage: access.actions.includes("share"),
    canLeave: access.source.kind === "direct",
  };
}

/** Only a server-issued invitation URL may be offered for handoff. */
export function pendingInvitationUrl(
  pending: PendingShare,
  sent: readonly SentInvitation[],
): string | null {
  if (pending.kind !== "invitation" || pending.email !== null) return null;
  const invitation = sent.find((item) => item.id === pending.itemId);
  return invitation?.kind === "invitation" ? invitation.inviteUrl : null;
}
