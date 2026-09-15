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
  CloudBaseLabelRepository,
  CloudBaseTaskReadRepository,
  LabelService,
  PostgresLabelRepository,
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
import { CloudBaseCredentialStore } from "./authentication/cloudbase-credential-store.js";
import { CloudBaseSessionStore } from "./authentication/cloudbase-session-store.js";
import { PostgresCredentialStore } from "./authentication/credential-store.js";
import type { EmailSender } from "./authentication/email-sender.js";
import {
  PasswordAuthService,
  type PasswordAuthOptions,
} from "./authentication/password-auth-service.js";
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
  readonly passwordAuth: PasswordAuthService;
  readonly documents: DocumentService;
  readonly identity: WorkspaceIdentityService;
  readonly objects: EventPlanningObjectService;
  readonly labels: LabelService;
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
  /** Outbound email for verification codes; the log sender by default. */
  readonly email?: EmailSender | undefined;
  readonly passwordAuth?: PasswordAuthOptions | undefined;
}

// The server composes a real sender from its configuration; test
// compositions inject a recording one. Without either, codes go nowhere.
const discardingEmailSender: EmailSender = { send: async () => undefined };

function cloudBaseReads(rdb: CloudBaseRdbClient) {
  const objects = new CloudBaseObjectReadRepository(rdb);
  return {
    events: new CloudBaseEventReadRepository(rdb),
    tasks: new CloudBaseTaskReadRepository(rdb),
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
  // Sessions and credentials follow the identity store: the gateway once a
  // client exists.
  const sessions = new SessionAuthProvider(
    options.cloudBaseRdb === undefined
      ? new PostgresSessionStore(connection.db)
      : new CloudBaseSessionStore(options.cloudBaseRdb),
    { sessionTtlMs: options.sessionTtlMs, clock: options.clock },
  );
  const credentials =
    options.cloudBaseRdb === undefined
      ? new PostgresCredentialStore(connection.db)
      : new CloudBaseCredentialStore(options.cloudBaseRdb);
  const identity = new WorkspaceIdentityService(
    connection.db,
    options.cloudBaseRdb === undefined
      ? undefined
      : new CloudBaseIdentityStore(options.cloudBaseRdb, options.clock),
  );
  const passwordAuth = new PasswordAuthService(
    identity,
    credentials,
    sessions,
    options.email ?? discardingEmailSender,
    { clock: options.clock, ...options.passwordAuth },
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
  const labelRepository =
    options.cloudBaseRdb === undefined
      ? new PostgresLabelRepository(connection.db, options.clock)
      : new CloudBaseLabelRepository(options.cloudBaseRdb, options.clock);
  const postgresLabels = new PostgresLabelRepository(
    connection.db,
    options.clock,
  );
  const labels = new LabelService(
    options.cloudBaseRdb === undefined ? postgresLabels : labelRepository,
    options.cloudBaseRdb === undefined || options.cloudBaseWrites !== true
      ? postgresLabels
      : labelRepository,
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
    passwordAuth,
    documents: new DocumentService(connection.db, objects, storage, {
      clock: options.clock,
      transferTtlMs: options.documentTransferTtlMs,
      writes: writes.transfers,
      reads: reads?.transfers,
    }),
    identity,
    objects,
    labels,
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
