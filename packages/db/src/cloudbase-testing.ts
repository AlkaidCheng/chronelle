import type postgres from "postgres";
import { getTableColumns, type Table } from "drizzle-orm";

import type { Database } from "./client.js";
import {
  CloudBaseRpcError,
  type CloudBaseRdbReader,
  type CloudBaseRdbQuery,
} from "./cloudbase-rdb.js";
import {
  documents,
  documentTransferAuthorizations,
  eventPageRevisions,
  events,
  expenses,
  labels,
  objectCreateCommands,
  objectRelations,
  objectRevisions,
  objects,
  persons,
  reminders,
  resourceGrants,
  taskLabels,
  tasks,
  users,
  workspaceMembers,
  workspaces,
} from "./schema.js";

// Gateway doubles for the differential tests: a reader that serves the rows
// PostgreSQL holds through the RDB transport boundary with the filter,
// order, limit, and value-encoding semantics of the gateway, and an rpc
// double that executes the database functions locally with the gateway's
// error shape. The transport itself is covered by the contract harnesses on
// staging.

const snapshotTables = {
  document_transfer_authorizations: documentTransferAuthorizations,
  documents,
  event_page_revisions: eventPageRevisions,
  events,
  expenses,
  labels,
  object_create_commands: objectCreateCommands,
  object_relations: objectRelations,
  object_revisions: objectRevisions,
  objects,
  persons,
  reminders,
  resource_grants: resourceGrants,
  task_labels: taskLabels,
  tasks,
  users,
  workspace_members: workspaceMembers,
  workspaces,
} as const;

/** One PostgreSQL row keyed by SQL column name, holding the driver's values. */
interface SnapshotRow {
  readonly raw: Record<string, unknown>;
  readonly encoded: Record<string, unknown>;
  /** The columns the gateway serializes as JSON numbers. */
  readonly numeric: ReadonlySet<string>;
}

/**
 * Encodes one value the way the gateway serializes it: ISO instants, and JSON
 * numbers for numeric and bigint columns (which rounds a bigint beyond 2^53
 * and drops the numeric scale) unless the select list casts the column with
 * `::text`, in which case PostgreSQL's text representation is returned. A
 * text column keeps its text, digits included.
 */
function gatewayValue(
  value: unknown,
  cast: string | undefined,
  numeric: boolean,
): unknown {
  if (cast === "text")
    return value === null || value instanceof Date ? value : String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return Number(value);
  if (numeric && typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value))
    return Number(value);
  return value;
}

function isNumericColumn(columnType: string): boolean {
  return columnType === "PgNumeric" || columnType.startsWith("PgBigInt");
}

function snapshotRow(table: Table, record: Record<string, unknown>) {
  const columns = Object.entries(getTableColumns(table));
  const raw = Object.fromEntries(
    columns.map(([property, column]) => [column.name, record[property]]),
  );
  const numeric = new Set(
    columns
      .filter(([, column]) => isNumericColumn(column.columnType))
      .map(([, column]) => column.name),
  );
  return {
    raw,
    encoded: Object.fromEntries(
      columns.map(([property, column]) => [
        column.name,
        gatewayValue(record[property], undefined, numeric.has(column.name)),
      ]),
    ),
    numeric,
  } satisfies SnapshotRow;
}

/** Applies a select list with optional `column::cast` entries to one row. */
function project(
  row: SnapshotRow,
  columns: string | undefined,
): Record<string, unknown> {
  if (columns === undefined || columns === "*") return row.encoded;
  return Object.fromEntries(
    columns.split(",").map((entry) => {
      const [name, cast] = entry.split("::") as [string, string | undefined];
      return [name, gatewayValue(row.raw[name], cast, row.numeric.has(name))];
    }),
  );
}

function matches(
  row: Record<string, unknown>,
  query: CloudBaseRdbQuery,
): boolean {
  return (query.filters ?? []).every((filter) => {
    const value = row[filter.column];
    switch (filter.operator) {
      case "eq":
      case "is":
        return value === filter.value;
      case "in":
        return (filter.value as readonly unknown[]).includes(value);
      case "ilike":
        return String(value)
          .toLocaleLowerCase()
          .includes(
            String(filter.value).replaceAll("%", "").toLocaleLowerCase(),
          );
      default:
        return false;
    }
  });
}

function compareValues(first: unknown, second: unknown): number {
  if (first === second) return 0;
  if (first === null || first === undefined) return 1;
  if (second === null || second === undefined) return -1;
  return first < second ? -1 : 1;
}

/**
 * Serves the rows PostgreSQL holds through the RDB transport boundary, with
 * the filter, order, and limit semantics of the gateway, so both backends
 * read one dataset.
 */
export async function createCloudBaseSnapshotReader(
  db: Database,
): Promise<CloudBaseRdbReader> {
  const rows = new Map<string, SnapshotRow[]>();
  for (const [name, table] of Object.entries(snapshotTables)) {
    const records = await db.select().from(table);
    rows.set(
      name,
      records.map((record) =>
        snapshotRow(table, record as Record<string, unknown>),
      ),
    );
  }
  return {
    capabilities: {
      transactions: false,
      nativeTcp: false,
      serverFunctions: false,
    },
    async select<T>(table: string, query: CloudBaseRdbQuery = {}) {
      const tableRows = rows.get(table);
      if (tableRows === undefined) throw new Error(`unexpected table ${table}`);
      const matching = tableRows.filter((row) => matches(row.encoded, query));
      for (const order of [...(query.order ?? [])].reverse()) {
        matching.sort((first, second) => {
          const comparison = compareValues(
            first.encoded[order.column],
            second.encoded[order.column],
          );
          return order.ascending === false ? -comparison : comparison;
        });
      }
      const offset = query.offset ?? 0;
      const page =
        query.limit === undefined
          ? matching.slice(offset)
          : matching.slice(offset, offset + query.limit);
      return page.map((row) =>
        project(row, query.columns),
      ) as unknown as readonly T[];
    },
  };
}

/** A reader that snapshots the database on every select, for tests that write between reads. */
export function createCloudBaseLiveReader(db: Database): CloudBaseRdbReader {
  return {
    capabilities: {
      transactions: false,
      nativeTcp: false,
      serverFunctions: false,
    },
    async select<T>(table: string, query: CloudBaseRdbQuery = {}) {
      return (await createCloudBaseSnapshotReader(db)).select<T>(table, query);
    },
  };
}

const gatewayStatus: Record<string, number> = {
  PT403: 403,
  PT404: 404,
  PT409: 409,
  PT422: 422,
  PT500: 500,
};

export type CloudBaseRpcDouble = <T>(
  functionName: string,
  args?: Record<string, unknown>,
) => Promise<T>;

/** Calls a database function locally the way the gateway's rpc route does: JSON arguments, gateway-shaped errors. */
export function createCloudBaseRpcDouble(
  sql: postgres.Sql,
): CloudBaseRpcDouble {
  return async function rpc<T>(
    functionName: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const names = Object.keys(args);
    // Objects travel as JSON text, which PostgreSQL casts to the jsonb parameter.
    const values = Object.values(args).map((value) =>
      value !== null && typeof value === "object"
        ? JSON.stringify(value)
        : value,
    );
    try {
      const [row] = await sql.unsafe<{ result: T }[]>(
        `SELECT ${functionName}(${names
          .map((name, index) => `${name} => $${index + 1}`)
          .join(", ")}) AS result`,
        values as never[],
      );
      return row?.result as T;
    } catch (error) {
      const failure = error as { code?: string; message?: string };
      const code = failure.code ?? "unknown";
      throw new CloudBaseRpcError(
        gatewayStatus[code] ?? 400,
        `DATABASE_${code}`,
        failure.message ?? "function failed",
      );
    }
  };
}
