import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** The mailbox file the journeys' API writes its emails to (`playwright.config.ts`). */
const mailboxPath = resolve(
  process.cwd(),
  "apps/api/.livtales/e2e-emails.jsonl",
);

/**
 * The six-digit code of the latest email sent to the address, waiting for
 * it to be written: the API answers the request before the email lands.
 */
export async function latestCodeFor(email: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const lines = (await readFile(mailboxPath, "utf8").catch(() => ""))
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as { to: string; subject: string });
    const latest = lines.filter((line) => line.to === email).at(-1);
    const code = latest?.subject.match(/\b(\d{6})\b/)?.[1];
    if (code !== undefined) return code;
    await new Promise((settle) => setTimeout(settle, 250));
  }
  throw new Error(`No code was emailed to ${email}.`);
}
