/**
 * The browser session is an httpOnly cookie owned by the web origin. The
 * proxy sets it from a sign-in response, presents it to the API as the
 * bearer credential, and clears it on sign-out; page scripts never see the
 * token.
 */
export const sessionCookieName = "chronelle_session";

/**
 * A companion cookie page scripts may read, carrying no secret: it tells a
 * tab that a session cookie exists, so a signed-out tab does not ask the API
 * and collect a 401 on every account screen.
 */
export const sessionPresenceCookieName = "chronelle_session_present";

/** The API paths whose 200 response establishes a session. */
const signInPaths = new Set([
  "auth/development/sign-in",
  "auth/sign-in",
  "auth/verify-email",
  "auth/password-reset/confirm",
]);

/** The API paths that end the session, whatever the API answers. */
const signOutPaths = new Set(["auth/session", "auth/sessions"]);

export function establishesSession(method: string, path: string): boolean {
  return method === "POST" && signInPaths.has(path);
}

export function endsSession(method: string, path: string): boolean {
  return method === "DELETE" && signOutPaths.has(path);
}

/** The token a request carries: an explicit bearer header first, else the cookie. */
export function readSessionToken(
  authorization: string | null,
  cookie: string | null,
): string | null {
  if (authorization !== null) return null;
  const match = new RegExp(`(?:^|;\\s*)${sessionCookieName}=([^;]*)`).exec(
    cookie ?? "",
  );
  const value = match?.[1];
  return value === undefined || value.length === 0 ? null : value;
}

export interface SessionCookieOptions {
  readonly secure: boolean;
}

/** The session cookie and its presence marker, as Set-Cookie values. */
export function sessionCookies(
  token: string,
  expiresAt: Date,
  options: SessionCookieOptions,
): readonly string[] {
  const shared = [
    "Path=/",
    `Expires=${expiresAt.toUTCString()}`,
    "SameSite=Lax",
    ...(options.secure ? ["Secure"] : []),
  ];
  return [
    [`${sessionCookieName}=${token}`, ...shared, "HttpOnly"].join("; "),
    [`${sessionPresenceCookieName}=1`, ...shared].join("; "),
  ];
}

export function clearedSessionCookies(
  options: SessionCookieOptions,
): readonly string[] {
  const shared = [
    "Path=/",
    "Max-Age=0",
    "SameSite=Lax",
    ...(options.secure ? ["Secure"] : []),
  ];
  return [
    [`${sessionCookieName}=`, ...shared, "HttpOnly"].join("; "),
    [`${sessionPresenceCookieName}=`, ...shared].join("; "),
  ];
}

/** Whether the page's readable cookies say a session cookie exists. */
export function sessionPresent(documentCookie: string): boolean {
  return new RegExp(`(?:^|;\\s*)${sessionPresenceCookieName}=1(?:;|$)`).test(
    documentCookie,
  );
}

/** The token and expiry of a sign-in response body, when it has them. */
export function readIssuedSession(
  body: unknown,
): { token: string; expiresAt: Date } | null {
  if (body === null || typeof body !== "object") return null;
  const { accessToken, expiresAt } = body as Record<string, unknown>;
  if (typeof accessToken !== "string" || accessToken.length === 0) return null;
  const expiry = new Date(typeof expiresAt === "string" ? expiresAt : "");
  if (Number.isNaN(expiry.getTime())) return null;
  return { token: accessToken, expiresAt: expiry };
}
