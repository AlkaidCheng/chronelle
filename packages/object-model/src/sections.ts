import {
  AuthorizationDeniedError,
  type UserPrincipal,
  withReadAuthorization,
  withStableAuthorization,
} from "@chronelle/authorization";
import {
  createId,
  type Database,
  type DatabaseTransaction,
  objects,
  type SectionView,
  sections,
} from "@chronelle/db";
import { rankBetween } from "@chronelle/schemas";
import { and, asc, desc, eq, gt, isNull, ne, or } from "drizzle-orm";

import { InvalidObjectStateError } from "./errors.js";
import type { SectionResource } from "./types.js";

export interface CreateSectionInput {
  readonly view: SectionView;
  readonly name: string;
  readonly description?: string | null | undefined;
  /** The section to place it after; null puts it first; absent puts it last. */
  readonly afterSectionId?: string | null | undefined;
}

export interface UpdateSectionInput {
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  /** The section to move it after; null moves it first; absent leaves it. */
  readonly afterSectionId?: string | null | undefined;
}

export interface SectionReadRepository {
  /** The sections of one view of an Event in their order; the caller may view the Event. */
  listSections(
    principal: UserPrincipal,
    eventId: string,
    view: SectionView,
  ): Promise<readonly SectionResource[]>;
}

export interface SectionWriteRepository {
  createSection(
    principal: UserPrincipal,
    eventId: string,
    input: CreateSectionInput,
  ): Promise<SectionResource>;
  updateSection(
    principal: UserPrincipal,
    sectionId: string,
    input: UpdateSectionInput,
  ): Promise<SectionResource>;
  /** Deleting a section leaves its records in the view without one. */
  deleteSection(
    principal: UserPrincipal,
    sectionId: string,
  ): Promise<SectionResource>;
}

export const sectionNameMessage =
  "A section name is 1 to 120 characters without surrounding spaces.";
export const sectionDescriptionMessage =
  "description is 1 to 2000 characters without surrounding spaces.";
export const sectionPlacementMessage =
  "afterSectionId must name another section of this view.";

function assertSectionName(name: string): void {
  if (name !== name.trim() || name.length < 1 || name.length > 120)
    throw new InvalidObjectStateError(sectionNameMessage);
}

function assertSectionDescription(description: string | null): void {
  if (
    description !== null &&
    (description !== description.trim() ||
      description.length < 1 ||
      description.length > 2000)
  )
    throw new InvalidObjectStateError(sectionDescriptionMessage);
}

function sectionResource(row: typeof sections.$inferSelect): SectionResource {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    eventId: row.eventId,
    view: row.view,
    name: row.name,
    description: row.description,
    rank: row.rank,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PostgresSectionRepository
  implements SectionReadRepository, SectionWriteRepository
{
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  listSections(
    principal: UserPrincipal,
    eventId: string,
    view: SectionView,
  ): Promise<readonly SectionResource[]> {
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        const event = { id: eventId, workspaceId: principal.workspaceId };
        await authorization.assertCan(principal, "view", event);
        const rows = await transaction
          .select()
          .from(sections)
          .where(
            and(
              eq(sections.workspaceId, principal.workspaceId),
              eq(sections.eventId, eventId),
              eq(sections.view, view),
            ),
          )
          .orderBy(asc(sections.rank), asc(sections.id));
        // A viewer whose grants are narrowed sees the view's sections when
        // the view is shared whole, else the sections shared on their own.
        const narrowing = await authorization.narrowing(principal, event);
        const shown =
          narrowing === null || narrowing.views.includes(view)
            ? rows
            : rows.filter((row) =>
                narrowing.sections.some((section) => section.id === row.id),
              );
        return shown.map(sectionResource);
      },
    );
  }

  createSection(
    principal: UserPrincipal,
    eventId: string,
    input: CreateSectionInput,
  ): Promise<SectionResource> {
    const description = input.description ?? null;
    return withStableAuthorization(
      this.#database,
      principal.workspaceId,
      async (transaction, authorization) => {
        await authorization.assertCan(principal, "edit", {
          id: eventId,
          workspaceId: principal.workspaceId,
        });
        await assertLiveEvent(transaction, principal.workspaceId, eventId);
        assertSectionName(input.name);
        assertSectionDescription(description);
        await lockSiblings(
          transaction,
          principal.workspaceId,
          eventId,
          input.view,
          null,
        );
        const rank = await rankAt(
          transaction,
          principal.workspaceId,
          eventId,
          input.view,
          null,
          input.afterSectionId,
        );
        const [row] = await transaction
          .insert(sections)
          .values({
            id: createId(),
            workspaceId: principal.workspaceId,
            eventId,
            view: input.view,
            name: input.name,
            description,
            rank,
            createdBy: principal.userId,
          })
          .returning();
        if (row === undefined) throw new Error("The section was not created.");
        return sectionResource(row);
      },
    );
  }

  updateSection(
    principal: UserPrincipal,
    sectionId: string,
    input: UpdateSectionInput,
  ): Promise<SectionResource> {
    return withStableAuthorization(
      this.#database,
      principal.workspaceId,
      async (transaction, authorization) => {
        const current = await lockSection(
          transaction,
          principal.workspaceId,
          sectionId,
        );
        await authorization.assertCan(principal, "edit", {
          id: current.eventId,
          workspaceId: principal.workspaceId,
        });
        if (input.name !== undefined) assertSectionName(input.name);
        if (input.description !== undefined)
          assertSectionDescription(input.description);
        let rank = current.rank;
        if (input.afterSectionId !== undefined) {
          await lockSiblings(
            transaction,
            principal.workspaceId,
            current.eventId,
            current.view,
            sectionId,
          );
          rank = await rankAt(
            transaction,
            principal.workspaceId,
            current.eventId,
            current.view,
            sectionId,
            input.afterSectionId,
          );
        }
        const [row] = await transaction
          .update(sections)
          .set({
            ...(input.name !== undefined && { name: input.name }),
            ...(input.description !== undefined && {
              description: input.description,
            }),
            rank,
            updatedAt: new Date(),
          })
          .where(eq(sections.id, sectionId))
          .returning();
        if (row === undefined) throw new Error("The section was not updated.");
        return sectionResource(row);
      },
    );
  }

  deleteSection(
    principal: UserPrincipal,
    sectionId: string,
  ): Promise<SectionResource> {
    return withStableAuthorization(
      this.#database,
      principal.workspaceId,
      async (transaction, authorization) => {
        const current = await lockSection(
          transaction,
          principal.workspaceId,
          sectionId,
        );
        await authorization.assertCan(principal, "edit", {
          id: current.eventId,
          workspaceId: principal.workspaceId,
        });
        await transaction.delete(sections).where(eq(sections.id, sectionId));
        return sectionResource(current);
      },
    );
  }
}

async function assertLiveEvent(
  transaction: DatabaseTransaction,
  workspaceId: string,
  eventId: string,
): Promise<void> {
  const [event] = await transaction
    .select({ id: objects.id })
    .from(objects)
    .where(
      and(
        eq(objects.workspaceId, workspaceId),
        eq(objects.id, eventId),
        eq(objects.objectType, "event"),
        isNull(objects.deletedAt),
      ),
    )
    .limit(1);
  if (event === undefined) throw new AuthorizationDeniedError();
}

async function lockSection(
  transaction: DatabaseTransaction,
  workspaceId: string,
  sectionId: string,
) {
  const [current] = await transaction
    .select()
    .from(sections)
    .where(
      and(eq(sections.workspaceId, workspaceId), eq(sections.id, sectionId)),
    )
    .for("update")
    .limit(1);
  if (current === undefined) throw new AuthorizationDeniedError();
  return current;
}

/** Siblings are locked so two placements never compute the same neighbours. */
async function lockSiblings(
  transaction: DatabaseTransaction,
  workspaceId: string,
  eventId: string,
  view: SectionView,
  exceptId: string | null,
): Promise<void> {
  await transaction
    .select({ id: sections.id })
    .from(sections)
    .where(
      and(
        eq(sections.workspaceId, workspaceId),
        eq(sections.eventId, eventId),
        eq(sections.view, view),
        exceptId === null ? undefined : ne(sections.id, exceptId),
      ),
    )
    .for("update");
}

/**
 * The rank a section takes at a place among its siblings: after the named
 * section, first when the place is null, or last when none is given. The
 * moving section itself never counts as a neighbour.
 */
async function rankAt(
  transaction: DatabaseTransaction,
  workspaceId: string,
  eventId: string,
  view: SectionView,
  sectionId: string | null,
  afterSectionId: string | null | undefined,
): Promise<string> {
  const siblings = and(
    eq(sections.workspaceId, workspaceId),
    eq(sections.eventId, eventId),
    eq(sections.view, view),
    sectionId === null ? undefined : ne(sections.id, sectionId),
  );
  if (afterSectionId === undefined) {
    const [last] = await transaction
      .select({ rank: sections.rank })
      .from(sections)
      .where(siblings)
      .orderBy(desc(sections.rank), desc(sections.id))
      .limit(1);
    return rankBetween(last?.rank ?? null, null);
  }
  let before: { rank: string; id: string } | null = null;
  if (afterSectionId !== null) {
    const [named] = await transaction
      .select({ rank: sections.rank, id: sections.id })
      .from(sections)
      .where(and(siblings, eq(sections.id, afterSectionId)))
      .limit(1);
    if (named === undefined)
      throw new InvalidObjectStateError(sectionPlacementMessage);
    before = named;
  }
  const [next] = await transaction
    .select({ rank: sections.rank })
    .from(sections)
    .where(
      and(
        siblings,
        before === null
          ? undefined
          : or(
              gt(sections.rank, before.rank),
              and(eq(sections.rank, before.rank), gt(sections.id, before.id)),
            ),
      ),
    )
    .orderBy(asc(sections.rank), asc(sections.id))
    .limit(1);
  return rankBetween(before?.rank ?? null, next?.rank ?? null);
}

/** Section reads and writes through the repositories a deployment selects. */
export class SectionService {
  readonly #reads: SectionReadRepository;
  readonly #writes: SectionWriteRepository;

  constructor(reads: SectionReadRepository, writes: SectionWriteRepository) {
    this.#reads = reads;
    this.#writes = writes;
  }

  listSections(
    principal: UserPrincipal,
    eventId: string,
    view: SectionView,
  ): Promise<readonly SectionResource[]> {
    return this.#reads.listSections(principal, eventId, view);
  }

  createSection(
    principal: UserPrincipal,
    eventId: string,
    input: CreateSectionInput,
  ): Promise<SectionResource> {
    return this.#writes.createSection(principal, eventId, input);
  }

  updateSection(
    principal: UserPrincipal,
    sectionId: string,
    input: UpdateSectionInput,
  ): Promise<SectionResource> {
    return this.#writes.updateSection(principal, sectionId, input);
  }

  deleteSection(
    principal: UserPrincipal,
    sectionId: string,
  ): Promise<SectionResource> {
    return this.#writes.deleteSection(principal, sectionId);
  }
}
