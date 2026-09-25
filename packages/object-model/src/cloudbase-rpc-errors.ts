import {
  AuthorizationDeniedError,
  PrincipalUnavailableError,
} from "@livtales/authorization";
import type { CloudBaseRpcError } from "@livtales/db";

import {
  CommandConflictError,
  CommandStackConflictError,
  InvalidObjectStateError,
  InvalidRelationError,
  LabelNameConflictError,
  ObjectConflictError,
  RelationConflictError,
} from "./errors.js";

const invalidRelation = (message: string) => new InvalidRelationError(message);
const commandConflictMessage = new CommandConflictError().message;
const commandStackConflictMessage = new CommandStackConflictError().message;
const relationConflictMessage = new RelationConflictError().message;
const labelNameConflictMessage = new LabelNameConflictError().message;

/** Which service errors a PT400 and a PT404 mean; each adapter knows its own domain. */
export interface RpcErrorMapping {
  readonly invalidRequest?: ((message: string) => Error) | undefined;
  readonly notFound?: (() => Error) | undefined;
}

/**
 * The service error for a function's SQLSTATE. The gateway prefixes codes
 * (DATABASE_PT409), so only the suffix is read; the four 409 outcomes share
 * a code and are told apart by the service's own messages, and a 400 is the
 * calling adapter's request error (an invalid relation unless it says
 * otherwise), and a 404 is the adapter's missing-record error (an
 * unavailable principal unless it says otherwise).
 */
export function mapRpcError(
  error: CloudBaseRpcError,
  mapping: RpcErrorMapping = {},
): Error {
  if (error.code.endsWith("PT403")) return new AuthorizationDeniedError();
  if (error.code.endsWith("PT404"))
    return (mapping.notFound ?? (() => new PrincipalUnavailableError()))();
  if (error.code.endsWith("PT400"))
    return (mapping.invalidRequest ?? invalidRelation)(error.message);
  if (error.code.endsWith("PT409")) {
    if (error.message === commandConflictMessage)
      return new CommandConflictError();
    if (error.message === commandStackConflictMessage)
      return new CommandStackConflictError();
    if (error.message === relationConflictMessage)
      return new RelationConflictError();
    if (error.message === labelNameConflictMessage)
      return new LabelNameConflictError();
    return new ObjectConflictError();
  }
  if (error.code.endsWith("PT422"))
    return new InvalidObjectStateError(error.message);
  return error;
}
