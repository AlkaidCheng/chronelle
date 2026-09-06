import { STATUS_CODES } from "node:http";
import {
  LogController,
  errorCodes,
  type FastifyInstance,
  type FastifyReply,
  type FastifyServerOptions,
} from "fastify";
import { createId } from "@chronelle/db";
import {
  apiRequestTimeoutMs,
  maximumApiBodySizeBytes,
} from "@chronelle/schemas";
import {
  AuthorizationDeniedError,
  InvalidShareError,
  PrincipalUnavailableError,
} from "@chronelle/authorization";
import {
  CommandConflictError,
  CommandStackConflictError,
  DocumentTransferUnavailableError,
  InvalidDocumentUploadError,
  InvalidObjectStateError,
  InvalidRelationError,
  ObjectConflictError,
  RelationConflictError,
} from "@chronelle/object-model";
import {
  StorageObjectConflictError,
  StorageObjectUnavailableError,
  UnsafeStorageKeyError,
} from "@chronelle/storage";
import { HttpError, InvalidRequestError } from "./errors.js";

const domainErrors = [
  [PrincipalUnavailableError, 404, "principal_unavailable"],
  [InvalidShareError, 400, "invalid_share"],
  [CommandStackConflictError, 409, "command_stack_conflict"],
  [CommandConflictError, 409, "command_conflict"],
  [ObjectConflictError, 409, "version_conflict"],
  [RelationConflictError, 409, "relation_conflict"],
  [InvalidObjectStateError, 400, "invalid_request"],
  [InvalidRelationError, 400, "invalid_request"],
  [InvalidDocumentUploadError, 400, "invalid_request"],
  [UnsafeStorageKeyError, 400, "invalid_request"],
] as const;

function resolveHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof AuthorizationDeniedError) return unavailableResource();
  for (const [ErrorType, status, code] of domainErrors) {
    if (error instanceof ErrorType)
      return new HttpError(status, code, error.message);
  }
  if (
    error instanceof DocumentTransferUnavailableError ||
    error instanceof StorageObjectUnavailableError
  ) {
    return new HttpError(
      404,
      "transfer_unavailable",
      "The document transfer is unavailable.",
    );
  }
  if (error instanceof StorageObjectConflictError) {
    return new HttpError(
      409,
      "storage_conflict",
      "The document transfer conflicts with stored content.",
    );
  }
  if (error instanceof errorCodes.FST_ERR_CTP_BODY_TOO_LARGE) {
    return new HttpError(
      413,
      "payload_too_large",
      "The request body is too large.",
    );
  }
  if (error instanceof errorCodes.FST_ERR_CTP_INVALID_MEDIA_TYPE) {
    return new HttpError(
      415,
      "unsupported_media_type",
      "The request content type is unsupported.",
    );
  }
  if (
    [
      errorCodes.FST_ERR_CTP_INVALID_JSON_BODY,
      errorCodes.FST_ERR_CTP_EMPTY_JSON_BODY,
      errorCodes.FST_ERR_CTP_INVALID_CONTENT_LENGTH,
      errorCodes.FST_ERR_BAD_URL,
      errorCodes.FST_ERR_MAX_PARAM_LENGTH,
    ].some((ErrorType) => error instanceof ErrorType)
  )
    return new InvalidRequestError();
  return new HttpError(
    500,
    "internal_error",
    "The request could not be completed.",
  );
}

function unavailableResource(): HttpError {
  return new HttpError(
    404,
    "resource_unavailable",
    "The requested resource is unavailable.",
  );
}

function sendHttpError(reply: FastifyReply, error: HttpError) {
  return reply
    .header("cache-control", "private, no-store")
    .header("x-request-id", reply.request.id)
    .status(error.statusCode)
    .send({
      error: { code: error.code, message: error.message },
    });
}

export const httpServerOptions = {
  bodyLimit: maximumApiBodySizeBytes,
  requestTimeout: apiRequestTimeoutMs,
  requestIdHeader: false,
  genReqId: createId,
  logController: new LogController({ disableRequestLogging: true }),
  frameworkErrors: (error, _request, reply) =>
    sendHttpError(reply, resolveHttpError(error)),
  clientErrorHandler(this: FastifyInstance, error, socket) {
    if (socket.destroyed) return;
    const status =
      error.code === "ERR_HTTP_REQUEST_TIMEOUT"
        ? 408
        : error.code === "HPE_HEADER_OVERFLOW"
          ? 431
          : 400;
    const body = JSON.stringify({
      error: {
        code: "invalid_request",
        message: "The HTTP request could not be received.",
      },
    });
    this.log.warn({ statusCode: status }, "Rejected HTTP request");
    if (socket.writable) {
      socket.end(
        `HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Type: application/json\r\nCache-Control: private, no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
        () => socket.destroy(),
      );
    } else socket.destroy();
  },
} satisfies FastifyServerOptions;

export function registerHttpBoundary(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) =>
    sendHttpError(reply, resolveHttpError(error)),
  );
  app.setNotFoundHandler((_request, reply) =>
    sendHttpError(reply, unavailableResource()),
  );
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("cache-control", "private, no-store");
    reply.header("x-request-id", request.id);
    return payload;
  });
  app.addHook("onResponse", async (request, reply) => {
    const metadata = {
      method: request.method,
      route: request.routeOptions.url ?? null,
      statusCode: reply.statusCode,
      responseTime: reply.elapsedTime,
    };
    if (reply.statusCode >= 500) request.log.error(metadata, "Request failed");
    else request.log.info(metadata, "Request completed");
  });
}
