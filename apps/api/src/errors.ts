export class HttpError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class UnauthenticatedError extends HttpError {
  constructor() {
    super(401, "unauthenticated", "Authentication is required.");
    this.name = "UnauthenticatedError";
  }
}

export class InvalidRequestError extends HttpError {
  constructor() {
    super(400, "invalid_request", "The request is invalid.");
    this.name = "InvalidRequestError";
  }
}

export class WorkspaceUnavailableError extends HttpError {
  constructor() {
    super(
      404,
      "workspace_unavailable",
      "The requested workspace is unavailable.",
    );
    this.name = "WorkspaceUnavailableError";
  }
}
