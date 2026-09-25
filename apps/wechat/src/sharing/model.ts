import type {
  ObjectAccessResponse,
  PendingShare,
  SentInvitation,
} from "@livtales/schemas";

export const shareRoles = ["viewer", "editor", "owner"] as const;
export type ShareRole = (typeof shareRoles)[number];

/** A completed write remains successful if its follow-up read fails. */
export async function applySharingChange(
  write: () => Promise<unknown>,
  refresh: () => Promise<boolean>,
  onWritten: () => void,
): Promise<boolean> {
  await write();
  onWritten();
  try {
    return await refresh();
  } catch {
    return false;
  }
}

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
