import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileEmailSender } from "../src/authentication/file-email-sender.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "chronelle-email-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("FileEmailSender", () => {
  it("appends each message as one JSON line under a private file", async () => {
    const path = join(directory, "outbox", "emails.jsonl");
    const sender = new FileEmailSender(path);
    await sender.send({
      to: "first@example.test",
      subject: "Your LivTales code",
      text: "Your code is 123456.",
    });
    await sender.send({
      to: "second@example.test",
      subject: "Your LivTales code",
      text: "Your code is 654321.",
    });
    const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    const [first, second] = lines.map((line) => JSON.parse(line));
    expect(first).toMatchObject({
      to: "first@example.test",
      subject: "Your LivTales code",
      text: "Your code is 123456.",
    });
    expect(Date.parse(first.writtenAt)).not.toBeNaN();
    expect(second.text).toBe("Your code is 654321.");
    if (process.platform !== "win32")
      expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("keeps concurrent sends whole", async () => {
    const path = join(directory, "emails.jsonl");
    const sender = new FileEmailSender(path);
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        sender.send({
          to: `person-${index}@example.test`,
          subject: "Code",
          text: `Code ${index}`,
        }),
      ),
    );
    const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
    expect(lines).toHaveLength(20);
    expect(new Set(lines.map((line) => JSON.parse(line).text)).size).toBe(20);
  });
});
