import {
  AuthorizationService,
  DrizzleAuthorizationStore,
} from "@chronelle/authorization";
import type { DatabaseConnection } from "@chronelle/db";
import {
  EventPlanningObjectService,
  EventPlanningProjectionService,
  ObjectRelationService,
} from "@chronelle/object-model";

import type { AuthProvider } from "./authentication/auth-provider.js";
import { DevelopmentAuthProvider } from "./authentication/development-auth-provider.js";
import { WorkspaceIdentityService } from "./identity/workspace-identity-service.js";

export interface AppDependencies {
  readonly authProvider: AuthProvider;
  readonly developmentAuth?: DevelopmentAuthProvider;
  readonly identity: WorkspaceIdentityService;
  readonly objects: EventPlanningObjectService;
  readonly projections: EventPlanningProjectionService;
  readonly relations: ObjectRelationService;
}

export function createAppDependencies(
  connection: DatabaseConnection,
  authProvider: AuthProvider,
): AppDependencies {
  const authorization = new AuthorizationService(
    new DrizzleAuthorizationStore(connection.db),
  );
  const objects = new EventPlanningObjectService(connection.db, authorization);

  return {
    authProvider,
    identity: new WorkspaceIdentityService(connection.db, authorization),
    objects,
    relations: new ObjectRelationService(connection.db, authorization),
    projections: new EventPlanningProjectionService(connection.db, objects),
  };
}

export function createDevelopmentAppDependencies(
  connection: DatabaseConnection,
  developmentSessionTtlMs?: number,
): AppDependencies {
  const developmentAuth = new DevelopmentAuthProvider(developmentSessionTtlMs);

  return {
    ...createAppDependencies(connection, developmentAuth),
    developmentAuth,
  };
}
