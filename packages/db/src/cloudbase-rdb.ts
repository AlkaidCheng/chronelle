import { z } from "zod";

const identifierSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

export interface CloudBaseRdbQuery {
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export interface CloudBaseRdbClient {
  readonly capabilities: {
    readonly transactions: false;
    readonly nativeTcp: false;
  };
  select<T>(table: string, query?: CloudBaseRdbQuery): Promise<readonly T[]>;
}

interface RdbQuery<T> {
  select(columns?: string): RdbQuery<T>;
  limit(value: number): RdbQuery<T>;
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
}

export function createCloudBaseRdbClient(app: RdbApp): CloudBaseRdbClient {
  return {
    capabilities: {
      transactions: false,
      nativeTcp: false,
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
      let request = app.rdb().from<T>(tableName).select("*");
      if (limit !== undefined) {
        request = request.limit(limit);
      }
      if (limit !== undefined && limit > 0) {
        request = request.range(offset, offset + limit - 1);
      }

      const result = await request;
      if (result.error !== undefined) {
        throw result.error;
      }
      return result.data ?? [];
    },
  };
}

export async function connectCloudBaseRdb(
  options: CloudBaseRdbConnectionOptions,
): Promise<CloudBaseRdbClient> {
  const { default: cloudbase } = await import("@cloudbase/js-sdk");
  const app = cloudbase.init({
    env: options.envId,
    accessKey: options.accessKey,
  });
  return createCloudBaseRdbClient(app as unknown as RdbApp);
}
