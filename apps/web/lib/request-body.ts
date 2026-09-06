export class RequestBodyError extends Error {
  constructor(readonly status: 400 | 413) {
    super(
      status === 413
        ? "The request body is too large."
        : "The request body is invalid.",
    );
    this.name = "RequestBodyError";
  }
}

/** Read a byte-limited body and release its reader on failure or cancellation. */
export async function readRequestBody(
  request: Request,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const reader = request.body?.getReader();
  const cancel = () => {
    void reader?.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    const lengthHeader = request.headers.get("content-length");
    if (lengthHeader !== null && !/^\d+$/.test(lengthHeader))
      throw new RequestBodyError(400);
    const declaredLength =
      lengthHeader === null ? undefined : Number(lengthHeader);
    if (declaredLength !== undefined && declaredLength > maximumBytes)
      throw new RequestBodyError(413);

    let bytes = new Uint8Array(0);
    let size = 0;
    if (reader !== undefined) {
      while (true) {
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) break;
        const nextSize = size + chunk.value.byteLength;
        if (nextSize > maximumBytes) throw new RequestBodyError(413);
        if (nextSize > bytes.byteLength) {
          const expanded = new Uint8Array(
            Math.min(maximumBytes, Math.max(nextSize, bytes.byteLength * 2)),
          );
          expanded.set(bytes);
          bytes = expanded;
        }
        bytes.set(chunk.value, size);
        size = nextSize;
      }
    }
    if (declaredLength !== undefined && declaredLength !== size)
      throw new RequestBodyError(400);
    return size === bytes.byteLength
      ? bytes.buffer
      : bytes.slice(0, size).buffer;
  } catch (error) {
    // An untrusted stream's cleanup must not delay cancellation or rejection.
    cancel();
    signal.throwIfAborted();
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError(400);
  } finally {
    signal.removeEventListener("abort", cancel);
    reader?.releaseLock();
  }
}
