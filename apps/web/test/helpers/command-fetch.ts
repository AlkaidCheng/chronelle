/**
 * A content save is a reversible command: the client reads the stack, posts
 * the edit, and reads the record back. This wraps a test's own fetch stub so
 * the stub still answers one request per save, the write, as it did when the
 * save was a plain update: the command state and the read-back are answered
 * here, and the write reaches the stub as a PATCH of the record with the
 * edit's patch as its body.
 */
export function withCommands(
  write: typeof globalThis.fetch,
): typeof globalThis.fetch {
  let version = 0;
  const saved = new Map<string, unknown>();
  const collections = { event: "events", task: "tasks" } as const;
  return async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/api/commands") && method === "GET")
      return Response.json({ version, undo: null, redo: null });
    if (url.endsWith("/api/commands") && method === "POST") {
      const body = JSON.parse(String(init?.body)) as {
        operationId: string;
        edits: {
          objectType: keyof typeof collections;
          objectId: string;
          patch: Record<string, unknown>;
        }[];
      };
      const edit = body.edits[0];
      if (edit === undefined) throw new Error("A command carries one edit.");
      const response = await write(
        `/api/${collections[edit.objectType]}/${edit.objectId}`,
        { ...init, method: "PATCH", body: JSON.stringify(edit.patch) },
      );
      if (!response.ok) return response;
      const record = (await response.json()) as { version?: number };
      saved.set(edit.objectId, record);
      version += 1;
      return Response.json({
        operationId: body.operationId,
        commandId: crypto.randomUUID(),
        direction: "execute",
        stackVersion: version,
        objects: [{ id: edit.objectId, version: record.version ?? 1 }],
      });
    }
    const readBack = /\/api\/(?:events|tasks)\/([^/?]+)$/u.exec(url);
    if (method === "GET" && readBack?.[1] !== undefined) {
      const record = saved.get(readBack[1]);
      if (record !== undefined) return Response.json(record);
    }
    return write(input, init);
  };
}
