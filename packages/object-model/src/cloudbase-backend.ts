import type { CloudBaseRdbClient } from "@chronelle/db";

/**
 * The database functions the CloudBase adapters of this package call. A
 * deployment that serves from the gateway alone verifies at startup that
 * each is installed.
 */
export const cloudBaseObjectModelFunctions: readonly string[] = [
  "chronelle_event_list_candidates",
  "chronelle_task_list_candidates",
  "chronelle_task_list_hydrate",
  "chronelle_person_list_candidates",
  "chronelle_backend_readiness",
  "chronelle_revision_baseline",
  "chronelle_event_create",
  "chronelle_event_update",
  "chronelle_task_create",
  "chronelle_task_update",
  "chronelle_expense_create",
  "chronelle_expense_update",
  "chronelle_reminder_create",
  "chronelle_reminder_update",
  "chronelle_person_create",
  "chronelle_person_update",
  "chronelle_note_create",
  "chronelle_note_update",
  "chronelle_note_list",
  "chronelle_section_create",
  "chronelle_section_update",
  "chronelle_section_delete",
  "chronelle_section_list",
  "chronelle_event_context_create",
  "chronelle_relation_create",
  "chronelle_relation_lifecycle",
  "chronelle_object_delete",
  "chronelle_object_recover",
  "chronelle_object_restore",
  "chronelle_resource_share",
  "chronelle_resource_share_revoke",
  "chronelle_resource_share_leave",
  "chronelle_grant_admits",
  "chronelle_section_visible",
  "chronelle_object_scope_update",
  "chronelle_object_search",
  "chronelle_event_layout_update",
  "chronelle_event_layout_restore",
  "chronelle_command_execute",
  "chronelle_command_transition",
  "chronelle_command_state",
  "chronelle_storage_references",
  "chronelle_document_transfer_authorize",
  "chronelle_document_transfer_consume",
  "chronelle_document_finalize",
];

export class CloudBaseBackendNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudBaseBackendNotReadyError";
  }
}

/**
 * Refuses to serve from the gateway until every required function is
 * installed and every live object has a revision for its current version,
 * the two conditions the PostgreSQL startup checks through its own
 * connection.
 */
export async function assertCloudBaseBackendReady(
  client: Pick<CloudBaseRdbClient, "rpc">,
  requiredFunctions: readonly string[] = cloudBaseObjectModelFunctions,
): Promise<void> {
  let readiness: unknown;
  try {
    readiness = await client.rpc("chronelle_backend_readiness", {});
  } catch (error) {
    throw new CloudBaseBackendNotReadyError(
      `chronelle_backend_readiness is not callable; apply the migrations through 0029 first (${
        error instanceof Error ? error.message : String(error)
      }).`,
    );
  }
  const record =
    readiness !== null && typeof readiness === "object"
      ? (readiness as { functions?: unknown; objectsWithoutBaseline?: unknown })
      : {};
  const installed = new Set(
    Array.isArray(record.functions)
      ? record.functions.filter((name) => typeof name === "string")
      : [],
  );
  const missing = requiredFunctions.filter((name) => !installed.has(name));
  if (missing.length > 0) {
    throw new CloudBaseBackendNotReadyError(
      `The CloudBase environment lacks required functions: ${missing.join(", ")}.`,
    );
  }
  if (record.objectsWithoutBaseline !== 0) {
    throw new CloudBaseBackendNotReadyError(
      "Object revision baseline is missing; run cloudbase:baseline (or db:baseline-revisions through PostgreSQL) before starting the API.",
    );
  }
}
