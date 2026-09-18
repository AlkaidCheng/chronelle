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

export class InvalidCredentialsError extends HttpError {
  constructor() {
    super(401, "invalid_credentials", "The email or password is incorrect.");
    this.name = "InvalidCredentialsError";
  }
}

export class EmailUnverifiedError extends HttpError {
  constructor() {
    super(403, "email_unverified", "The email address is not verified.");
    this.name = "EmailUnverifiedError";
  }
}

export class EmailTakenError extends HttpError {
  constructor() {
    super(409, "email_taken", "An account with this email already exists.");
    this.name = "EmailTakenError";
  }
}

export class VerificationInvalidError extends HttpError {
  constructor() {
    super(
      400,
      "verification_invalid",
      "The verification code is invalid or has expired.",
    );
    this.name = "VerificationInvalidError";
  }
}

export class CredentialLockedError extends HttpError {
  constructor() {
    super(
      429,
      "credential_locked",
      "Too many failed attempts; try again later.",
    );
    this.name = "CredentialLockedError";
  }
}

export class UsernameTakenError extends HttpError {
  constructor() {
    super(409, "username_taken", "That username is taken.");
    this.name = "UsernameTakenError";
  }
}

export class UserUnavailableError extends HttpError {
  constructor() {
    super(404, "user_unavailable", "The user is unavailable.");
    this.name = "UserUnavailableError";
  }
}

export class SearchLimitError extends HttpError {
  constructor() {
    super(429, "search_limit", "Too many searches; try again in a minute.");
    this.name = "SearchLimitError";
  }
}
