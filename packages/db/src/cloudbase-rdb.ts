import { z } from "zod";

const identifierSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

export interface CloudBaseRdbQuery {
  readonly columns?: string | undefined;
  readonly filters?: readonly CloudBaseRdbFilter[] | undefined;
  readonly order?: readonly CloudBaseRdbOrder[] | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export interface CloudBaseRdbFilter {
  readonly column: string;
  readonly operator: "eq" | "ilike" | "in" | "is";
  readonly value: unknown;
}

export interface CloudBaseRdbOrder {
  readonly ascending?: boolean | undefined;
  readonly column: string;
  readonly nullsFirst?: boolean | undefined;
  readonly referencedTable?: string | undefined;
}

/** Filters for a write; the tuple type keeps an unfiltered update or delete unexpressible. */
export type CloudBaseRdbWriteFilters = readonly [
  CloudBaseRdbFilter,
  ...CloudBaseRdbFilter[],
];

export interface CloudBaseRdbWrite {
  readonly filters: CloudBaseRdbWriteFilters;
  /** Columns of the affected rows to return; defaults to every column. */
  readonly columns?: string | undefined;
}

/**
 * Read side of the CloudBase RDB gateway transport. Each call is one bounded
 * HTTPS statement; the capability metadata records what the gateway cannot do.
 */
export interface CloudBaseRdbReader {
  readonly capabilities: {
    readonly transactions: false;
    readonly nativeTcp: false;
    readonly serverFunctions: false;
  };
  select<T>(table: string, query?: CloudBaseRdbQuery): Promise<readonly T[]>;
}

/**
 * Full transport. A write resolves to the rows it affected; an update or
 * delete whose filters match nothing resolves to an empty list, which is how a
 * version predicate reports a stale write. There are no transactions and no
 * server-side functions, so work needing atomicity across rows stays on
 * PostgreSQL.
 */
export interface CloudBaseRdbClient extends CloudBaseRdbReader {
  insert<T>(
    table: string,
    rows: readonly Record<string, unknown>[],
    options?: { readonly columns?: string | undefined },
  ): Promise<readonly T[]>;
  update<T>(
    table: string,
    values: Record<string, unknown>,
    write: CloudBaseRdbWrite,
  ): Promise<readonly T[]>;
  delete<T>(table: string, write: CloudBaseRdbWrite): Promise<readonly T[]>;
}

interface RdbQuery<T> {
  select(columns?: string): RdbQuery<T>;
  insert(rows: readonly Record<string, unknown>[]): RdbQuery<T>;
  update(values: Record<string, unknown>): RdbQuery<T>;
  delete(): RdbQuery<T>;
  eq(column: string, value: unknown): RdbQuery<T>;
  ilike(column: string, value: string): RdbQuery<T>;
  in(column: string, value: readonly unknown[]): RdbQuery<T>;
  is(column: string, value: unknown): RdbQuery<T>;
  limit(value: number): RdbQuery<T>;
  order(
    column: string,
    options?: {
      readonly ascending?: boolean;
      readonly nullsFirst?: boolean;
      readonly referencedTable?: string;
    },
  ): RdbQuery<T>;
  range(from: number, to: number): RdbQuery<T>;
  then<TResult1 = { data?: readonly T[] | null; error?: unknown }>(
    onfulfilled?:
      | ((value: {
          data?: readonly T[] | null;
          error?: unknown;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult1 | PromiseLike<TResult1>) | null,
  ): Promise<TResult1>;
}

interface RdbApp {
  rdb(): {
    from<T>(table: string): RdbQuery<T>;
  };
}

export interface CloudBaseRdbConnectionOptions {
  readonly envId: string;
  readonly accessKey: string;
  /** Maximum time to wait for one gateway query, in milliseconds. */
  readonly requestTimeoutMs?: number | undefined;
}

/**
 * Reject an expired JWT-shaped server key before the first gateway request.
 * Opaque provider keys remain valid inputs because their expiry is not
 * represented locally.
 */
export function assertCloudBaseApiKeyFresh(
  value: string,
  nowMs = Date.now(),
): void {
  const segment = value.split(".")[1];
  if (segment === undefined) return;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return;
  }
  if (
    payload === null ||
    typeof payload !== "object" ||
    typeof (payload as { exp?: unknown }).exp !== "number" ||
    !Number.isFinite((payload as { exp: number }).exp)
  )
    return;
  if ((payload as { exp: number }).exp * 1000 <= nowMs) {
    throw new Error(
      "CLOUDBASE_APIKEY is expired. Replace it with a fresh short-lived server key and retry.",
    );
  }
}

export class CloudBaseRdbTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`CloudBase RDB request timed out after ${timeoutMs}ms.`);
    this.name = "CloudBaseRdbTimeoutError";
  }
}

export function createCloudBaseRdbClient(
  app: RdbApp,
  options: Pick<CloudBaseRdbConnectionOptions, "requestTimeoutMs"> = {},
): CloudBaseRdbClient {
  const requestTimeoutMs =
    options.requestTimeoutMs === undefined
      ? 30_000
      : z
          .number()
          .int()
          .positive()
          .max(120_000)
          .parse(options.requestTimeoutMs);

  return {
    capabilities: {
      transactions: false,
      nativeTcp: false,
      serverFunctions: false,
    },
    async insert<T>(
      table: string,
      rows: readonly Record<string, unknown>[],
      options: { readonly columns?: string | undefined } = {},
    ) {
      const tableName = identifierSchema.parse(table);
      if (rows.length === 0) return [];
      const request = app
        .rdb()
        .from<T>(tableName)
        .insert(rows)
        .select(options.columns ?? "*");
      return awaitRows(request, requestTimeoutMs);
    },
    async update<T>(
      table: string,
      values: Record<string, unknown>,
      write: CloudBaseRdbWrite,
    ) {
      const tableName = identifierSchema.parse(table);
      const filters = validateWriteFilters(write.filters);
      const request = applyFilters(
        app.rdb().from<T>(tableName).update(values),
        filters,
      ).select(write.columns ?? "*");
      return awaitRows(request, requestTimeoutMs);
    },
    async delete<T>(table: string, write: CloudBaseRdbWrite) {
      const tableName = identifierSchema.parse(table);
      const filters = validateWriteFilters(write.filters);
      const request = applyFilters(
        app.rdb().from<T>(tableName).delete(),
        filters,
      ).select(write.columns ?? "*");
      return awaitRows(request, requestTimeoutMs);
    },
    async select<T>(table: string, query: CloudBaseRdbQuery = {}) {
      const tableName = identifierSchema.parse(table);
      const limit =
        query.limit === undefined
          ? undefined
          : z.number().int().nonnegative().parse(query.limit);
      const offset =
        query.offset === undefined
          ? 0
          : z.number().int().nonnegative().parse(query.offset);
      if (offset > 0 && limit === undefined) {
        throw new Error("CloudBase RDB offsets require a limit.");
      }
      const filters = validateFilters(query.filters ?? []);
      const order = (query.order ?? []).map((entry) => ({
        ...entry,
        column: identifierSchema.parse(entry.column),
        referencedTable:
          entry.referencedTable === undefined
            ? undefined
            : identifierSchema.parse(entry.referencedTable),
      }));
      let request = applyFilters(
        app
          .rdb()
          .from<T>(tableName)
          .select(query.columns ?? "*"),
        filters,
      );
      for (const entry of order) {
        const options: {
          ascending?: boolean;
          nullsFirst?: boolean;
          referencedTable?: string;
        } = {};
        if (entry.ascending !== undefined) options.ascending = entry.ascending;
        if (entry.nullsFirst !== undefined)
          options.nullsFirst = entry.nullsFirst;
        if (entry.referencedTable !== undefined)
          options.referencedTable = entry.referencedTable;
        request = request.order(entry.column, options);
      }
      if (limit !== undefined) {
        request = request.limit(limit);
      }
      if (limit !== undefined && limit > 0) {
        request = request.range(offset, offset + limit - 1);
      }

      return awaitRows(request, requestTimeoutMs);
    },
  };
}

function validateFilters(
  filters: readonly CloudBaseRdbFilter[],
): readonly CloudBaseRdbFilter[] {
  return filters.map((filter) => {
    const column = identifierSchema.parse(filter.column);
    const value =
      filter.operator === "ilike"
        ? z.string().parse(filter.value)
        : filter.operator === "in"
          ? z.array(z.unknown()).parse(filter.value)
          : filter.value;
    return { ...filter, column, value };
  });
}

function validateWriteFilters(
  filters: CloudBaseRdbWriteFilters,
): readonly CloudBaseRdbFilter[] {
  if (filters.length === 0) {
    throw new Error("CloudBase RDB writes require at least one filter.");
  }
  return validateFilters(filters);
}

function applyFilters<T>(
  request: RdbQuery<T>,
  filters: readonly CloudBaseRdbFilter[],
): RdbQuery<T> {
  let filtered = request;
  for (const filter of filters) {
    switch (filter.operator) {
      case "eq":
        filtered = filtered.eq(filter.column, filter.value);
        break;
      case "ilike":
        filtered = filtered.ilike(filter.column, filter.value as string);
        break;
      case "in":
        filtered = filtered.in(
          filter.column,
          filter.value as readonly unknown[],
        );
        break;
      case "is":
        filtered = filtered.is(filter.column, filter.value);
        break;
    }
  }
  return filtered;
}

async function awaitRows<T>(
  request: RdbQuery<T>,
  requestTimeoutMs: number,
): Promise<readonly T[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new CloudBaseRdbTimeoutError(requestTimeoutMs)),
          requestTimeoutMs,
        );
      }),
    ]);
    // The gateway reports success as `error: null`, not an absent field.
    if (result.error !== undefined && result.error !== null) {
      throw result.error;
    }
    return result.data ?? [];
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function connectCloudBaseRdb(
  options: CloudBaseRdbConnectionOptions,
): Promise<CloudBaseRdbClient> {
  const { default: cloudbase } = await import("@cloudbase/js-sdk");
  const app = cloudbase.init({
    env: options.envId,
    accessKey: options.accessKey,
  });
  return createCloudBaseRdbClient(app as unknown as RdbApp, options);
}
