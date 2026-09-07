import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { promisify } from "node:util";

const execute = promisify(execFile);
const project = `chronelle-check-${randomUUID()}`;
const environment = {
  ...process.env,
  API_IMAGE: process.env.API_IMAGE ?? "chronelle-api:validation",
  WEB_IMAGE: process.env.WEB_IMAGE ?? "chronelle-web:validation",
  ENABLE_DEVELOPMENT_AUTH: "true",
  POSTGRES_PASSWORD: randomUUID(),
  RUNTIME_DATABASE_PASSWORD: randomUUID(),
  WEB_PORT: "0",
};
const composeArgs = [
  "compose",
  "--env-file",
  "/dev/null",
  "--file",
  "infrastructure/compose.preview.yaml",
  "--project-name",
  project,
];
async function docker(...args) {
  try {
    const { stdout } = await execute("docker", args, {
      env: environment,
      timeout: 180_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    throw new Error(error.stderr?.trim() || `Docker ${args[0]} failed.`);
  }
}
const compose = (...args) => docker(...composeArgs, ...args);
const inspect = async (id) => JSON.parse(await docker("inspect", id))[0];
const runtimeCheck = readFileSync(
  new URL("./inspect-runtime.mjs", import.meta.url),
  "utf8",
);
let projectStarted = false;

try {
  for (const image of [environment.API_IMAGE, environment.WEB_IMAGE]) {
    const metadata = await inspect(image);
    if (process.env.EXPECTED_REVISION) {
      assert.equal(
        metadata.Config.Labels["org.opencontainers.image.revision"],
        process.env.EXPECTED_REVISION,
      );
    }
    console.log(`${image}: ${metadata.Size} bytes; ${metadata.Architecture}`);
    console.log(
      await docker(
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--entrypoint",
        "node",
        image,
        "--input-type=module",
        "-e",
        runtimeCheck,
      ),
    );
  }
  projectStarted = true;
  await compose("up", "--detach", "--wait", "--wait-timeout", "120");
  const containers = {};
  for (const service of ["postgres", "api", "web"]) {
    containers[service] = await inspect(
      await compose("ps", "--quiet", service),
    );
    assert.equal(containers[service].State.Health.Status, "healthy");
  }
  for (const service of ["api", "postgres"]) {
    assert.deepEqual(containers[service].HostConfig.PortBindings, {});
  }
  for (const service of ["api", "web"]) {
    assert.equal(containers[service].Config.User, "node");
    assert.equal(containers[service].HostConfig.ReadonlyRootfs, true);
    assert.deepEqual(containers[service].HostConfig.CapDrop, ["ALL"]);
    assert(
      containers[service].HostConfig.SecurityOpt.includes(
        "no-new-privileges:true",
      ),
    );
  }
  const apiEnvironment = containers.api.Config.Env;
  const apiDatabaseUrl = new URL(
    apiEnvironment.find((value) => value.startsWith("DATABASE_URL=")).slice(13),
  );
  assert.equal(apiDatabaseUrl.username, "chronelle_runtime");
  assert(
    !apiEnvironment.some((value) =>
      value.includes(environment.POSTGRES_PASSWORD),
    ),
  );
  console.log(
    await compose(
      "exec",
      "-T",
      "api",
      "node",
      "--input-type=module",
      "-e",
      readFileSync(new URL("./inspect-database.mjs", import.meta.url), "utf8"),
    ),
  );
  const network = Object.keys(containers.api.NetworkSettings.Networks);
  assert.equal(network.length, 1);
  assert.equal((await inspect(network[0])).Internal, true);
  const bindings = containers.web.NetworkSettings.Ports["3000/tcp"];
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].HostIp, "127.0.0.1");
  const base = `http://127.0.0.1:${bindings[0].HostPort}`;
  const request = async (path, options = {}, status = 200) => {
    const response = await fetch(new URL(path, base), {
      ...options,
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    assert.equal(response.status, status, `${options.method ?? "GET"} ${path}`);
    return response;
  };
  const json = async (path, body, headers = {}, status = 200) =>
    (
      await request(
        path,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        status,
      )
    ).json();

  const page = await request("/sign-in");
  const html = await page.text();
  assert(html.includes("Chronelle"));
  const asset = html.match(/src="([^"]*\/_next\/static\/[^"]+\.js)"/u)?.[1];
  assert(asset, "The page must reference a built JavaScript asset.");
  await request(asset);
  assert.equal((await (await request("/api/health")).json()).status, "ok");
  await request("/api/events", {}, 401);
  const identity = {
    email: "runtime@example.test",
    displayName: "Runtime planner",
  };
  const signIn = await json("/api/auth/development/sign-in", identity);
  let headers = { authorization: `Bearer ${signIn.accessToken}` };
  const event = await json(
    "/api/events",
    { displayName: "Runtime check" },
    headers,
    201,
  );
  const resources = [];
  for (const resource of [
    { objectType: "task", displayName: "Confirm venue" },
    {
      objectType: "expense",
      displayName: "Venue deposit",
      amount: "125.0000",
      currency: "USD",
      occurredAt: "2026-09-01T12:00:00Z",
    },
    {
      objectType: "reminder",
      displayName: "Check venue",
      remindAt: "2030-10-01T12:00:00Z",
    },
  ]) {
    resources.push(
      await json(
        `/api/events/${event.id}/resources`,
        {
          commandId: randomUUID(),
          resource,
        },
        headers,
        201,
      ),
    );
  }
  const task = resources[0].resource;
  let receipt = await json(
    "/api/commands",
    {
      operationId: randomUUID(),
      expectedStackVersion: 0,
      edits: [
        {
          objectType: "task",
          objectId: task.id,
          patch: {
            expectedVersion: task.version,
            displayName: "Venue confirmed",
          },
        },
      ],
    },
    headers,
  );
  for (const direction of ["undo", "redo"]) {
    receipt = await json(
      `/api/commands/${direction}`,
      {
        operationId: randomUUID(),
        commandId: receipt.commandId,
        expectedStackVersion: receipt.stackVersion,
      },
      headers,
    );
  }
  const restored = await json(
    `/api/objects/${task.id}/revisions/1/restore`,
    {
      expectedVersion: receipt.objects[0].version,
    },
    headers,
  );
  assert.equal(restored.displayName, task.displayName);
  const deleted = await (
    await request(
      `/api/objects/${task.id}?expectedVersion=${restored.version}`,
      {
        method: "DELETE",
        headers,
      },
    )
  ).json();
  const recovered = await json(
    `/api/objects/${task.id}/recover`,
    { expectedVersion: deleted.version },
    headers,
  );
  assert.equal(recovered.id, task.id);
  const relationId = resources[0].relationId;
  await request(`/api/relations/${relationId}?expectedVersion=1`, {
    method: "DELETE",
    headers,
  });
  await json(
    `/api/relations/${relationId}/recover`,
    { expectedVersion: 2 },
    headers,
  );
  const detail = await (
    await request(`/api/events/${event.id}/detail`, { headers })
  ).json();
  assert.equal(detail.tasks[0].id, task.id);
  assert.equal(detail.expenses[0].id, resources[1].resource.id);
  assert.equal(detail.reminders[0].id, resources[2].resource.id);
  const bytes = Buffer.from("Private runtime attachment");
  const issued = await json(
    "/api/documents/upload-url",
    {
      parentObjectId: event.id,
      originalFilename: "private.txt",
      mimeType: "text/plain",
      sizeBytes: bytes.length,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    },
    headers,
    201,
  );
  await request(
    issued.upload.url,
    { method: "PUT", body: bytes, headers: issued.upload.headers },
    204,
  );
  const attachment = await json(
    "/api/documents",
    { uploadAuthorizationId: issued.id },
    headers,
    201,
  );
  const downloadPath = `/api/documents/${attachment.document.id}/download-url`;
  await request(downloadPath, {}, 401);
  const stranger = await json("/api/auth/development/sign-in", {
    email: "unrelated@example.test",
    displayName: "Unrelated planner",
  });
  await request(
    downloadPath,
    { headers: { authorization: `Bearer ${stranger.accessToken}` } },
    404,
  );
  const grant = await json(
    "/api/shares",
    {
      principalEmail: "unrelated@example.test",
      resourceId: event.id,
      role: "viewer",
    },
    headers,
    201,
  );
  const viewerHeaders = {
    authorization: `Bearer ${stranger.accessToken}`,
    "x-workspace-id": signIn.workspace.id,
  };
  await request(`/api/events/${event.id}/detail`, { headers: viewerHeaders });
  await request(`/api/shares/${grant.id}`, { method: "DELETE", headers });
  await request(
    `/api/events/${event.id}/detail`,
    { headers: viewerHeaders },
    404,
  );
  console.log(
    "Typed planning, context commands, undo/redo, restoration, recovery, and grant revocation passed with the runtime role.",
  );
  console.log(
    await compose(
      "exec",
      "-T",
      "api",
      "node",
      "--input-type=module",
      "-e",
      'import assert from "node:assert/strict"; import {readdirSync,statSync} from "node:fs"; const root="/app/.chronelle/storage"; assert.equal(statSync(root).uid,1000); for(const entry of readdirSync(root,{recursive:true,withFileTypes:true})) assert.equal(statSync(entry.parentPath+"/"+entry.name).uid,1000); console.log("Storage is owned by the non-root runtime user.");',
    ),
  );

  await compose("restart", "--timeout", "10", "api");
  await compose("up", "--detach", "--wait", "--wait-timeout", "120");
  const resumed = await json("/api/auth/development/sign-in", identity);
  headers = { authorization: `Bearer ${resumed.accessToken}` };
  const download = await (await request(downloadPath, { headers })).json();
  const received = await request(download.download.url);
  assert.equal(received.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await received.arrayBuffer()), bytes);
  console.log(
    "Sign-in, canonical writes, private transfers, and restart persistence passed.",
  );

  const body = JSON.stringify({
    displayName: "Request completed during shutdown",
  });
  await new Promise((resolve, reject) => {
    const pending = httpRequest(
      new URL("/api/events", base),
      {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          expect: "100-continue",
        },
      },
      (response) => {
        response.resume();
        response.once("error", reject);
        response.once("end", () => {
          if (response.statusCode === 201) resolve();
          else
            reject(
              new Error(`Shutdown request returned ${response.statusCode}.`),
            );
        });
      },
    );
    pending.once("error", reject);
    pending.setTimeout(10_000, () =>
      pending.destroy(new Error("Shutdown request timed out.")),
    );
    pending.once("continue", async () => {
      try {
        await docker("kill", "--signal", "TERM", containers.web.Id);
        pending.end(body);
      } catch (error) {
        pending.destroy(error);
      }
    });
    pending.flushHeaders();
  });
  console.log("An accepted web request completed after SIGTERM.");
  await compose("stop", "--timeout", "10", "web", "api");
  for (const service of ["api", "web"]) {
    const { State } = await inspect(containers[service].Id);
    assert.equal(State.Running, false);
    assert.equal(State.OOMKilled, false);
    // Next.js returns 128 + SIGTERM after completing its cleanup.
    assert.equal(State.ExitCode, service === "web" ? 143 : 0);
  }
  console.log(
    "Private networking, health, read-only code, and graceful shutdown passed.",
  );
} finally {
  if (projectStarted) {
    await compose("down", "--volumes", "--remove-orphans", "--timeout", "10");
    console.log(
      `Removed disposable containers, volumes, and networks for ${project}.`,
    );
  }
}
