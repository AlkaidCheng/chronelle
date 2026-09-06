import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { composeArguments, runDocker } from "./container-process.mjs";

// Restore only archives captured here from the stopped synthetic fixture stack.
export async function checkRecovery(environment, source, verify) {
  const project = `chronelle-restore-${randomUUID()}`;
  const docker = async (...args) =>
    (await runDocker(environment, args)).toString("utf8").trim();
  const compose = (...args) => docker(...composeArguments(project), ...args);
  const inspect = async (id) => JSON.parse(await docker("inspect", id))[0];
  const sql = (id, query) =>
    docker(
      "exec",
      id,
      "psql",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "chronelle",
      "-d",
      "chronelle",
      "-c",
      query,
    );
  const tablesQuery =
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename";
  const snapshot = async (id) => {
    const tables = (await sql(id, tablesQuery)).split("\n").filter(Boolean);
    const rows = [];
    for (const table of tables) {
      const identifier = `"${table.replaceAll('"', '""')}"`;
      rows.push([
        table,
        JSON.parse(
          await sql(
            id,
            `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) FROM public.${identifier} t`,
          ),
        ),
      ]);
    }
    return rows;
  };
  const volume = (container, path) => {
    const mount = container.Mounts.find((entry) => entry.Destination === path);
    assert.equal(mount?.Type, "volume");
    return mount.Name;
  };
  const storagePath = "/app/.chronelle/storage";
  const storageCommand = (id, mode, command, ...args) => [
    "run",
    "--rm",
    "--interactive",
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--volumes-from",
    `${id}:${mode}`,
    "--entrypoint",
    command,
    environment.API_IMAGE,
    ...args,
  ];

  for (const service of ["api", "web"]) {
    assert.equal(
      (await inspect(source[service].Id)).State.Running,
      false,
      "Fixture writers must be stopped before capturing database and files.",
    );
  }
  const expectedRows = await snapshot(source.postgres.Id);
  assert(expectedRows.length > 0, "The source database must contain fixtures.");
  const [databaseArchive, filesArchive] = await Promise.all([
    runDocker(environment, [
      "exec",
      source.postgres.Id,
      "pg_dump",
      "-U",
      "chronelle",
      "-d",
      "chronelle",
      "--format=custom",
    ]),
    runDocker(
      environment,
      storageCommand(
        source.api.Id,
        "ro",
        "tar",
        "-cf",
        "-",
        "-C",
        storagePath,
        ".",
      ),
    ),
  ]);
  assert.equal(databaseArchive.subarray(0, 5).toString(), "PGDMP");
  assert(filesArchive.length > 0);

  try {
    await compose(
      "up",
      "--detach",
      "--wait",
      "--wait-timeout",
      "120",
      "postgres",
    );
    const postgres = await inspect(await compose("ps", "--quiet", "postgres"));
    assert.notEqual(
      volume(postgres, "/var/lib/postgresql/data"),
      volume(source.postgres, "/var/lib/postgresql/data"),
    );
    assert.equal(
      await sql(postgres.Id, tablesQuery),
      "",
      "Restore refuses a nonempty target database.",
    );
    const restoreArguments = [
      "exec",
      "--interactive",
      postgres.Id,
      "pg_restore",
      "-U",
      "chronelle",
      "-d",
      "chronelle",
      "--single-transaction",
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
    ];
    await assert.rejects(
      runDocker(
        environment,
        restoreArguments,
        databaseArchive.subarray(0, Math.floor(databaseArchive.length / 2)),
      ),
    );
    assert.equal(
      await sql(postgres.Id, tablesQuery),
      "",
      "An interrupted archive must not leave a partially restored database.",
    );
    await runDocker(environment, restoreArguments, databaseArchive);
    console.log(
      "Truncated database archive rejected without partial schema or data.",
    );
    assert.deepEqual(
      await snapshot(postgres.Id),
      expectedRows,
      "Every public table must retain its exact rows before application startup.",
    );

    await compose("up", "--no-start", "--no-deps", "api");
    const api = await inspect(await compose("ps", "--all", "--quiet", "api"));
    assert.notEqual(volume(api, storagePath), volume(source.api, storagePath));
    await docker(
      ...storageCommand(
        api.Id,
        "rw",
        "node",
        "--input-type=module",
        "-e",
        'import assert from "node:assert/strict"; import {readdirSync} from "node:fs"; assert.deepEqual(readdirSync("/app/.chronelle/storage"), []);',
      ),
    );
    await runDocker(
      environment,
      storageCommand(api.Id, "rw", "tar", "-xpf", "-", "-C", storagePath),
      filesArchive,
    );
    await docker(
      ...storageCommand(
        api.Id,
        "ro",
        "node",
        "--input-type=module",
        "-e",
        'import assert from "node:assert/strict"; import {readdirSync,statSync} from "node:fs"; const root="/app/.chronelle/storage"; assert.equal(statSync(root).uid,1000); for(const entry of readdirSync(root,{recursive:true,withFileTypes:true})) { const stat=statSync(entry.parentPath+"/"+entry.name); assert.equal(stat.uid,1000); assert.equal(stat.mode & 0o777, entry.isDirectory() ? 0o700 : 0o600); }',
      ),
    );
    await compose("up", "--detach", "--wait", "--wait-timeout", "120");
    assert.deepEqual(
      await snapshot(postgres.Id),
      expectedRows,
      "Startup migrations and baselines must preserve restored rows.",
    );
    const web = await inspect(await compose("ps", "--quiet", "web"));
    const [binding] = web.NetworkSettings.Ports["3000/tcp"];
    assert.equal(binding.HostIp, "127.0.0.1");
    await verify(`http://127.0.0.1:${binding.HostPort}`);
    const restoredRows = new Map(await snapshot(postgres.Id));
    for (const table of ["audit_events", "object_revisions"]) {
      const before = new Map(expectedRows).get(table);
      const after = restoredRows.get(table);
      assert(before.length > 0);
      assert(
        after.length > before.length,
        "Recovery must append new audit and revision records.",
      );
      for (const row of before)
        assert.deepEqual(
          after.find((entry) => entry.id === row.id),
          row,
        );
    }
    assert.deepEqual(
      await snapshot(source.postgres.Id),
      expectedRows,
      "Restored mutations must leave the source database untouched.",
    );
    console.log(
      "Fresh-stack database, matching files, and recovery verification passed.",
    );
  } finally {
    await compose("down", "--volumes", "--remove-orphans", "--timeout", "10");
    console.log(
      `Removed disposable restore containers, volumes, and networks for ${project}.`,
    );
  }
}
