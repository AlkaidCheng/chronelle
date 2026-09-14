import { AuthorizationDeniedError } from "@chronelle/authorization";
import type { CloudBaseRpcError } from "@chronelle/db";

import {
  CommandConflictError,
  InvalidObjectStateError,
  InvalidRelationError,
  ObjectConflictError,
  RelationConflictError,
} from "./errors.js";

const commandConflictMessage = new CommandConflictError().message;
const relationConflictMessage = new RelationConflictError().message;

/**
 * The service error for a function's SQLSTATE. The gateway prefixes codes
 * (DATABASE_PT409), so only the suffix is read; the three 409 outcomes share
 * a code and are told apart by the service's own messages.
 */
export function mapRpcError(error: CloudBaseRpcError): Error {
  if (error.code.endsWith("PT403")) return new AuthorizationDeniedError();
  if (error.code.endsWith("PT400"))
    return new InvalidRelationError(error.message);
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
