import type {
  ObjectAccessResponse,
  PendingShare,
  SentInvitation,
} from "@livtales/schemas";

/** The roles a single record is shared with; owning belongs to its space's owners. */
export const shareRoles = ["viewer", "editor"] as const;
export type ShareRole = (typeof shareRoles)[number];
/** A grant's role: one of the share roles, or Owner on a share made before. */
export type GrantRole = ShareRole | "owner";

/** The roles a grant's picker lists: the share roles, and Owner while the grant holds it. */
export function rolesFor(current: GrantRole): readonly GrantRole[] {
  return current === "owner" ? [...shareRoles, "owner"] : shareRoles;
}

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
