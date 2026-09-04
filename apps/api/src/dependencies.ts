import {
  AuthorizationService,
  DrizzleAuthorizationStore,
  ResourceGrantService,
} from "@chronelle/authorization";
import type { DatabaseConnection } from "@chronelle/db";
import {
  DocumentService,
  EventPlanningObjectService,
  EventPlanningProjectionService,
  ObjectRelationService,
} from "@chronelle/object-model";
import {
  LocalFilesystemStorageProvider,
  type StorageProvider,
} from "@chronelle/storage";

import type { AuthProvider } from "./authentication/auth-provider.js";
import { DevelopmentAuthProvider } from "./authentication/development-auth-provider.js";
import { WorkspaceIdentityService } from "./identity/workspace-identity-service.js";

export interface AppDependencies {
  readonly authProvider: AuthProvider;
  readonly authorization: AuthorizationService;
  readonly developmentAuth?: DevelopmentAuthProvider;
  readonly documents: DocumentService;
  readonly identity: WorkspaceIdentityService;
  readonly objects: EventPlanningObjectService;
  readonly projections: EventPlanningProjectionService;
  readonly relations: ObjectRelationService;
  readonly shares: ResourceGrantService;
}

export interface AppDependencyOptions {
  readonly clock?: (() => Date) | undefined;
  readonly documentTransferTtlMs?: number | undefined;
  readonly localStorageRoot?: string | undefined;
  readonly storage?: StorageProvider | undefined;
}

export function createAppDependencies(
  connection: DatabaseConnection,
  authProvider: AuthProvider,
  options: AppDependencyOptions = {},
): AppDependencies {
  const authorization = new AuthorizationService(
    new DrizzleAuthorizationStore(connection.db),
  );
  const objects = new EventPlanningObjectService(connection.db, authorization);
  const storage =
    options.storage ??
    new LocalFilesystemStorageProvider({
      root: options.localStorageRoot ?? ".chronelle/storage",
    });

  return {
    authProvider,
    authorization,
    documents: new DocumentService(
      connection.db,
      authorization,
      objects,
      storage,
      {
        clock: options.clock,
        transferTtlMs: options.documentTransferTtlMs,
      },
    ),
    identity: new WorkspaceIdentityService(connection.db, authorization),
    objects,
    relations: new ObjectRelationService(connection.db, authorization),
    shares: new ResourceGrantService(connection.db, authorization),
    projections: new EventPlanningProjectionService(connection.db, objects),
  };
}

export function createDevelopmentAppDependencies(
  connection: DatabaseConnection,
  options: AppDependencyOptions & {
    readonly developmentSessionTtlMs?: number | undefined;
  } = {},
): AppDependencies {
  const developmentAuth = new DevelopmentAuthProvider(
    options.developmentSessionTtlMs,
  );

  return {
    ...createAppDependencies(connection, developmentAuth, options),
    developmentAuth,
  };
}
