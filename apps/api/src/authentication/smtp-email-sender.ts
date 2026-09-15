import { createTransport, type Transporter } from "nodemailer";

import type { EmailMessage, EmailSender } from "./email-sender.js";

/** SMTP delivery through a transport URL (smtps://user:password@host:465) and a sender address. */
export class SmtpEmailSender implements EmailSender {
  readonly #transport: Transporter;
  readonly #from: string;

  constructor(smtpUrl: string, from: string) {
    this.#transport = createTransport(smtpUrl);
    this.#from = from;
  }

  async send(message: EmailMessage): Promise<void> {
    await this.#transport.sendMail({
      from: this.#from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}
