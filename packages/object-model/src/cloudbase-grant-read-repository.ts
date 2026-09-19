import {
  AuthorizationDeniedError,
  type GrantReadRepository,
  type ResourceGrantResource,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  roles as roleNames,
  type CloudBaseRdbReader,
  type Role,
} from "@chronelle/db";

import {
  cloudbaseIdBatchSize,
  readCloudBaseObjectRow,
  readCloudBasePrincipalAccess,
} from "./cloudbase-object-read-support.js";
import {
  cloudbaseDate,
  cloudbaseFilters,
  cloudbaseGrantScope,
  cloudbaseNullableDate,
  cloudbaseNullableText,
  cloudbaseText,
} from "./cloudbase-read-support.js";

type GrantRow = {
  readonly id: unknown;
  readonly workspace_id: unknown;
  readonly resource_id: unknown;
  readonly role: unknown;
  readonly granted_by: unknown;
  readonly created_at: unknown;
  readonly expires_at: unknown;
  readonly principal_id: unknown;
  readonly scope?: unknown;
  readonly section_id?: unknown;
};

type UserRow = {
  readonly id: unknown;
  readonly display_name: unknown;
  readonly email: unknown;
};

/**
 * Read-only CloudBase adapter for the grants on one resource. Recovery
 * permission on the resource is evaluated in application code; the gateway
 * orders active grants by creation time then id so timestamp precision is
 * not lost in transit.
 */
export class CloudBaseGrantReadRepository implements GrantReadRepository {
  readonly #client: CloudBaseRdbReader;
  readonly #clock: () => Date;

  constructor(
    client: CloudBaseRdbReader,
    clock: () => Date = () => new Date(),
  ) {
    this.#client = client;
    this.#clock = clock;
  }

  async listGrants(
    principal: UserPrincipal,
    resourceId: string,
  ): Promise<readonly ResourceGrantResource[]> {
    const evaluatedAt = this.#clock();
    const [access, resource] = await Promise.all([
      readCloudBasePrincipalAccess(this.#client, principal, this.#clock),
      readCloudBaseObjectRow(this.#client, principal, resourceId, {
        includeDeleted: true,
      }),
    ]);
    if (!access.canRecover(resource)) throw new AuthorizationDeniedError();
    const rows = await this.#client.select<GrantRow>("resource_grants", {
      columns:
        "id,workspace_id,resource_id,role,granted_by,created_at,expires_at,principal_id,scope,section_id",
      filters: cloudbaseFilters(
        ["workspace_id", "eq", principal.workspaceId],
        ["resource_id", "eq", resourceId],
      ),
      order: [
        { column: "created_at", ascending: true },
        { column: "id", ascending: true },
      ],
    });
    const active = rows.flatMap((row) => {
      const expiresAt = cloudbaseNullableDate(row.expires_at, "grant expiry");
      if (expiresAt !== null && expiresAt <= evaluatedAt) return [];
      const role = cloudbaseText(row.role, "grant role");
      if (!roleNames.includes(role as Role))
        throw new Error("CloudBase returned an invalid grant role.");
      return [
        {
          id: cloudbaseText(row.id, "grant id"),
          workspaceId: cloudbaseText(row.workspace_id, "grant workspace"),
          resourceId: cloudbaseText(row.resource_id, "grant resource"),
          role: role as Role,
          grantedBy: cloudbaseText(row.granted_by, "granted_by"),
          createdAt: cloudbaseDate(row.created_at, "created_at"),
          expiresAt,
          scope: cloudbaseGrantScope(row.scope, row.section_id),
          principalId: cloudbaseText(row.principal_id, "grant principal"),
        },
      ];
    });
    const principals = await this.#readUsers(
      active.map((grant) => grant.principalId),
    );
    // The PostgreSQL query joins users; a grant whose user is gone is not listed.
    return active.flatMap(({ principalId, ...grant }) => {
      const user = principals.get(principalId);
      return user === undefined ? [] : [{ ...grant, principal: user }];
    });
  }

  async #readUsers(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, ResourceGrantResource["principal"]>> {
    const users = new Map<string, ResourceGrantResource["principal"]>();
    const unique = [...new Set(ids)];
    for (let start = 0; start < unique.length; start += cloudbaseIdBatchSize) {
      const rows = await this.#client.select<UserRow>("users", {
        columns: "id,display_name,email",
        filters: cloudbaseFilters([
          "id",
          "in",
          unique.slice(start, start + cloudbaseIdBatchSize),
        ]),
      });
      for (const row of rows) {
        const id = cloudbaseText(row.id, "user id");
        users.set(id, {
          id,
          displayName: cloudbaseText(row.display_name, "display name"),
          email: cloudbaseNullableText(row.email, "email"),
        });
      }
    }
    return users;
  }
}
