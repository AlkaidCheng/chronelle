import {
  type EmailLocale,
  type EmailTemplateName,
  emailLocales,
  emailTemplateNames,
} from "./email-messages.js";
import type { EmailMessage, EmailSender } from "./email-sender.js";
import {
  type TencentCloudCredential,
  callTencentCloud,
} from "./tencent-cloud-api.js";

/** The key a template ID is listed under: `verify_email.zh-Hans`. */
export type EmailTemplateKey = `${EmailTemplateName}.${EmailLocale}`;

/** Every template the API sends from, by key. */
export const emailTemplateKeys: readonly EmailTemplateKey[] =
  emailLocales.flatMap((locale) =>
    emailTemplateNames.map((name): EmailTemplateKey => `${name}.${locale}`),
  );

/**
 * Reads the template IDs from their JSON form, `{"verify_email.en": 123, ...}`,
 * and requires one positive integer for every template the API sends.
 */
export function parseEmailTemplateIds(
  json: string,
): ReadonlyMap<EmailTemplateKey, number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("TENCENT_SES_TEMPLATES is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("TENCENT_SES_TEMPLATES must be a JSON object.");
  const entries = parsed as Record<string, unknown>;
  const missing = emailTemplateKeys.filter((key) => {
    const id = entries[key];
    return typeof id !== "number" || !Number.isInteger(id) || id <= 0;
  });
  if (missing.length > 0)
    throw new Error(
      `TENCENT_SES_TEMPLATES lacks a template ID for ${missing.join(", ")}.`,
    );
  return new Map(
    emailTemplateKeys.map((key) => [key, entries[key] as number] as const),
  );
}

export interface TencentSesOptions {
  readonly credential: TencentCloudCredential;
  /** The API region the sender domain was verified in, such as ap-hongkong. */
  readonly region: string;
  /** The verified sender, with the name recipients see: `LivTales <noreply@...>`. */
  readonly from: string;
  readonly templates: ReadonlyMap<EmailTemplateKey, number>;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}

/**
 * Delivery through Tencent Cloud SES's SendEmail API. Each email is sent
 * from its reviewed template with the email's values, as a triggered
 * (transactional) email.
 */
export class TencentSesEmailSender implements EmailSender {
  readonly #options: TencentSesOptions;

  constructor(options: TencentSesOptions) {
    this.#options = options;
  }

  async send(message: EmailMessage): Promise<void> {
    const key: EmailTemplateKey = `${message.template.name}.${message.template.locale}`;
    const templateId = this.#options.templates.get(key);
    if (templateId === undefined)
      throw new Error(`No Tencent SES template is configured for ${key}.`);
    await callTencentCloud(
      this.#options.credential,
      {
        service: "ses",
        host: "ses.tencentcloudapi.com",
        action: "SendEmail",
        version: "2020-10-02",
        region: this.#options.region,
        body: {
          FromEmailAddress: this.#options.from,
          Destination: [message.to],
          Subject: message.subject,
          Template: {
            TemplateID: templateId,
            TemplateData: JSON.stringify(message.template.data),
          },
          TriggerType: 1,
        },
      },
      {
        ...(this.#options.fetch === undefined
          ? {}
          : { fetch: this.#options.fetch }),
        ...(this.#options.now === undefined ? {} : { now: this.#options.now }),
        ...(this.#options.timeoutMs === undefined
          ? {}
          : { timeoutMs: this.#options.timeoutMs }),
      },
    );
  }
}
