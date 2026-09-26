import { createId, type Database, resourceGrants, users } from "@livtales/db";
import { eq } from "drizzle-orm";

/**
 * An Owner share of a single record, as one made before a space's owners
 * owned what it holds. The API shares a record only for editing or viewing
 * now, so tests of such a grant, which keeps its rights, seed it directly.
 */
export async function seedOwnerGrant(
  database: Database,
  grant: {
    readonly workspaceId: string;
    readonly resourceId: string;
    readonly principalEmail: string;
    readonly grantedBy: string;
  },
): Promise<{ readonly id: string }> {
  const [principal] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, grant.principalEmail))
    .limit(1);
  if (principal === undefined)
    throw new Error(`No account has the email ${grant.principalEmail}.`);
  const id = createId();
  await database.insert(resourceGrants).values({
    id,
    workspaceId: grant.workspaceId,
    resourceId: grant.resourceId,
    principalId: principal.id,
    role: "owner",
    grantedBy: grant.grantedBy,
  });
  return { id };
}
