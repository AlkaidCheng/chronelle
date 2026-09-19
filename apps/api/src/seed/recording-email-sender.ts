import type {
  EmailMessage,
  EmailSender,
} from "../authentication/email-sender.js";

/**
 * Keeps every message instead of delivering it, so a flow that needs the
 * code an email carries (a sign-up completed by the seed) can read it back.
 */
export class RecordingEmailSender implements EmailSender {
  readonly messages: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }

  /** The six-digit code in the latest message to an address. */
  codeFor(email: string): string {
    const message = [...this.messages]
      .reverse()
      .find((candidate) => candidate.to === email);
    const code = /\b(\d{6})\b/u.exec(message?.text ?? "")?.[1];
    if (code === undefined) throw new Error(`No code was sent to ${email}.`);
    return code;
  }
}
