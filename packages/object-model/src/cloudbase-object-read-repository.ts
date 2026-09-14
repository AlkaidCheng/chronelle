import {
  AuthorizationDeniedError,
  authorizationActions,
  roleAllows,
  type AuthorizationAction,
  type UserPrincipal,
} from "@chronelle/authorization";
import type { CloudBaseRdbReader } from "@chronelle/db";

import {
  readCloudBaseObjectRow,
  readCloudBasePrincipalAccess,
  readCloudBaseResources,
  readCloudBaseScopes,
  readCloudBaseViewableObjects,
  type CloudBasePrincipalAccess,
} from "./cloudbase-object-read-support.js";
import type { CloudBaseObjectRow } from "./cloudbase-read-support.js";
import type { ObjectReadRepository } from "./object-reads.js";
import type { EventPlanningResource } from "./types.js";

/**
 * Read-only CloudBase adapter for single canonical objects. The principal's
 * roles are evaluated in application code from workspace membership and
 * active grants because the gateway key does not authorize a user.
 */
export class CloudBaseObjectReadRepository implements ObjectReadRepository {
  readonly #client: CloudBaseRdbReader;
  readonly #clock: () => Date;

  constructor(
    client: CloudBaseRdbReader,
    clock: () => Date = () => new Date(),
  ) {
    this.#client = client;
    this.#clock = clock;
  }

  async getObject(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<EventPlanningResource> {
    const { object } = await this.#viewable(principal, objectId);
    const resources = await readCloudBaseResources(this.#client, principal, [
      object,
    ]);
    const resource = resources.get(objectId);
    if (resource === undefined) throw new AuthorizationDeniedError();
    return resource;
  }

  async getAllowedActions(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<readonly AuthorizationAction[]> {
    const { access, object, scopes } = await this.#viewable(
      principal,
      objectId,
    );
    const roles = access.rolesFor(object, scopes);
    return authorizationActions.filter((action) =>
      roles.some((role) => roleAllows(role, action)),
    );
  }

  async listVisibleObjects(
    principal: UserPrincipal,
    objectIds: readonly string[],
  ): Promise<EventPlanningResource[]> {
    if (objectIds.length === 0) return [];
    const access = await readCloudBasePrincipalAccess(
      this.#client,
      principal,
      this.#clock,
    );
    const visible = await readCloudBaseViewableObjects(
      this.#client,
      principal,
      access,
      objectIds,
    );
    const resources = await readCloudBaseResources(this.#client, principal, [
      ...visible.values(),
    ]);
    return objectIds.flatMap((id) => {
      const resource = resources.get(id);
      return resource === undefined ? [] : [resource];
    });
  }

  async #viewable(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<{
    readonly access: CloudBasePrincipalAccess;
    readonly object: CloudBaseObjectRow;
    readonly scopes: ReadonlyMap<string, CloudBaseObjectRow>;
  }> {
    const [access, object] = await Promise.all([
      readCloudBasePrincipalAccess(this.#client, principal, this.#clock),
      readCloudBaseObjectRow(this.#client, principal, objectId),
    ]);
    const scopes = await readCloudBaseScopes(this.#client, principal, [object]);
    if (!access.allows("view", object, scopes))
      throw new AuthorizationDeniedError();
    return { access, object, scopes };
  }
}
