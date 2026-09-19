import {
  createId,
  objectRevisions,
  objects,
  type Database,
} from "@chronelle/db";
import { and, eq, gt, inArray, isNull, max, sql } from "drizzle-orm";

import { recordObjectRevision } from "./object-revisions.js";
import { readObjectStates } from "./object-state.js";

/** Refuse startup when an existing canonical version has no durable snapshot. */
export async function assertRevisionBaseline(
  database: Database,
): Promise<void> {
  const [missing] = await database
    .select({ id: objects.id })
    .from(objects)
    .leftJoin(
      objectRevisions,
      and(
        eq(objectRevisions.workspaceId, objects.workspaceId),
        eq(objectRevisions.objectId, objects.id),
        eq(objectRevisions.objectVersion, objects.version),
      ),
    )
    .where(isNull(objectRevisions.id))
    .limit(1);
  if (missing !== undefined) {
    throw new Error(
      "Object revision baseline is missing; run db:baseline-revisions before starting the API.",
    );
  }
}

/** Capture only available states. Stop all API writers for the deployment. */
export async function baselineObjectRevisions(
  database: Database,
): Promise<number> {
  return database.transaction(async (transaction) => {
    await transaction.execute(
      sql`LOCK TABLE objects, events, tasks, expenses, reminders, documents, persons, notes, object_revisions IN SHARE ROW EXCLUSIVE MODE`,
    );
    const requestId = createId();
    let afterId: string | undefined;
    let count = 0;
    while (true) {
      const states = await readObjectStates(
        transaction,
        afterId === undefined ? sql`true` : gt(objects.id, afterId),
        100,
      );
      if (states.length === 0) return count;
      const latest = await transaction
        .select({
          objectId: objectRevisions.objectId,
          version: max(objectRevisions.objectVersion),
        })
        .from(objectRevisions)
        .where(
          inArray(
            objectRevisions.objectId,
            states.map((state) => state.id),
          ),
        )
        .groupBy(objectRevisions.objectId);
      const versions = new Map(
        latest.map((row) => [row.objectId, row.version]),
      );
      for (const resource of states) {
        const existing = versions.get(resource.id);
        if (existing !== undefined) {
          if (existing !== resource.version)
            throw new Error(
              "An existing revision chain is incomplete; baseline cannot repair history.",
            );
          continue;
        }
        await recordObjectRevision(
          transaction,
          resource,
          { actorId: null, actorType: "system", requestId },
          "baseline",
        );
        count += 1;
      }
      afterId = states.at(-1)?.id;
    }
  });
}
