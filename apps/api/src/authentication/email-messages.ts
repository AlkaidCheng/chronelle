/** The purpose a code is sent for. */
export type CodePurpose = "verify_email" | "reset_password";

/** What goes into one code email. */
export interface CodeEmailInput {
  readonly productName: string;
  readonly code: string;
  readonly purpose: CodePurpose;
  readonly expiresInMinutes: number;
}

/** What goes into a friend request email to an account. */
export interface FriendRequestEmailInput {
  readonly productName: string;
  readonly senderName: string;
  readonly senderEmail: string;
  readonly message: string | null;
}

/** What goes into an invitation email to an address without an account. */
export interface FriendInvitationEmailInput extends FriendRequestEmailInput {
  readonly link: string;
  readonly expiresInDays: number;
}

/** The emails the API sends, each written in one language. */
export interface CodeEmailMessages {
  codeEmail(input: CodeEmailInput): { subject: string; text: string };
  friendRequestEmail(input: FriendRequestEmailInput): {
    subject: string;
    text: string;
  };
  friendInvitationEmail(input: FriendInvitationEmailInput): {
    subject: string;
    text: string;
  };
}

const quoted = (message: string | null, lead: string) =>
  message === null ? "" : ` ${lead} "${message}"`;

const english: CodeEmailMessages = {
  codeEmail: ({ productName, code, purpose, expiresInMinutes }) => ({
    subject: `${productName}: your code is ${code}`,
    text: `Enter ${code} to ${purpose === "verify_email" ? "verify your email" : "reset your password"}. The code expires in ${expiresInMinutes} minutes. If you did not request it, ignore this message.`,
  }),
  friendRequestEmail: ({ productName, senderName, senderEmail, message }) => ({
    subject: `${productName}: ${senderName} wants to connect`,
    text: `${senderName} (${senderEmail}) invited you to connect on ${productName}.${quoted(message, "Their note:")} Sign in and open Friends to accept or decline.`,
  }),
  friendInvitationEmail: ({
    productName,
    senderName,
    senderEmail,
    message,
    link,
    expiresInDays,
  }) => ({
    subject: `${productName}: ${senderName} invited you`,
    text: `${senderName} (${senderEmail}) invited you to ${productName}.${quoted(message, "Their note:")} Create your account here: ${link} The link is valid for ${expiresInDays} days. If you do not know ${senderName}, ignore this message.`,
  }),
};

const simplifiedChinese: CodeEmailMessages = {
  codeEmail: ({ productName, code, purpose, expiresInMinutes }) => ({
    subject: `${productName}：您的验证码是 ${code}`,
    text: `请输入 ${code} 以${purpose === "verify_email" ? "验证您的邮箱" : "重置您的密码"}。验证码将在 ${expiresInMinutes} 分钟后失效。如果这不是您本人的操作，请忽略这封邮件。`,
  }),
  friendRequestEmail: ({ productName, senderName, senderEmail, message }) => ({
    subject: `${productName}：${senderName} 想与您成为好友`,
    text: `${senderName}（${senderEmail}）邀请您在 ${productName} 上成为好友。${message === null ? "" : `对方留言：“${message}” `}登录后打开“好友”即可接受或拒绝。`,
  }),
  friendInvitationEmail: ({
    productName,
    senderName,
    senderEmail,
    message,
    link,
    expiresInDays,
  }) => ({
    subject: `${productName}：${senderName} 邀请您加入`,
    text: `${senderName}（${senderEmail}）邀请您加入 ${productName}。${message === null ? "" : `对方留言：“${message}” `}请通过此链接创建账号：${link} 链接 ${expiresInDays} 天内有效。如果您不认识 ${senderName}，请忽略这封邮件。`,
  }),
};

const traditionalChinese: CodeEmailMessages = {
  codeEmail: ({ productName, code, purpose, expiresInMinutes }) => ({
    subject: `${productName}：您的驗證碼是 ${code}`,
    text: `請輸入 ${code} 以${purpose === "verify_email" ? "驗證您的電子郵件" : "重設您的密碼"}。驗證碼將在 ${expiresInMinutes} 分鐘後失效。如果這不是您本人的操作，請忽略這封郵件。`,
  }),
  friendRequestEmail: ({ productName, senderName, senderEmail, message }) => ({
    subject: `${productName}：${senderName} 想與您成為好友`,
    text: `${senderName}（${senderEmail}）邀請您在 ${productName} 上成為好友。${message === null ? "" : `對方留言：「${message}」 `}登入後開啟「好友」即可接受或拒絕。`,
  }),
  friendInvitationEmail: ({
    productName,
    senderName,
    senderEmail,
    message,
    link,
    expiresInDays,
  }) => ({
    subject: `${productName}：${senderName} 邀請您加入`,
    text: `${senderName}（${senderEmail}）邀請您加入 ${productName}。${message === null ? "" : `對方留言：「${message}」 `}請透過此連結建立帳號：${link} 連結 ${expiresInDays} 天內有效。如果您不認識 ${senderName}，請忽略這封郵件。`,
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
