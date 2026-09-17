import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { EmailMessage, EmailSender } from "./email-sender.js";

/**
 * Staging delivery without a mail transport: each message is appended to a
 * file as one JSON line with the time it was written, so an operator with
 * shell access to the instance can read a verification code with `tail`.
 * The file holds codes in clear text; keep it on the instance's own disk.
 */
export class FileEmailSender implements EmailSender {
  readonly #path: string;
  #ready: Promise<void> | undefined;

  constructor(path: string) {
    this.#path = path;
  }

  async send(message: EmailMessage): Promise<void> {
    this.#ready ??= mkdir(dirname(this.#path), { recursive: true }).then(
      () => undefined,
    );
    await this.#ready;
    const line = JSON.stringify({
      writtenAt: new Date().toISOString(),
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    await appendFile(this.#path, `${line}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}
