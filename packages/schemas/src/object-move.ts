import { z } from "zod";

import {
  accessibleWorkspaceSchema,
  workspaceSummarySchema,
} from "./authentication.js";
import { eventResponseSchema } from "./event-planning.js";
import { relationTypeSchema } from "./relation-list.js";
import { roleSchema } from "./sharing.js";

// Moving an Event with everything in its scope to another space: the
// spaces it can go to, a preview of what moves and what stays behind, the
// request, and its result.

const idSchema = z.uuid().transform((value) => value.toLowerCase());
const countSchema = z.number().int().nonnegative();

/** The most items a preview lists of one kind; its total is always exact. */
export const objectMoveListLimit = 100;

function listed<Item extends z.ZodType>(item: Item) {
  return z.object({
    items: z.array(item).max(objectMoveListLimit),
    total: countSchema,
  });
}

/** A space the caller could move the Event to, with its members' count. */
export const objectMoveTargetSchema = z.object({
  workspace: accessibleWorkspaceSchema,
  memberCount: countSchema,
  /** The space the Event is in now. */
  current: z.boolean(),
  /** Whether the caller can move the Event there: another space where they can add records. */
  allowed: z.boolean(),
});

export const objectMoveTargetsResponseSchema = z.object({
  items: z.array(objectMoveTargetSchema),
});

/** What moves with the Event: its live records by kind, what is in Trash, and its shares. */
export const objectMoveCountsSchema = z.object({
  scheduleItems: countSchema,
  todos: countSchema,
  subtasks: countSchema,
  expenses: countSchema,
  reminders: countSchema,
  notes: countSchema,
  files: countSchema,
  sections: countSchema,
  pages: countSchema,
  inTrash: countSchema,
  shares: countSchema,
  pendingShares: countSchema,
});

const movedRecordSchema = z.object({
  id: z.uuid(),
  objectType: z.string(),
  displayName: z.string(),
});

/** A live relation between a moving record and one that stays; the move drops it. */
export const objectMoveDroppedLinkSchema = z.object({
  relationId: z.uuid(),
  relationType: relationTypeSchema,
  scoped: movedRecordSchema,
  other: movedRecordSchema,
});

/** A live to-do assigned to a People card, which stays; the move clears the assignee. */
export const objectMoveUnassignedTaskSchema = z.object({
  taskId: z.uuid(),
  displayName: z.string(),
  person: z.object({ id: z.uuid(), displayName: z.string() }),
});

/** A label the to-dos carry: it joins the target's label of that name, or is created there. */
export const objectMoveLabelSchema = z.object({
  name: z.string(),
  existing: z.boolean(),
});

const accountSchema = z.object({
  userId: z.uuid(),
  displayName: z.string(),
});

/**
 * What a move of the Event into the target space would do. The links it
 * drops with a warning are the dropped links and the unassigned to-dos;
 * `expectedDroppedLinks` is their sum, which the move must be given back.
 * Links already removed, and links and assignees of records in Trash, are
 * cleared too and only counted. People cards scoped to the Event stay in
 * the old space as their own scope.
 */
export const objectMovePreviewSchema = z.object({
  eventId: z.uuid(),
  from: accessibleWorkspaceSchema,
  to: accessibleWorkspaceSchema,
  moves: objectMoveCountsSchema,
  droppedLinks: listed(objectMoveDroppedLinkSchema),
  unassignedTasks: listed(objectMoveUnassignedTaskSchema),
  labels: listed(objectMoveLabelSchema),
  peopleKept: listed(z.object({ id: z.uuid(), displayName: z.string() })),
  clearedLinks: countSchema,
  access: z.object({
    targetMembers: z.object({
      owner: countSchema,
      editor: countSchema,
      viewer: countSchema,
    }),
    /** Accounts the Event stays shared with, by their strongest share. */
    keepingShares: listed(accountSchema.extend({ role: roleSchema })),
    /** Accounts whose shares the move revokes because their membership of the target covers them. */
    droppedGrants: listed(
      accountSchema.extend({ role: roleSchema, memberRole: roleSchema }),
    ),
    /** Members of the old space who are not members of the target and hold no share of the Event. */
    losingAccess: listed(accountSchema),
    /** Shares waiting on an invitation that will lapse when accepted, their sharer unable to share in the target. */
    lapsingShares: countSchema,
  }),
  expectedDroppedLinks: countSchema,
});

export const objectMovePreviewQuerySchema = z.object({ to: idSchema });

/**
 * Moves the Event into the space. `expectedDroppedLinks` is the preview's
 * count; the move is refused when it differs. A repeat with the same
 * `commandId` returns the first result.
 */
export const objectMoveRequestSchema = z
  .object({
    workspaceId: idSchema,
    expectedDroppedLinks: countSchema.max(2_147_483_647),
    commandId: idSchema.optional(),
  })
  .strict();

/** What a move did, as recorded in both spaces' audit. */
export const objectMoveSummarySchema = z.object({
  commandId: z.uuid().nullable(),
  from: workspaceSummarySchema,
  to: workspaceSummarySchema,
  moves: objectMoveCountsSchema,
  droppedLinks: countSchema,
  unassignedTasks: countSchema,
  clearedLinks: countSchema,
  labelsJoined: countSchema,
  labelsCreated: countSchema,
  grantsDropped: countSchema,
  peopleKept: countSchema,
  movedAt: z.iso.datetime(),
});

export const objectMoveResponseSchema = z.object({
  event: eventResponseSchema,
  move: objectMoveSummarySchema,
});

export type ObjectMoveTarget = z.infer<typeof objectMoveTargetSchema>;
export type ObjectMoveTargetsResponse = z.infer<
  typeof objectMoveTargetsResponseSchema
>;
export type ObjectMoveCounts = z.infer<typeof objectMoveCountsSchema>;
export type ObjectMoveDroppedLink = z.infer<typeof objectMoveDroppedLinkSchema>;
export type ObjectMoveUnassignedTask = z.infer<
  typeof objectMoveUnassignedTaskSchema
>;
export type ObjectMovePreview = z.infer<typeof objectMovePreviewSchema>;
export type ObjectMovePreviewQuery = z.infer<
  typeof objectMovePreviewQuerySchema
>;
export type ObjectMoveRequest = z.infer<typeof objectMoveRequestSchema>;
export type ObjectMoveSummary = z.infer<typeof objectMoveSummarySchema>;
export type ObjectMoveResponse = z.infer<typeof objectMoveResponseSchema>;
