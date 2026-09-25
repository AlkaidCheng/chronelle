import { expenses, objects, tasks } from "@livtales/db";
import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { UserPrincipal } from "./authorization.js";

/** The narrowing columns of a grant, as an aliased table or as raw references. */
export interface GrantScopeColumns {
  readonly scope: SQL | PgColumn;
  readonly sectionId: SQL | PgColumn;
}

/**
 * Whether a grant's narrowing admits the object reached through the
 * grant's scope: a whole grant admits everything; a view admits the records
 * it shows (tasks for To-dos, schedule items for Calendar and Itinerary,
 * expenses, reminders, notes); a section admits its own tasks or expenses.
 * The same rule as chronelle_grant_admits.
 */
export function grantAdmits(
  grant: GrantScopeColumns,
  object: typeof objects,
): SQL {
  return sql`(
    ${grant.scope} = 'all'
    OR (${grant.scope} = 'todos' AND ${object.objectType} = 'task'
        AND (${grant.sectionId} IS NULL OR EXISTS (
          SELECT 1 FROM ${tasks} WHERE ${tasks.objectId} = ${object.id} AND ${tasks.sectionId} = ${grant.sectionId})))
    OR (${grant.scope} = 'expenses' AND ${object.objectType} = 'expense'
        AND (${grant.sectionId} IS NULL OR EXISTS (
          SELECT 1 FROM ${expenses} WHERE ${expenses.objectId} = ${object.id} AND ${expenses.sectionId} = ${grant.sectionId})))
    OR (${grant.scope} IN ('calendar', 'itinerary') AND ${object.objectType} = 'event')
    OR (${grant.scope} = 'reminders' AND ${object.objectType} = 'reminder')
    OR (${grant.scope} = 'notes' AND ${object.objectType} = 'note')
  )`;
}

/**
 * Match current Owners through membership, whole direct grants, or grants
 * on the canonical scope that admit the object, including tombstones.
 */
export function recoveryAccessPredicate(
  principal: UserPrincipal,
  evaluatedAt: Date,
): SQL {
  return sql`${objects.workspaceId} = ${principal.workspaceId} AND (
    EXISTS (
      SELECT 1 FROM workspace_members member
      WHERE member.workspace_id = ${objects.workspaceId}
        AND member.user_id = ${principal.userId} AND member.role = 'owner'
    ) OR EXISTS (
      SELECT 1 FROM resource_grants permission
      WHERE permission.workspace_id = ${objects.workspaceId}
        AND permission.principal_type = 'user'
        AND permission.principal_id = ${principal.userId}
        AND permission.role = 'owner'
        AND (permission.expires_at IS NULL OR permission.expires_at > ${evaluatedAt.toISOString()}::timestamptz)
        AND (
          (permission.resource_id = ${objects.id} AND permission.scope = 'all')
          OR (permission.resource_id = ${objects.permissionScopeId}
              AND ${grantAdmits({ scope: sql.raw("permission.scope"), sectionId: sql.raw("permission.section_id") }, objects)})
        )
    )
  )`;
}
