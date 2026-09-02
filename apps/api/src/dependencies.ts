import {
  AuthorizationService,
  DrizzleAuthorizationStore,
} from "@chronelle/authorization";
import type { DatabaseConnection } from "@chronelle/db";

import type { AuthProvider } from "./authentication/auth-provider.js";
import { DevelopmentAuthProvider } from "./authentication/development-auth-provider.js";
import { WorkspaceIdentityService } from "./identity/workspace-identity-service.js";

export interface AppDependencies {
  readonly authProvider: AuthProvider;
  readonly developmentAuth?: DevelopmentAuthProvider;
  readonly identity: WorkspaceIdentityService;
}

export function createDevelopmentAppDependencies(
  connection: DatabaseConnection,
  developmentSessionTtlMs?: number,
): AppDependencies {
  const developmentAuth = new DevelopmentAuthProvider(developmentSessionTtlMs);
  const authorization = new AuthorizationService(
    new DrizzleAuthorizationStore(connection.db),
  );
  const identity = new WorkspaceIdentityService(connection.db, authorization);

  return {
    authProvider: developmentAuth,
    developmentAuth,
    identity,
  };
}
