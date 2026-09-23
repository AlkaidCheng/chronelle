import { maximumNativeDocumentSizeBytes } from "@chronelle/schemas";

import { HttpError, InvalidRequestError } from "../errors.js";

const maximumMultipartOverheadBytes = 64 * 1024;
export const maximumMultipartBodyBytes =
  maximumNativeDocumentSizeBytes + maximumMultipartOverheadBytes;

/** Extracts the single file part accepted by the native transfer route. */
export function parseMultipartFile(
  contentType: string | undefined,
  body: unknown,
): Buffer {
  const match =
    /^multipart\/form-data;\s*boundary=(?:"([A-Za-z0-9'()+_,./:=?-]{1,70})"|([A-Za-z0-9'()+_,./:=?-]{1,70}))(?:\s*;.*)?$/iu.exec(
      contentType ?? "",
    );
  const boundary = match?.[1] ?? match?.[2];
  if (boundary === undefined || !Buffer.isBuffer(body)) {
    throw new InvalidRequestError();
  }

  const opening = Buffer.from(`--${boundary}\r\n`, "ascii");
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`, "ascii");
  if (
    !body.subarray(0, opening.length).equals(opening) ||
    !body.subarray(-closing.length).equals(closing)
  ) {
    throw new InvalidRequestError();
  }

  const headersEnd = body.indexOf("\r\n\r\n", opening.length, "ascii");
  if (headersEnd < 0 || headersEnd - opening.length > 8 * 1024) {
    throw new InvalidRequestError();
  }
  const headers = body.toString("latin1", opening.length, headersEnd);
  if (
    !headers
      .split("\r\n")
      .some((line) =>
        /^content-disposition:\s*form-data;\s*name="file"(?:;.*)?$/iu.test(
          line,
        ),
      )
  ) {
    throw new InvalidRequestError();
  }
  const fileStart = headersEnd + 4;
  const fileEnd = body.length - closing.length;
  if (fileEnd - fileStart > maximumNativeDocumentSizeBytes) {
    throw new HttpError(413, "payload_too_large", "The file is too large.");
  }
  if (
    fileEnd < fileStart ||
    body.indexOf(Buffer.from(`\r\n--${boundary}\r\n`, "ascii"), fileStart) !==
      -1
  ) {
    throw new InvalidRequestError();
  }
  return body.subarray(fileStart, fileEnd);
}
