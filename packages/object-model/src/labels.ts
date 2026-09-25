import {
  AuthorizationDeniedError,
  AuthorizationService,
  DrizzleAuthorizationStore,
  type UserPrincipal,
} from "@livtales/authorization";
import { createId, labels, type Database } from "@livtales/db";
import { and, asc, eq, ne, sql } from "drizzle-orm";

import {
  InvalidObjectStateError,
  LabelNameConflictError,
  ObjectConflictError,
} from "./errors.js";

/** A workspace-level name a Task may carry; unique per workspace, case-insensitively. */
export interface LabelResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface LabelReadRepository {
  /** Every label of the workspace in name order; the caller has workspace access. */
  listLabels(principal: UserPrincipal): Promise<readonly LabelResource[]>;
}

export interface LabelWriteRepository {
  createLabel(principal: UserPrincipal, name: string): Promise<LabelResource>;
  updateLabel(
    principal: UserPrincipal,
    labelId: string,
    expectedVersion: number,
    name: string,
  ): Promise<LabelResource>;
  deleteLabel(
    principal: UserPrincipal,
    labelId: string,
    expectedVersion: number,
  ): Promise<LabelResource>;
}

export const labelNameMessage =
  "A label name is 1 to 40 characters without surrounding spaces.";

function assertLabelName(name: string): void {
  if (name !== name.trim() || name.length < 1 || name.length > 40)
    throw new InvalidObjectStateError(labelNameMessage);
}

function labelResource(row: typeof labels.$inferSelect): LabelResource {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PostgresLabelRepository
  implements LabelReadRepository, LabelWriteRepository
{
  readonly #database: Database;
  readonly #authorization: AuthorizationService;

  constructor(database: Database, clock: () => Date = () => new Date()) {
    this.#database = database;
    this.#authorization = new AuthorizationService(
      new DrizzleAuthorizationStore(database),
      clock,
    );
  }

  async listLabels(
    principal: UserPrincipal,
  ): Promise<readonly LabelResource[]> {
    if (
      !(await this.#authorization.canAccessWorkspace(
        principal.userId,
        principal.workspaceId,
      ))
    )
      throw new AuthorizationDeniedError();
    const rows = await this.#database
      .select()
      .from(labels)
      .where(eq(labels.workspaceId, principal.workspaceId))
      .orderBy(asc(sql`lower(${labels.name})`), asc(labels.id));
    return rows.map(labelResource);
  }

  async createLabel(
    principal: UserPrincipal,
    name: string,
  ): Promise<LabelResource> {
    await this.#authorization.assertCanCreateInWorkspace(principal);
    assertLabelName(name);
    return this.#database.transaction(async (transaction) => {
      await assertNameFree(transaction, principal.workspaceId, null, name);
      const [row] = await transaction
        .insert(labels)
        .values({
          id: createId(),
          workspaceId: principal.workspaceId,
          name,
          createdBy: principal.userId,
        })
        .returning();
      if (row === undefined) throw new Error("The label was not created.");
      return labelResource(row);
    });
  }

  async updateLabel(
    principal: UserPrincipal,
    labelId: string,
    expectedVersion: number,
    name: string,
  ): Promise<LabelResource> {
    await this.#authorization.assertCanCreateInWorkspace(principal);
    return this.#database.transaction(async (transaction) => {
      const current = await lockLabel(
        transaction,
        principal.workspaceId,
        labelId,
      );
      if (current.version !== expectedVersion) throw new ObjectConflictError();
      assertLabelName(name);
      await assertNameFree(transaction, principal.workspaceId, labelId, name);
      const [row] = await transaction
        .update(labels)
        .set({
          name,
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(labels.id, labelId))
        .returning();
      if (row === undefined) throw new Error("The label was not updated.");
      return labelResource(row);
    });
  }

  async deleteLabel(
    principal: UserPrincipal,
    labelId: string,
    expectedVersion: number,
  ): Promise<LabelResource> {
    await this.#authorization.assertCanCreateInWorkspace(principal);
    return this.#database.transaction(async (transaction) => {
      const current = await lockLabel(
        transaction,
        principal.workspaceId,
        labelId,
      );
      if (current.version !== expectedVersion) throw new ObjectConflictError();
      await transaction.delete(labels).where(eq(labels.id, labelId));
      return labelResource(current);
    });
  }
}

type LabelTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function lockLabel(
  transaction: LabelTransaction,
  workspaceId: string,
  labelId: string,
) {
  const [current] = await transaction
    .select()
    .from(labels)
    .where(and(eq(labels.workspaceId, workspaceId), eq(labels.id, labelId)))
    .for("update")
    .limit(1);
  if (current === undefined) throw new AuthorizationDeniedError();
  return current;
}

async function assertNameFree(
  transaction: LabelTransaction,
  workspaceId: string,
  labelId: string | null,
  name: string,
): Promise<void> {
  const [taken] = await transaction
    .select({ id: labels.id })
    .from(labels)
    .where(
      and(
        eq(labels.workspaceId, workspaceId),
        eq(sql`lower(${labels.name})`, name.toLowerCase()),
        labelId === null ? undefined : ne(labels.id, labelId),
      ),
    )
    .limit(1);
  if (taken !== undefined) throw new LabelNameConflictError();
}

/** Label reads and writes through the repositories a deployment selects. */
export class LabelService {
  readonly #reads: LabelReadRepository;
  readonly #writes: LabelWriteRepository;

  constructor(reads: LabelReadRepository, writes: LabelWriteRepository) {
    this.#reads = reads;
    this.#writes = writes;
  }

  listLabels(principal: UserPrincipal): Promise<readonly LabelResource[]> {
    return this.#reads.listLabels(principal);
  }

  createLabel(principal: UserPrincipal, name: string): Promise<LabelResource> {
    return this.#writes.createLabel(principal, name);
  }

  updateLabel(
    principal: UserPrincipal,
    labelId: string,
    expectedVersion: number,
    name: string,
  ): Promise<LabelResource> {
    return this.#writes.updateLabel(principal, labelId, expectedVersion, name);
  }

  deleteLabel(
    principal: UserPrincipal,
    labelId: string,
    expectedVersion: number,
  ): Promise<LabelResource> {
    return this.#writes.deleteLabel(principal, labelId, expectedVersion);
  }
}
