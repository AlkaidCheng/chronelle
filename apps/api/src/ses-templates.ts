/**
 * Manages the Tencent Cloud SES templates the API sends from.
 *
 *   pnpm --filter @livtales/api ses:templates [--web-url URL] [--product NAME]
 *     prints every template's name and body
 *   ... --create   creates each template and prints TENCENT_SES_TEMPLATES
 *   ... --update   replaces each listed template's body (it goes back to review)
 *   ... --status   lists the account's templates with their review status
 *
 * The web URL (default WEB_PUBLIC_URL) is written into the invitation
 * template, so each web origin has its own templates. The API calls read
 * TENCENT_SES_SECRET_ID, TENCENT_SES_SECRET_KEY, and TENCENT_SES_REGION
 * (default ap-hongkong); --update also reads TENCENT_SES_TEMPLATES.
 */
import { parseArgs } from "node:util";

import {
  type EmailTemplateSource,
  emailTemplateSources,
} from "./authentication/email-messages.js";
import {
  type TencentCloudCredential,
  callTencentCloud,
} from "./authentication/tencent-cloud-api.js";
import {
  type EmailTemplateKey,
  parseEmailTemplateIds,
} from "./authentication/tencent-ses-email-sender.js";

const { values } = parseArgs({
  options: {
    "web-url": { type: "string" },
    product: { type: "string", default: "LivTales" },
    create: { type: "boolean", default: false },
    update: { type: "boolean", default: false },
    status: { type: "boolean", default: false },
  },
});

function credential(): TencentCloudCredential {
  const secretId = process.env.TENCENT_SES_SECRET_ID;
  const secretKey = process.env.TENCENT_SES_SECRET_KEY;
  if (!secretId || !secretKey)
    throw new Error(
      "Set TENCENT_SES_SECRET_ID and TENCENT_SES_SECRET_KEY to call SES.",
    );
  return { secretId, secretKey };
}

const region = process.env.TENCENT_SES_REGION ?? "ap-hongkong";

const call = (action: string, body: unknown) =>
  callTencentCloud(credential(), {
    service: "ses",
    host: "ses.tencentcloudapi.com",
    action,
    version: "2020-10-02",
    region,
    body,
  });

/** `livtales_verify_email_zh_hans`: letters, digits, and underscores. */
const templateName = (product: string, source: EmailTemplateSource) =>
  `${product}_${source.name}_${source.locale}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");

const content = (source: EmailTemplateSource) => ({
  Text: Buffer.from(source.text, "utf8").toString("base64"),
});

function sources(): readonly EmailTemplateSource[] {
  const webBaseUrl = values["web-url"] ?? process.env.WEB_PUBLIC_URL;
  if (webBaseUrl === undefined || !/^https:\/\//.test(webBaseUrl))
    throw new Error(
      "Pass --web-url (or set WEB_PUBLIC_URL) to the web app's https origin.",
    );
  return emailTemplateSources({ productName: values.product, webBaseUrl });
}

if (values.status) {
  const listed = await call("ListEmailTemplates", { Limit: 100, Offset: 0 });
  console.log(JSON.stringify(listed.TemplatesMetadata ?? [], null, 2));
} else if (values.create) {
  const ids: Partial<Record<EmailTemplateKey, number>> = {};
  for (const source of sources()) {
    const created = await call("CreateEmailTemplate", {
      TemplateName: templateName(values.product, source),
      TemplateContent: content(source),
    });
    ids[`${source.name}.${source.locale}`] = created.TemplateID as number;
    console.error(`created ${templateName(values.product, source)}`);
  }
  console.log(JSON.stringify(ids));
} else if (values.update) {
  const ids = parseEmailTemplateIds(process.env.TENCENT_SES_TEMPLATES ?? "");
  for (const source of sources()) {
    await call("UpdateEmailTemplate", {
      TemplateID: ids.get(`${source.name}.${source.locale}`),
      TemplateName: templateName(values.product, source),
      TemplateContent: content(source),
    });
    console.error(`updated ${templateName(values.product, source)}`);
  }
} else {
  for (const source of sources())
    console.log(`# ${templateName(values.product, source)}\n${source.text}\n`);
}
