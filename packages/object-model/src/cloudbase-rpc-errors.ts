import {
  AuthorizationDeniedError,
  PrincipalUnavailableError,
} from "@chronelle/authorization";
import type { CloudBaseRpcError } from "@chronelle/db";

import {
  CommandConflictError,
  InvalidObjectStateError,
  InvalidRelationError,
  ObjectConflictError,
  RelationConflictError,
} from "./errors.js";

const invalidRelation = (message: string) => new InvalidRelationError(message);
const commandConflictMessage = new CommandConflictError().message;
const relationConflictMessage = new RelationConflictError().message;

/** Which service error a PT400 means; each adapter knows its own domain. */
export interface RpcErrorMapping {
  readonly invalidRequest?: ((message: string) => Error) | undefined;
}

/**
 * The service error for a function's SQLSTATE. The gateway prefixes codes
 * (DATABASE_PT409), so only the suffix is read; the three 409 outcomes share
 * a code and are told apart by the service's own messages, and a 400 is the
 * calling adapter's request error (an invalid relation unless it says
 * otherwise).
 */
export function mapRpcError(
  error: CloudBaseRpcError,
  mapping: RpcErrorMapping = {},
): Error {
  if (error.code.endsWith("PT403")) return new AuthorizationDeniedError();
  if (error.code.endsWith("PT404")) return new PrincipalUnavailableError();
  if (error.code.endsWith("PT400"))
    return (mapping.invalidRequest ?? invalidRelation)(error.message);
  if (error.code.endsWith("PT409")) {
    if (error.message === commandConflictMessage)
      return new CommandConflictError();
    if (error.message === relationConflictMessage)
      return new RelationConflictError();
    return new ObjectConflictError();
  }
  if (error.code.endsWith("PT422"))
    return new InvalidObjectStateError(error.message);
  return error;
}
