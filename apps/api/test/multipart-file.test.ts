import { describe, expect, it } from "vitest";

import { parseMultipartFile } from "../src/documents/multipart-file.js";

const boundary = "test-boundary";
const contentType = `multipart/form-data; boundary=${boundary}`;

function form(bytes: Buffer, extra = "") {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="document.pdf"\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`${extra}\r\n--${boundary}--\r\n`),
  ]);
}

describe("native multipart parser", () => {
  it("returns exact binary bytes, including nulls and line breaks", () => {
    const bytes = Buffer.from([0, 13, 10, 255, 7]);
    expect(parseMultipartFile(contentType, form(bytes))).toEqual(bytes);
  });

  it("rejects unrelated fields and malformed closing boundaries", () => {
    expect(() =>
      parseMultipartFile(
        contentType,
        form(
          Buffer.from("a"),
          `\r\n--${boundary}\r\nContent-Disposition: form-data; name="other"\r\n\r\nb`,
        ),
      ),
    ).toThrow();
    expect(() =>
      parseMultipartFile(contentType, Buffer.from("not a multipart body")),
    ).toThrow();
    expect(() =>
      parseMultipartFile(undefined, form(Buffer.from("a"))),
    ).toThrow();
  });
});
