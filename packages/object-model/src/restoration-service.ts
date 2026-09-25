import {
  AuthorizationDeniedError,
  withReadAuthorization,
  type AuthorizationService,
  withStableAuthorization,
  type UserPrincipal,
} from "@livtales/authorization";
import {
  events,
  tasks,
  reminders,
  persons,
  notes,
  objects,
  objectRevisions,
  type Database,
  type DatabaseTransaction,
} from "@livtales/db";
import {
  revisionSnapshotSchema,
  eventUpdateRequestSchema,
  taskUpdateRequestSchema,
  reminderUpdateRequestSchema,
  personUpdateRequestSchema,
  noteUpdateRequestSchema,
  type RevisionComparisonQuery,
  type RevisionRestoreRequest,
  type RevisionSnapshot,
} from "@livtales/schemas";
import { and, eq, isNull, sql } from "drizzle-orm";

import { InvalidObjectStateError, ObjectConflictError } from "./errors.js";
import type { ObjectReadRepository } from "./object-reads.js";
import { readObjectState } from "./object-state.js";
import type { ObjectLifecycleWriteRepository } from "./object-writes.js";
import { recordObjectRevision } from "./object-revisions.js";
import { assertPersonText, setPersonContacts } from "./person-contacts.js";
import {
  decodeRevisionSnapshot,
  type RevisionReadRepository,
} from "./revision-reads.js";
import {
  compareRevisionContent,
  preservedRevisionFields,
  selectRestorableContent,
} from "./restoration-policy.js";
import { serializeResource } from "./serialization.js";
import type { EventPlanningResource, MutationContext } from "./types.js";

async function readRevision(
  transaction: DatabaseTransaction,
  principal: UserPrincipal,
  objectId: string,
  version: number,
) {
  const [revision] = await transaction
    .select({
      id: objectRevisions.id,
      snapshot: objectRevisions.snapshot,
      schemaVersion: objectRevisions.snapshotSchemaVersion,
    })
    .from(objectRevisions)
    .where(
      and(
        eq(objectRevisions.workspaceId, principal.workspaceId),
        eq(objectRevisions.objectId, objectId),
        eq(objectRevisions.objectVersion, version),
      ),
    )
    .limit(1);
  if (revision === undefined) throw new AuthorizationDeniedError();
  return {
    id: revision.id,
    snapshot: decodeRevisionSnapshot(revision.schemaVersion, revision.snapshot),
  };
}

/** A revision selected as the source of a comparison or a restoration. */
interface SourceRevision {
  readonly id: string;
  readonly snapshot: RevisionSnapshot;
}

/** The content the policy allows back from a source revision, or the service's refusal. */
function selectRestoration(
  current: EventPlanningResource,
  source: SourceRevision,
) {
  if (source.snapshot.deletedAt !== null)
    throw new InvalidObjectStateError(
      "A deleted state cannot be restored through content history.",
    );
  const changes = compareRevisionContent(
    revisionSnapshotSchema.parse(serializeResource(current)),
    source.snapshot,
  );
  if (!changes.some((change) => change.restorable))
    throw new InvalidObjectStateError(
      "This revision has no restorable content changes.",
    );
  return { source, content: selectRestorableContent(source.snapshot) };
}

function comparison(
  objectId: string,
  input: RevisionComparisonQuery,
  before: SourceRevision,
  after: SourceRevision,
) {
  return {
    objectId,
    ...input,
    changes: compareRevisionContent(before.snapshot, after.snapshot),
  };
}

function restorationPreview(
  objectId: string,
  current: RevisionSnapshot,
  source: SourceRevision,
  version: number,
  canEdit: boolean,
) {
  const changes = compareRevisionContent(current, source.snapshot);
  return {
    objectId,
    sourceRevisionId: source.id,
    sourceVersion: version,
    currentVersion: current.version,
    changes,
    preservedFields: preservedRevisionFields(current.objectType),
    canRestore:
      source.snapshot.deletedAt === null &&
      changes.some((change) => change.restorable) &&
      canEdit,
  };
}

/**
 * The reads the comparison, the preview, and the restoration policy run on
 * when they do not read PostgreSQL themselves: the live object with its
 * allowed actions, and single revisions.
 */
export interface RestorationReadRepositories {
  readonly objects: ObjectReadRepository;
  readonly revisions: RevisionReadRepository;
}

export class ObjectRestorationService {
  readonly #database: Database;
  readonly #writes: ObjectLifecycleWriteRepository | undefined;
  readonly #reads: RestorationReadRepositories | undefined;

  constructor(
    database: Database,
    writes?: ObjectLifecycleWriteRepository,
    reads?: RestorationReadRepositories,
  ) {
    this.#database = database;
    this.#writes = writes;
    this.#reads = reads;
  }

  async compare(
    principal: UserPrincipal,
    objectId: string,
    input: RevisionComparisonQuery,
  ) {
    if (this.#reads !== undefined) {
      const { revisions } = this.#reads;
      return comparison(
        objectId,
        input,
        await revisions.getRevision(principal, objectId, input.fromVersion),
        await revisions.getRevision(principal, objectId, input.toVersion),
      );
    }
    return this.#readAuthorized(principal, objectId, async (transaction) =>
      comparison(
        objectId,
        input,
        await readRevision(transaction, principal, objectId, input.fromVersion),
        await readRevision(transaction, principal, objectId, input.toVersion),
      ),
    );
  }

  async preview(principal: UserPrincipal, objectId: string, version: number) {
    if (this.#reads !== undefined) {
      const { objects, revisions } = this.#reads;
      const current = revisionSnapshotSchema.parse(
        serializeResource(await objects.getObject(principal, objectId)),
      );
      const source = await revisions.getRevision(principal, objectId, version);
      const actions = await objects.getAllowedActions(principal, objectId);
      return restorationPreview(
        objectId,
        current,
        source,
        version,
        actions.includes("edit"),
      );
    }
    return this.#readAuthorized(
      principal,
      objectId,
      async (transaction, authorization) => {
        const current = revisionSnapshotSchema.parse(
          serializeResource(
            await readObjectState(transaction, principal.workspaceId, objectId),
          ),
        );
        const source = await readRevision(
          transaction,
          principal,
          objectId,
          version,
        );
        return restorationPreview(
          objectId,
          current,
          source,
          version,
          await authorization.can(principal, "edit", {
            id: objectId,
            workspaceId: principal.workspaceId,
          }),
        );
      },
    );
  }

  /** Apply historical content as a new live version, preserving current security and immutable facts. */
  async restore(
    context: MutationContext,
    objectId: string,
    version: number,
    input: RevisionRestoreRequest,
  ) {
    const { principal } = context;
    if (this.#writes !== undefined) {
      // The policy runs on a read of the current state and the source
      // revision; the function re-checks the version, so a change in between
      // is a conflict rather than a lost update.
      const { source, content } =
        this.#reads !== undefined
          ? await this.#selectThroughReads(
              this.#reads,
              principal,
              objectId,
              version,
              input.expectedVersion,
            )
          : await withReadAuthorization(
              this.#database,
              async (transaction, authorization) => {
                await authorization.assertCan(principal, "edit", {
                  id: objectId,
                  workspaceId: principal.workspaceId,
                });
                const current = await readObjectState(
                  transaction,
                  principal.workspaceId,
                  objectId,
                );
                if (current.version !== input.expectedVersion)
                  throw new ObjectConflictError();
                return selectRestoration(
                  current,
                  await readRevision(transaction, principal, objectId, version),
                );
              },
            );
      return this.#writes.restore(context, objectId, input.expectedVersion, {
        revisionId: source.id,
        version,
        content,
      });
    }
    return withStableAuthorization(
      this.#database,
      principal.workspaceId,
      async (transaction, authorization) => {
        await authorization.assertCan(principal, "edit", {
          id: objectId,
          workspaceId: principal.workspaceId,
        });
        const current = await readObjectState(
          transaction,
          principal.workspaceId,
          objectId,
        );
        if (current.version !== input.expectedVersion)
          throw new ObjectConflictError();
        const { source, content } = selectRestoration(
          current,
          await readRevision(transaction, principal, objectId, version),
        );
        const [updated] = await transaction
          .update(objects)
          .set({
            displayName: source.snapshot.displayName,
            customProperties: source.snapshot.customProperties,
            updatedAt: new Date(),
            version: sql`${objects.version} + 1`,
          })
          .where(
            and(
              eq(objects.workspaceId, principal.workspaceId),
              eq(objects.id, objectId),
              eq(objects.version, input.expectedVersion),
              isNull(objects.deletedAt),
            ),
          )
          .returning({ id: objects.id });
        if (updated === undefined) throw new ObjectConflictError();
        await this.#restoreTypedContent(
          transaction,
          principal.workspaceId,
          objectId,
          source.snapshot,
          content,
        );
        return recordObjectRevision(
          transaction,
          await readObjectState(transaction, principal.workspaceId, objectId),
          {
            actorId: principal.userId,
            actorType: "user",
            requestId: context.requestId,
          },
          "restored",
          { previousVersion: current.version, sourceVersion: version },
          source.id,
        );
      },
    );
  }

  async #restoreTypedContent(
    transaction: DatabaseTransaction,
    workspaceId: string,
    objectId: string,
    source: RevisionSnapshot,
    content: Record<string, unknown>,
  ) {
    switch (source.objectType) {
      case "event": {
        const fields = eventUpdateRequestSchema.parse({
          ...content,
          expectedVersion: source.version,
        });
        await transaction
          .update(events)
          .set({
            startsAt: fields.startsAt,
            startsOn: fields.startsOn,
            endsOn: fields.endsOn,
            endsAt: fields.endsAt,
            timezone: fields.timezone,
            isAllDay: fields.isAllDay,
            location: fields.location,
            description: fields.description,
          })
          .where(
            and(
              eq(events.workspaceId, workspaceId),
              eq(events.objectId, objectId),
            ),
          );
        break;
      }
      case "task": {
        const fields = taskUpdateRequestSchema.parse({
          ...content,
          expectedVersion: source.version,
        });
        await transaction
          .update(tasks)
          .set({
            status: fields.status,
            dueOn: fields.dueOn,
            dueAt: fields.dueAt,
            // A restored state without a due instant keeps no duration, and
            // one without a due keeps no repeat rule.
            durationMinutes:
              fields.dueAt === null ? null : fields.durationMinutes,
            repeatRule:
              fields.dueOn === null && fields.dueAt === null
                ? null
                : fields.repeatRule,
            repeatUntil:
              fields.dueOn === null && fields.dueAt === null
                ? null
                : (fields.repeatUntil ?? null),
            completedAt: fields.completedAt,
            location: fields.location,
            description: fields.description,
          })
          .where(
            and(
              eq(tasks.workspaceId, workspaceId),
              eq(tasks.objectId, objectId),
            ),
          );
        break;
      }
      case "reminder": {
        const fields = reminderUpdateRequestSchema.parse({
          ...content,
          expectedVersion: source.version,
        });
        await transaction
          .update(reminders)
          .set({ remindAt: fields.remindAt })
          .where(
            and(
              eq(reminders.workspaceId, workspaceId),
              eq(reminders.objectId, objectId),
            ),
          );
        break;
      }
      case "person": {
        const fields = personUpdateRequestSchema.parse({
          ...content,
          expectedVersion: source.version,
        });
        const contacts = fields.contacts;
        const text = {
          ...(fields.nickname !== undefined && { nickname: fields.nickname }),
          ...(fields.description !== undefined && {
            description: fields.description,
          }),
        };
        assertPersonText(fields.nickname ?? null, fields.description ?? null);
        if (Object.keys(text).length > 0)
          await transaction
            .update(persons)
            .set(text)
            .where(
              and(
                eq(persons.workspaceId, workspaceId),
                eq(persons.objectId, objectId),
              ),
            );
        if (contacts !== undefined)
          await setPersonContacts(transaction, workspaceId, objectId, contacts);
        break;
      }
      case "note": {
        const fields = noteUpdateRequestSchema.parse({
          ...content,
          expectedVersion: source.version,
        });
        if (fields.body !== undefined)
          await transaction
            .update(notes)
            .set({ body: fields.body })
            .where(
              and(
                eq(notes.workspaceId, workspaceId),
                eq(notes.objectId, objectId),
              ),
            );
        break;
      }
      case "expense":
      case "document":
        break;
    }
  }

  /** The edit check, the version check, and the policy through the read repositories. */
  async #selectThroughReads(
    reads: RestorationReadRepositories,
    principal: UserPrincipal,
    objectId: string,
    version: number,
    expectedVersion: number,
  ) {
    const actions = await reads.objects.getAllowedActions(principal, objectId);
    if (!actions.includes("edit")) throw new AuthorizationDeniedError();
    const current = await reads.objects.getObject(principal, objectId);
    if (current.version !== expectedVersion) throw new ObjectConflictError();
    return selectRestoration(
      current,
      await reads.revisions.getRevision(principal, objectId, version),
    );
  }

  async #readAuthorized<Value>(
    principal: UserPrincipal,
    objectId: string,
    read: (
      transaction: DatabaseTransaction,
      authorization: AuthorizationService,
    ) => Promise<Value>,
  ) {
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        await authorization.assertCan(principal, "view", {
          id: objectId,
          workspaceId: principal.workspaceId,
        });
        return read(transaction, authorization);
      },
    );
  }
}
