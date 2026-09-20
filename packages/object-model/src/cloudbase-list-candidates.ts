import type { CloudBaseRdbClient, CloudBaseRdbReader } from "@chronelle/db";

export type CloudBaseListClient = CloudBaseRdbReader &
  Pick<CloudBaseRdbClient, "rpc">;

/** The lightweight rows used to select IDs before hydrating canonical state. */
export function cloudbaseListRows(value: unknown): Record<string, unknown>[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (row) => row === null || typeof row !== "object" || Array.isArray(row),
    )
  )
    throw new Error("CloudBase returned invalid list candidates.");
  return value as Record<string, unknown>[];
}
