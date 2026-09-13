import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";

test("enforces safe errors through the production proxy", async ({
  request,
}) => {
  for (const [contentType, data, status] of [
    ["application/json", '{"private":', 400],
    ["application/xml", "<private/>", 415],
    ["application/json", " ".repeat(1024 * 1024 + 1), 413],
  ] as const) {
    const response = await request.post("/api/events", {
      data: Buffer.from(data),
      headers: { "content-type": contentType },
    });
    expect(response.status()).toBe(status);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      error: { code: expect.any(String), message: expect.any(String) },
    });
  }
  const missing = await request.get("/api/missing/synthetic-secret");
  expect(missing.status()).toBe(404);
  expect(await missing.text()).not.toContain("synthetic-secret");
  expect(missing.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
});

test("round-trips a private upload above the ordinary request limit", async ({
  request,
}) => {
  const signIn = await request.post("/api/auth/development/sign-in", {
    data: {
      email: `transport-${randomUUID()}@example.test`,
      displayName: "Transport planner",
    },
  });
  expect(signIn.status()).toBe(200);
  const session = await signIn.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Transport round trip" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const bytes = Buffer.alloc(12 * 1024 * 1024 + 32, 7);
  const issued = await request.post("/api/documents/upload-url", {
    headers,
    data: {
      parentObjectId: event.id,
      originalFilename: "private.bin",
      mimeType: "application/octet-stream",
      sizeBytes: bytes.length,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    },
  });
  expect(issued.status()).toBe(201);
  const authorization = await issued.json();
  const uploaded = await request.put(authorization.upload.url, {
    data: bytes,
    headers: authorization.upload.headers,
  });
  expect(uploaded.status()).toBe(204);
  const finalized = await request.post("/api/documents", {
    headers,
    data: { uploadAuthorizationId: authorization.id },
  });
  expect(finalized.status()).toBe(201);
  const attachment = await finalized.json();
  expect(attachment.document.sizeBytes).toBe(String(bytes.length));
  const granted = await request.get(
    `/api/documents/${attachment.document.id}/download-url`,
    { headers },
  );
  expect(granted.status()).toBe(200);
  const { download } = await granted.json();
  const received = await request.get(download.url);
  expect(received.status()).toBe(200);
  expect(received.headers()["cache-control"]).toBe("private, no-store");
  expect((await received.body()).equals(bytes)).toBe(true);
});
