import type { Sql } from "postgres";

interface TableFootprint {
  table: string;
  estimatedRows: string;
  dataBytes: string;
  indexBytes: string;
  totalBytes: string;
}

interface IndexFootprint {
  table: string;
  index: string;
  bytes: string;
  unique: boolean;
  primary: boolean;
}

interface HistoryFootprint {
  table: string;
  objectType: string;
  revisions: string;
  objects: string;
  storedJsonBytes: string;
  logicalJsonBytes: string;
}

/** Aggregate storage metadata; history scans are opt-in and no record content is returned. */
export async function readDatabaseFootprint(
  sql: Sql,
  { includeHistory = false }: { includeHistory?: boolean } = {},
) {
  return sql.begin("read only", async (transaction) => {
    await transaction`SET LOCAL statement_timeout = '30s'`;
    const tables = await transaction<TableFootprint[]>`
      SELECT c.relname AS "table",
        greatest(c.reltuples, 0)::bigint::text AS "estimatedRows",
        pg_table_size(c.oid)::text AS "dataBytes",
        pg_indexes_size(c.oid)::text AS "indexBytes",
        pg_total_relation_size(c.oid)::text AS "totalBytes"
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC, c.relname
    `;
    const indexes = await transaction<IndexFootprint[]>`
      SELECT t.relname AS "table", c.relname AS "index",
        pg_relation_size(c.oid)::text AS bytes,
        i.indisunique AS "unique", i.indisprimary AS "primary"
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
      ORDER BY pg_relation_size(c.oid) DESC, c.relname
    `;
    const history = includeHistory
      ? await transaction<HistoryFootprint[]>`
          SELECT 'object_revisions' AS "table",
            snapshot->>'objectType' AS "objectType",
            count(*)::text AS revisions,
            count(DISTINCT object_id)::text AS objects,
            coalesce(sum(pg_column_size(snapshot)), 0)::text AS "storedJsonBytes",
            coalesce(sum(octet_length(snapshot::text)), 0)::text AS "logicalJsonBytes"
          FROM object_revisions GROUP BY snapshot->>'objectType'
          UNION ALL
          SELECT 'event_page_revisions', 'event', count(*)::text,
            count(DISTINCT event_id)::text,
            coalesce(sum(pg_column_size(pages)), 0)::text,
            coalesce(sum(octet_length(pages::text)), 0)::text
          FROM event_page_revisions
          ORDER BY "table", "objectType"
        `
      : null;
    return { tables, indexes, history };
  });
}
