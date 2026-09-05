export * from "./authorization.js";
export { withStableAuthorization } from "./authorization-transaction.js";
export { recoveryAccessPredicate } from "./recovery-policy.js";
export { DrizzleAuthorizationStore } from "./drizzle-authorization-store.js";
export {
  InvalidShareError,
  PrincipalUnavailableError,
  ResourceGrantService,
  type GrantMutationContext,
  type ResourceGrantResource,
  type RevokedGrantResource,
  type ShareResourceInput,
} from "./grant-service.js";
