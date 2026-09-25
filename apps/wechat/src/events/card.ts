import type { AccessibleWorkspace, EventListItem } from "@livtales/schemas";

/**
 * Whether an Event's card marks it read-only: the account may only view it
 * while its workspace lets the account edit. Elsewhere the access matches
 * the workspace and the card says nothing about it.
 */
export function marksReadOnly(
  event: Pick<EventListItem, "access">,
  workspaceRole: AccessibleWorkspace["role"],
): boolean {
  return event.access.role === "viewer" && workspaceRole !== "viewer";
}

/**
 * How many accounts the Event is shared with, counted only for an Event the
 * account shared itself; an Event shared with the account names who shared it.
 */
export function sharedWithCount(event: Pick<EventListItem, "access">): number {
  return event.access.sharedBy === null ? event.access.sharedWith : 0;
}
