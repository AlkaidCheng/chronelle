import {
  AuthorizationService,
  DrizzleAuthorizationStore,
  ResourceGrantService,
} from "@chronelle/authorization";
import type { CloudBaseRdbClient, DatabaseConnection } from "@chronelle/db";
import {
  CanonicalObjectSearchService,
  CloudBaseCalendarReadRepository,
  CloudBaseCommandReadRepository,
  CloudBaseCommandWriteRepository,
  CloudBaseDocumentTransferReadRepository,
  CloudBaseDocumentTransferWriteRepository,
  CloudBaseEventReadRepository,
  CloudBaseProjectionReadRepository,
  CloudBaseEventContextWriteRepository,
  CloudBaseEventLayoutReadRepository,
  CloudBaseEventLayoutWriteRepository,
  CloudBaseEventWriteRepository,
  CloudBaseExpenseWriteRepository,
  CloudBaseGrantReadRepository,
  CloudBaseObjectLifecycleWriteRepository,
  CloudBaseObjectReadRepository,
  CloudBaseRecoveryReadRepository,
  CloudBaseRelationReadRepository,
  CloudBaseRelationWriteRepository,
  CloudBaseSharingWriteRepository,
  CloudBaseStorageInventoryReadRepository,
  CloudBaseReminderWriteRepository,
  CloudBaseRevisionReadRepository,
  CloudBaseSearchReadRepository,
  CloudBaseTaskWriteRepository,
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
import { CloudBaseSessionStore } from "./authentication/cloudbase-session-store.js";
import { SessionAuthProvider } from "./authentication/session-auth-provider.js";
import { PostgresSessionStore } from "./authentication/session-store.js";
import { CloudBaseIdentityStore } from "./identity/cloudbase-identity-store.js";
import { WorkspaceIdentityService } from "./identity/workspace-identity-service.js";

export interface AppDependencies {
  readonly authProvider: AuthProvider;
  readonly authorization: AuthorizationService;
  /** Whether the development sign-in route is served. */
  readonly developmentSignIn: boolean;
  readonly sessions: SessionAuthProvider;
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
  /** Route the ported write families through the gateway's rpc functions. */
  readonly cloudBaseWrites?: boolean | undefined;
  readonly sessionTtlMs?: number | undefined;
}

function cloudBaseReads(rdb: CloudBaseRdbClient) {
  const objects = new CloudBaseObjectReadRepository(rdb);
  return {
    events: new CloudBaseEventReadRepository(rdb),
    objects,
    relations: new CloudBaseRelationReadRepository(rdb),
    grants: new CloudBaseGrantReadRepository(rdb),
    revisions: new CloudBaseRevisionReadRepository(rdb),
    recovery: new CloudBaseRecoveryReadRepository(rdb),
    commands: new CloudBaseCommandReadRepository(rdb),
    storage: new CloudBaseStorageInventoryReadRepository(rdb),
    transfers: new CloudBaseDocumentTransferReadRepository(rdb),
    layouts: new CloudBaseEventLayoutReadRepository(rdb, objects),
  };
}

export function createAppDependencies(
  connection: DatabaseConnection,
  authProvider: AuthProvider | undefined,
  options: AppDependencyOptions = {},
): AppDependencies {
  const authorization = new AuthorizationService(
    new DrizzleAuthorizationStore(connection.db),
  );
  // Sessions follow the identity store: the gateway once a client exists.
  const sessions = new SessionAuthProvider(
    options.cloudBaseRdb === undefined
      ? new PostgresSessionStore(connection.db)
      : new CloudBaseSessionStore(options.cloudBaseRdb),
    { sessionTtlMs: options.sessionTtlMs, clock: options.clock },
  );
  // Read adapters; a service without one reads PostgreSQL.
  const reads =
    options.cloudBaseRdb === undefined
      ? undefined
      : cloudBaseReads(options.cloudBaseRdb);
  const sharing =
    options.cloudBaseRdb === undefined || options.cloudBaseWrites !== true
      ? undefined
      : new CloudBaseSharingWriteRepository(options.cloudBaseRdb);
  const writes =
    options.cloudBaseRdb === undefined || options.cloudBaseWrites !== true
      ? {}
      : {
          share: sharing,
          permissionScope: sharing,
          event: new CloudBaseEventWriteRepository(options.cloudBaseRdb),
          task: new CloudBaseTaskWriteRepository(options.cloudBaseRdb),
          expense: new CloudBaseExpenseWriteRepository(options.cloudBaseRdb),
          reminder: new CloudBaseReminderWriteRepository(options.cloudBaseRdb),
          eventContext: new CloudBaseEventContextWriteRepository(
            options.cloudBaseRdb,
          ),
          eventLayout: new CloudBaseEventLayoutWriteRepository(
            options.cloudBaseRdb,
          ),
          relation: new CloudBaseRelationWriteRepository(options.cloudBaseRdb),
          objectLifecycle: new CloudBaseObjectLifecycleWriteRepository(
            options.cloudBaseRdb,
          ),
          command: new CloudBaseCommandWriteRepository(options.cloudBaseRdb),
          transfers: new CloudBaseDocumentTransferWriteRepository(
            options.cloudBaseRdb,
          ),
        };
  const objects = new EventPlanningObjectService(
    connection.db,
    undefined,
    reads,
    writes,
  );
  const storage =
    options.storage ??
    new LocalFilesystemStorageProvider({
      root: options.localStorageRoot ?? ".chronelle/storage",
    });

  return {
    authProvider: authProvider ?? sessions,
    authorization,
    developmentSignIn: false,
    sessions,
    documents: new DocumentService(connection.db, objects, storage, {
      clock: options.clock,
      transferTtlMs: options.documentTransferTtlMs,
      writes: writes.transfers,
      reads: reads?.transfers,
    }),
    identity: new WorkspaceIdentityService(
      connection.db,
      options.cloudBaseRdb === undefined
        ? undefined
        : new CloudBaseIdentityStore(options.cloudBaseRdb, options.clock),
    ),
    objects,
    relations: new ObjectRelationService(
      connection.db,
      undefined,
      writes.relation,
      reads?.relations,
    ),
    revisions: new ObjectRevisionService(connection.db, reads?.revisions),
    restoration: new ObjectRestorationService(
      connection.db,
      writes.objectLifecycle,
      reads && { objects: reads.objects, revisions: reads.revisions },
    ),
    recovery: new ObjectRecoveryService(
      connection.db,
      reads?.recovery,
      writes.objectLifecycle,
    ),
    eventContexts: new EventContextService(connection.db, writes.eventContext),
    eventLayouts: new EventLayoutService(
      connection.db,
      writes.eventLayout,
      reads?.layouts,
    ),
    commands: new ReversibleCommandService(
      connection.db,
      writes.command,
      reads?.commands,
    ),
    search: new CanonicalObjectSearchService(
      connection.db,
      options.cloudBaseRdb === undefined
        ? undefined
        : new CloudBaseSearchReadRepository(options.cloudBaseRdb),
    ),
    storageInventory: new StorageInventoryService(connection.db, storage, {
      clock: options.clock,
      reads: reads?.storage,
    }),
    shares: new ResourceGrantService(
      connection.db,
      undefined,
      writes.share,
      reads?.grants,
    ),
    projections: new EventPlanningProjectionService(
      connection.db,
      options.cloudBaseRdb === undefined
        ? undefined
        : new CloudBaseCalendarReadRepository(options.cloudBaseRdb),
      options.cloudBaseRdb === undefined
        ? undefined
        : new CloudBaseProjectionReadRepository(options.cloudBaseRdb),
    ),
  };
}

export function createDevelopmentAppDependencies(
  connection: DatabaseConnection,
  options: AppDependencyOptions = {},
): AppDependencies {
  return {
    ...createAppDependencies(connection, undefined, options),
    developmentSignIn: true,
  };
}
