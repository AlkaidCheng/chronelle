export * from "./authorization.js";
export {
  withStableAuthorization,
  withReadAuthorization,
  type AuthorizationDatabase,
  type AuthorizedTransaction,
} from "./authorization-transaction.js";
export { recoveryAccessPredicate } from "./recovery-policy.js";
export { DrizzleAuthorizationStore } from "./drizzle-authorization-store.js";
export {
  grantScopeOf,
  InvalidShareError,
  PrincipalUnavailableError,
  ResourceGrantService,
  type GrantMutationContext,
  type LeftResource,
  type ResourceGrantResource,
  type RevokedGrantResource,
  type ShareResourceInput,
  type ShareWriteRepository,
} from "./grant-service.js";
export {
  PostgresGrantReadRepository,
  type GrantReadRepository,
} from "./grant-reads.js";
