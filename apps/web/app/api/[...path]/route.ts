import type { NextRequest } from "next/server";

const forwardedRequestHeaders = [
  "authorization",
  "content-type",
  "x-workspace-id",
] as const;

async function forward(
  request: NextRequest,
  context: { readonly params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  const apiOrigin = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
  const destination = new URL(`/api/${path.join("/")}`, apiOrigin);
  destination.search = request.nextUrl.search;

  const headers = new Headers();
  for (const name of forwardedRequestHeaders) {
    const value = request.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const response = await fetch(destination, {
    ...(hasBody && { body: await request.arrayBuffer() }),
    cache: "no-store",
    headers,
    method: request.method,
    redirect: "manual",
  });

  const responseHeaders = new Headers();
  for (const name of [
    "cache-control",
    "content-disposition",
    "content-length",
    "content-type",
  ]) {
    const value = response.headers.get(name);
    if (value !== null) {
      responseHeaders.set(name, value);
    }
  }

  return new Response(response.body, {
    headers: responseHeaders,
    status: response.status,
  });
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
