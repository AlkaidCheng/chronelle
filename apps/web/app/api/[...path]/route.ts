import type { NextRequest } from "next/server";
import {
  apiRequestTimeoutMs,
  maximumApiBodySizeBytes,
  maximumDocumentSizeBytes,
} from "@chronelle/schemas";
import { readRequestBody, RequestBodyError } from "../../../lib/request-body";
import {
  clearedSessionCookies,
  endsSession,
  establishesSession,
  readIssuedSession,
  readSessionToken,
  sessionCookies,
} from "../../../lib/session-cookie";

const forwardedRequestHeaders = [
  "authorization",
  "content-type",
  "x-workspace-id",
] as const;

async function forward(
  request: NextRequest,
  context: { readonly params: Promise<{ path: string[] }> },
): Promise<Response> {
  const signal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(apiRequestTimeoutMs),
  ]);
  let response: Response;
  let route = "";
  try {
    const { path } = await context.params;
    route = path.join("/");
    signal.throwIfAborted();
    if (
      path.some(
        (segment) =>
          segment === "." || segment === ".." || /[/\\]/.test(segment),
      )
    ) {
      throw new RequestBodyError(400);
    }
    const apiOrigin = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
    const destination = new URL(
      `/api/${path.map(encodeURIComponent).join("/")}`,
      apiOrigin,
    );
    destination.search = request.nextUrl.search;

    const headers = new Headers();
    for (const name of forwardedRequestHeaders) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    // The session cookie is the browser's credential; an explicit bearer
    // header (API scripting through this origin) takes precedence.
    const sessionToken = readSessionToken(
      request.headers.get("authorization"),
      request.headers.get("cookie"),
    );
    if (sessionToken !== null)
      headers.set("authorization", `Bearer ${sessionToken}`);
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const isUpload =
      request.method === "PUT" &&
      path.length === 3 &&
      path[0] === "document-transfers" &&
      path[1] === "upload";
    const body = hasBody
      ? await readRequestBody(
          request,
          isUpload ? maximumDocumentSizeBytes : maximumApiBodySizeBytes,
          signal,
        )
      : undefined;
    response = await fetch(destination, {
      ...(body !== undefined && { body }),
      cache: "no-store",
      headers,
      method: request.method,
      redirect: "manual",
      signal,
    });
  } catch (error) {
    if (!request.body?.locked) void request.body?.cancel().catch(() => {});
    if (request.signal.aborted)
      return failure(408, "request_aborted", "The request was cancelled.");
    if (signal.aborted)
      return failure(
        504,
        "request_timeout",
        "The request timed out. Refresh before retrying a change.",
      );
    if (error instanceof RequestBodyError)
      return failure(
        error.status,
        error.status === 413 ? "payload_too_large" : "invalid_request",
        error.message,
      );
    return failure(
      503,
      "service_unavailable",
      "Chronelle could not reach the server. Check your connection and try again.",
    );
  }

  const responseHeaders = new Headers();
  for (const name of ["content-disposition", "content-type", "x-request-id"]) {
    const value = response.headers.get(name);
    if (value !== null) {
      responseHeaders.set(name, value);
    }
  }
  responseHeaders.set("cache-control", "private, no-store");
  const cookieOptions = { secure: request.nextUrl.protocol === "https:" };

  if (endsSession(request.method, route)) {
    for (const cookie of clearedSessionCookies(cookieOptions))
      responseHeaders.append("set-cookie", cookie);
  } else if (establishesSession(request.method, route) && response.ok) {
    // The body is read once to set the cookie and forwarded as it was; the
    // browser client discards the token and relies on the cookie.
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    const issued = readIssuedSession(body);
    if (issued !== null)
      for (const cookie of sessionCookies(
        issued.token,
        issued.expiresAt,
        cookieOptions,
      ))
        responseHeaders.append("set-cookie", cookie);
    return new Response(text, {
      headers: responseHeaders,
      status: response.status,
    });
  }

  return new Response(response.body, {
    headers: responseHeaders,
    status: response.status,
  });
}

function failure(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "private, no-store" } },
  );
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
