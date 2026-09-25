import assert from "node:assert/strict";
import { connectDatabase } from "@livtales/db";

const connection = connectDatabase(process.env.DATABASE_URL);
try {
  const [role] = await connection.sql`
    SELECT current_user AS name, rolsuper, rolcreatedb, rolcreaterole,
      rolinherit, rolreplication, rolbypassrls
    FROM pg_roles WHERE rolname = current_user
  `;
  assert.equal(role.name, "chronelle_runtime");
  for (const [key, value] of Object.entries(role)) {
    if (key !== "name") assert.equal(value, false);
  }
  for (const statement of [
    "CREATE TABLE public.runtime_probe(id integer)",
    "DELETE FROM objects",
    "UPDATE audit_events SET action = 'forged'",
    "SELECT * FROM chronelle_schema_migrations",
    "ALTER TABLE objects DISABLE TRIGGER ALL",
  ]) {
    await assert.rejects(connection.sql.unsafe(statement), { code: "42501" });
  }
  console.log(
    "API uses a restricted database login; administrative and destructive SQL are denied.",
  );
} finally {
  await connection.close();
}
