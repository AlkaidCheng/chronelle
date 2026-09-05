import { objects } from "@chronelle/db";
import { sql, type SQL } from "drizzle-orm";
import type { UserPrincipal } from "./authorization.js";

/** Match current Owners through membership, direct grants, or the canonical scope, including tombstones. */
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
        AND permission.resource_id IN (${objects.id}, ${objects.permissionScopeId})
        AND (permission.expires_at IS NULL OR permission.expires_at > ${evaluatedAt.toISOString()}::timestamptz)
    )
  )`;
}
