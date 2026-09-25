import {
  AuthorizationService,
  DrizzleAuthorizationStore,
  ResourceGrantService,
} from "@livtales/authorization";
import type { CloudBaseRdbClient, DatabaseConnection } from "@livtales/db";
import {
  CanonicalObjectSearchService,
  CloudBaseCalendarReadRepository,
  CloudBaseCommandReadRepository,
  CloudBaseCommandWriteRepository,
  CloudBaseDocumentTransferReadRepository,
  CloudBaseDocumentTransferWriteRepository,
  CloudBaseEventContextWriteRepository,
  CloudBaseEventLayoutReadRepository,
  CloudBaseEventLayoutWriteRepository,
  CloudBaseEventReadRepository,
  CloudBaseEventWriteRepository,
  CloudBaseExpenseWriteRepository,
  CloudBaseGrantReadRepository,
  CloudBaseLabelRepository,
  CloudBaseObjectLifecycleWriteRepository,
  CloudBaseObjectReadRepository,
  CloudBaseNoteReadRepository,
  CloudBaseNoteWriteRepository,
  CloudBasePersonReadRepository,
  CloudBasePersonWriteRepository,
  CloudBaseProjectionReadRepository,
  CloudBaseRecoveryReadRepository,
  CloudBaseRelationReadRepository,
  CloudBaseRelationWriteRepository,
  CloudBaseReminderWriteRepository,
  CloudBaseRevisionReadRepository,
  CloudBaseSearchReadRepository,
  CloudBaseSectionRepository,
  CloudBaseSharingWriteRepository,
  CloudBaseStorageInventoryReadRepository,
  CloudBaseTaskReadRepository,
  CloudBaseTaskWriteRepository,
  DocumentService,
  EventContextService,
  EventLayoutService,
  EventPlanningObjectService,
  EventPlanningProjectionService,
  LabelService,
  ObjectRecoveryService,
  ObjectRelationService,
  ObjectRestorationService,
  ObjectRevisionService,
  PostgresLabelRepository,
  PostgresSectionRepository,
  ReversibleCommandService,
  SectionService,
  StorageInventoryService,
} from "@livtales/object-model";
import {
  LocalFilesystemStorageProvider,
  type StorageProvider,
} from "@livtales/storage";

import type { AuthProvider } from "./authentication/auth-provider.js";
import { CloudBaseCredentialStore } from "./authentication/cloudbase-credential-store.js";
import { CloudBaseSessionStore } from "./authentication/cloudbase-session-store.js";
import { PostgresCredentialStore } from "./authentication/credential-store.js";
import type { EmailSender } from "./authentication/email-sender.js";
import {
  type PasswordAuthOptions,
  PasswordAuthService,
} from "./authentication/password-auth-service.js";
import { SessionAuthProvider } from "./authentication/session-auth-provider.js";
import { PostgresSessionStore } from "./authentication/session-store.js";
import { WeChatAuthenticationService } from "./authentication/wechat-auth-service.js";
import {
  CloudBaseWeChatAuthStore,
  PostgresWeChatAuthStore,
} from "./authentication/wechat-auth-store.js";
import type { WeChatIdentityVerifier } from "./authentication/wechat-identity-verifier.js";
import { CloudBaseFriendStore } from "./friends/cloudbase-friend-store.js";
import {
  FriendService,
  type FriendServiceOptions,
} from "./friends/friend-service.js";
import { PostgresFriendStore } from "./friends/friend-store.js";
import { CloudBasePendingShareStore } from "./sharing/cloudbase-pending-share-store.js";
import { PendingShareService } from "./sharing/pending-share-service.js";
import { PostgresPendingShareStore } from "./sharing/pending-share-store.js";
import { CloudBasePersonShareStore } from "./sharing/cloudbase-person-share-store.js";
import {
  type PersonShareStore,
  PostgresPersonShareStore,
} from "./sharing/person-share-store.js";
import { CloudBaseMembershipStore } from "./workspaces/cloudbase-membership-store.js";
import {
  type MembershipStore,
  PostgresMembershipStore,
} from "./workspaces/membership-store.js";
import { CloudBaseIdentityStore } from "./identity/cloudbase-identity-store.js";
import { WorkspaceIdentityService } from "./identity/workspace-identity-service.js";

export interface AppDependencies {
  readonly authProvider: AuthProvider;
  readonly authorization: AuthorizationService;
  /** Whether the development sign-in route is served. */
  readonly developmentSignIn: boolean;
  readonly sessions: SessionAuthProvider;
  readonly passwordAuth: PasswordAuthService;
  readonly weChatAuth: WeChatAuthenticationService | null;
  readonly friends: FriendService;
  readonly documents: DocumentService;
  readonly identity: WorkspaceIdentityService;
  readonly objects: EventPlanningObjectService;
  readonly labels: LabelService;
  readonly sections: SectionService;
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
  readonly pendingShares: PendingShareService;
  readonly personShares: PersonShareStore;
  readonly members: MembershipStore;
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
  /** Enables verified CloudBase-WeChat exchange and explicit account linking. */
  readonly weChatIdentityVerifier?: WeChatIdentityVerifier | undefined;
  readonly friends?: FriendServiceOptions | undefined;
}

// The server composes a real sender from its configuration; test
// compositions inject a recording one. Without either, codes go nowhere.
const discardingEmailSender: EmailSender = { send: async () => undefined };

function cloudBaseReads(rdb: CloudBaseRdbClient) {
  const objects = new CloudBaseObjectReadRepository(rdb);
  return {
    events: new CloudBaseEventReadRepository(rdb),
    tasks: new CloudBaseTaskReadRepository(rdb),
    persons: new CloudBasePersonReadRepository(rdb),
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
  const weChatAuth =
    options.weChatIdentityVerifier === undefined
      ? null
      : new WeChatAuthenticationService(
          options.weChatIdentityVerifier,
          options.cloudBaseRdb === undefined
            ? new PostgresWeChatAuthStore(connection.db)
            : new CloudBaseWeChatAuthStore(options.cloudBaseRdb),
          { clock: options.clock, sessionTtlMs: options.sessionTtlMs },
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
          person: new CloudBasePersonWriteRepository(options.cloudBaseRdb),
          note: new CloudBaseNoteWriteRepository(options.cloudBaseRdb),
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
  const postgresSections = new PostgresSectionRepository(connection.db);
  const cloudBaseSections =
    options.cloudBaseRdb === undefined
      ? undefined
      : new CloudBaseSectionRepository(options.cloudBaseRdb);
  const sections = new SectionService(
    cloudBaseSections ?? postgresSections,
    cloudBaseSections === undefined || options.cloudBaseWrites !== true
      ? postgresSections
      : cloudBaseSections,
  );
  const storage =
    options.storage ??
    new LocalFilesystemStorageProvider({
      root: options.localStorageRoot ?? ".chronelle/storage",
    });
  // Friends follow the identity store: the gateway once a client exists.
  const friends = new FriendService(
    options.cloudBaseRdb === undefined
      ? new PostgresFriendStore(connection.db, options.clock)
      : new CloudBaseFriendStore(options.cloudBaseRdb),
    options.email ?? discardingEmailSender,
    objects,
    { clock: options.clock, ...options.friends },
  );
  const pendingShares = new PendingShareService(
    options.cloudBaseRdb === undefined
      ? new PostgresPendingShareStore(connection.db, options.clock)
      : new CloudBasePendingShareStore(options.cloudBaseRdb),
    friends,
    objects,
    options.clock,
  );
  const personShares =
    options.cloudBaseRdb === undefined
      ? new PostgresPersonShareStore(connection.db, options.clock)
      : new CloudBasePersonShareStore(options.cloudBaseRdb);
  const members =
    options.cloudBaseRdb === undefined
      ? new PostgresMembershipStore(connection.db)
      : new CloudBaseMembershipStore(options.cloudBaseRdb);

  return {
    authProvider: authProvider ?? sessions,
    authorization,
    developmentSignIn: false,
    sessions,
    passwordAuth,
    weChatAuth,
    friends,
    documents: new DocumentService(connection.db, objects, storage, {
      clock: options.clock,
      transferTtlMs: options.documentTransferTtlMs,
      writes: writes.transfers,
      reads: reads?.transfers,
    }),
    identity,
    objects,
    labels,
    sections,
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
    pendingShares,
    personShares,
    members,
    projections: new EventPlanningProjectionService(
      connection.db,
      options.cloudBaseRdb === undefined
        ? undefined
        : new CloudBaseCalendarReadRepository(options.cloudBaseRdb),
      options.cloudBaseRdb === undefined
        ? undefined
        : new CloudBaseProjectionReadRepository(options.cloudBaseRdb),
      options.cloudBaseRdb === undefined
        ? undefined
        : new CloudBaseNoteReadRepository(options.cloudBaseRdb),
      cloudBaseSections,
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
