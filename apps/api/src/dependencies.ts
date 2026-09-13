import {
  AuthorizationService,
  DrizzleAuthorizationStore,
  ResourceGrantService,
} from "@chronelle/authorization";
import type { CloudBaseRdbClient, DatabaseConnection } from "@chronelle/db";
import {
  CanonicalObjectSearchService,
  CloudBaseCalendarReadRepository,
  CloudBaseEventReadRepository,
  DocumentService,
  EventPlanningObjectService,
  EventPlanningProjectionService,
  ObjectRelationService,
  ObjectRevisionService,
  ObjectRestorationService,
  ObjectRecoveryService,
  EventContextService,
  EventLayoutService,
  ReversibleCommandService,
  StorageInventoryService,
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
  readonly revisions: ObjectRevisionService;
  readonly restoration: ObjectRestorationService;
  readonly recovery: ObjectRecoveryService;
  readonly eventContexts: EventContextService;
  readonly eventLayouts: EventLayoutService;
  readonly commands: ReversibleCommandService;
  readonly search: CanonicalObjectSearchService;
  readonly shares: ResourceGrantService;
  readonly storageInventory: StorageInventoryService;
}

export interface AppDependencyOptions {
  readonly clock?: (() => Date) | undefined;
  readonly documentTransferTtlMs?: number | undefined;
  readonly localStorageRoot?: string | undefined;
  readonly storage?: StorageProvider | undefined;
  /** Opt-in read transport; writes and transaction-heavy services stay in PostgreSQL. */
  readonly cloudBaseRdb?: CloudBaseRdbClient | undefined;
}

export function createAppDependencies(
  connection: DatabaseConnection,
  authProvider: AuthProvider,
  options: AppDependencyOptions = {},
): AppDependencies {
  const authorization = new AuthorizationService(
    new DrizzleAuthorizationStore(connection.db),
  );
  const eventReads =
    options.cloudBaseRdb === undefined
      ? undefined
      : new CloudBaseEventReadRepository(options.cloudBaseRdb);
  const objects = new EventPlanningObjectService(
    connection.db,
    undefined,
    eventReads,
  );
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
    identity: new WorkspaceIdentityService(connection.db),
    objects,
    relations: new ObjectRelationService(connection.db),
    revisions: new ObjectRevisionService(connection.db),
    restoration: new ObjectRestorationService(connection.db),
    recovery: new ObjectRecoveryService(connection.db),
    eventContexts: new EventContextService(connection.db),
    eventLayouts: new EventLayoutService(connection.db),
    commands: new ReversibleCommandService(connection.db),
    search: new CanonicalObjectSearchService(connection.db),
    storageInventory: new StorageInventoryService(connection.db, storage, {
      clock: options.clock,
    }),
    shares: new ResourceGrantService(connection.db),
    projections: new EventPlanningProjectionService(
      connection.db,
      options.cloudBaseRdb === undefined
        ? undefined
        : new CloudBaseCalendarReadRepository(options.cloudBaseRdb),
    ),
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
