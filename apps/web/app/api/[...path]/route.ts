import type { NextRequest } from "next/server";
import {
  apiRequestTimeoutMs,
  maximumApiBodySizeBytes,
  maximumDocumentSizeBytes,
} from "@chronelle/schemas";
import { readRequestBody, RequestBodyError } from "../../../lib/request-body";

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
  try {
    const { path } = await context.params;
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
