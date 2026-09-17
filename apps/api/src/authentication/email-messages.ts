/** The purpose a code is sent for. */
export type CodePurpose = "verify_email" | "reset_password";

/** What goes into one code email. */
export interface CodeEmailInput {
  readonly productName: string;
  readonly code: string;
  readonly purpose: CodePurpose;
  readonly expiresInMinutes: number;
}

/** A code email's subject and body, written in one language. */
export interface CodeEmailMessages {
  codeEmail(input: CodeEmailInput): { subject: string; text: string };
}

const english: CodeEmailMessages = {
  codeEmail: ({ productName, code, purpose, expiresInMinutes }) => ({
    subject: `${productName}: your code is ${code}`,
    text: `Enter ${code} to ${purpose === "verify_email" ? "verify your email" : "reset your password"}. The code expires in ${expiresInMinutes} minutes. If you did not request it, ignore this message.`,
  }),
};

const simplifiedChinese: CodeEmailMessages = {
  codeEmail: ({ productName, code, purpose, expiresInMinutes }) => ({
    subject: `${productName}：您的验证码是 ${code}`,
    text: `请输入 ${code} 以${purpose === "verify_email" ? "验证您的邮箱" : "重置您的密码"}。验证码将在 ${expiresInMinutes} 分钟后失效。如果这不是您本人的操作，请忽略这封邮件。`,
  }),
};

const traditionalChinese: CodeEmailMessages = {
  codeEmail: ({ productName, code, purpose, expiresInMinutes }) => ({
    subject: `${productName}：您的驗證碼是 ${code}`,
    text: `請輸入 ${code} 以${purpose === "verify_email" ? "驗證您的電子郵件" : "重設您的密碼"}。驗證碼將在 ${expiresInMinutes} 分鐘後失效。如果這不是您本人的操作，請忽略這封郵件。`,
  }),
};

/**
 * The languages the emails are written in, by tag, with the tag each falls
 * back to when it has no messages of its own. A locale not listed here reads
 * its language subtag ("zh-SG" -> "zh") and then English.
 */
const catalogs: ReadonlyMap<string, CodeEmailMessages> = new Map([
  ["en", english],
  ["zh-Hans", simplifiedChinese],
  ["zh-Hant", traditionalChinese],
  ["zh", simplifiedChinese],
]);

/** Regions that write Traditional Chinese, for tags that name a region but no script. */
const traditionalRegions = new Set(["TW", "HK", "MO"]);

/** "zh-hant-tw" -> "zh-Hant-TW": the case the catalog keys use. */
function normalizeTag(tag: string): string {
  return tag
    .split("-")
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (part.length === 4)
        return part[0]?.toUpperCase() + part.slice(1).toLowerCase();
      if (part.length === 2) return part.toUpperCase();
      return part;
    })
    .join("-");
}

/** The messages for a user's locale, English when the locale is unset or unknown. */
export function messagesFor(
  locale: string | null | undefined,
): CodeEmailMessages {
  if (locale === null || locale === undefined) return english;
  const [first = "", ...rest] = locale.split("-");
  const language = first.toLowerCase();
  const script = rest.find((part) => /^[A-Za-z]{4}$/.test(part));
  const region = rest.find((part) => /^[A-Za-z]{2}$/.test(part))?.toUpperCase();
  const candidates = [
    locale,
    script === undefined ? undefined : `${language}-${script}`,
    language === "zh" && script === undefined && region !== undefined
      ? traditionalRegions.has(region)
        ? "zh-Hant"
        : "zh-Hans"
      : undefined,
    language,
  ].map((candidate) =>
    candidate === undefined ? undefined : normalizeTag(candidate),
  );
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const found = catalogs.get(candidate);
    if (found !== undefined) return found;
  }
  return english;
}
