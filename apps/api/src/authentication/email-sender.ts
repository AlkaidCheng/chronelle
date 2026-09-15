/** A plain-text message to one recipient. */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** Outbound email; the provider is chosen by deployment configuration. */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Development delivery: the message is written to the log so a local
 * sign-up can be completed without a mail provider. Never for a deployment.
 */
export class LoggingEmailSender implements EmailSender {
  readonly #log: (message: EmailMessage) => void;

  constructor(log: (message: EmailMessage) => void) {
    this.#log = log;
  }

  async send(message: EmailMessage): Promise<void> {
    this.#log(message);
  }
}
