/** The purpose a code is sent for. */
export type CodePurpose = "verify_email" | "reset_password";

/** The emails the API sends; a code email is one of the first two. */
export const emailTemplateNames = [
  "verify_email",
  "reset_password",
  "friend_request",
  "friend_invitation",
] as const;
export type EmailTemplateName = (typeof emailTemplateNames)[number];

/** The languages the emails are written in. */
export const emailLocales = ["en", "zh-Hans", "zh-Hant"] as const;
export type EmailLocale = (typeof emailLocales)[number];

/**
 * The template an email fills and the values it fills it with. The product
 * name and the web origin are part of the template itself (see
 * `emailTemplateSources`); `data` holds what changes from one email to the
 * next.
 */
export interface EmailTemplateUse {
  readonly name: EmailTemplateName;
  readonly locale: EmailLocale;
  readonly data: Readonly<Record<string, string>>;
}

/** One email, written out, with the template it was written from. */
export interface WrittenEmail {
  readonly subject: string;
  readonly text: string;
  readonly template: EmailTemplateUse;
}

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
  /** The web app's origin; the invitation opens at `/invite/<token>` there. */
  readonly webBaseUrl: string;
  readonly token: string;
  readonly expiresInDays: number;
}

/** The emails the API sends, each written in one language. */
export interface CodeEmailMessages {
  codeEmail(input: CodeEmailInput): WrittenEmail;
  friendRequestEmail(input: FriendRequestEmailInput): WrittenEmail;
  friendInvitationEmail(input: FriendInvitationEmailInput): WrittenEmail;
}

/**
 * One language's wording. `{{product}}` and `{{web}}` are filled when a
 * template is made; every other `{{name}}` is filled per email.
 */
interface Wording {
  readonly locale: EmailLocale;
  readonly emails: Readonly<
    Record<
      EmailTemplateName,
      { readonly subject: string; readonly text: string }
    >
  >;
  /** A friend email's optional note, around the sender's own words. */
  readonly note: string;
}

const english: Wording = {
  locale: "en",
  emails: {
    verify_email: {
      subject: "{{product}}: your code is {{code}}",
      text: "Enter {{code}} to verify your email. The code expires in {{minutes}} minutes. If you did not request it, ignore this message.",
    },
    reset_password: {
      subject: "{{product}}: your code is {{code}}",
      text: "Enter {{code}} to reset your password. The code expires in {{minutes}} minutes. If you did not request it, ignore this message.",
    },
    friend_request: {
      subject: "{{product}}: {{sender}} wants to connect",
      text: "{{sender}} ({{senderEmail}}) invited you to connect on {{product}}.{{note}} Sign in and open Friends to accept or decline.",
    },
    friend_invitation: {
      subject: "{{product}}: {{sender}} invited you",
      text: "{{sender}} ({{senderEmail}}) invited you to {{product}}.{{note}} Accept the invitation here: {{web}}/invite/{{token}} The link is valid for {{days}} days. If you do not know {{sender}}, ignore this message.",
    },
  },
  note: ' Their note: "{{message}}"',
};

const simplifiedChinese: Wording = {
  locale: "zh-Hans",
  emails: {
    verify_email: {
      subject: "{{product}}：您的验证码是 {{code}}",
      text: "请输入 {{code}} 以验证您的邮箱。验证码将在 {{minutes}} 分钟后失效。如果这不是您本人的操作，请忽略这封邮件。",
    },
    reset_password: {
      subject: "{{product}}：您的验证码是 {{code}}",
      text: "请输入 {{code}} 以重置您的密码。验证码将在 {{minutes}} 分钟后失效。如果这不是您本人的操作，请忽略这封邮件。",
    },
    friend_request: {
      subject: "{{product}}：{{sender}} 想与您成为好友",
      text: "{{sender}}（{{senderEmail}}）邀请您在 {{product}} 上成为好友。{{note}}登录后打开“好友”即可接受或拒绝。",
    },
    friend_invitation: {
      subject: "{{product}}：{{sender}} 邀请您加入",
      text: "{{sender}}（{{senderEmail}}）邀请您加入 {{product}}。{{note}}请通过此链接接受邀请：{{web}}/invite/{{token}} 链接 {{days}} 天内有效。如果您不认识 {{sender}}，请忽略这封邮件。",
    },
  },
  note: "对方留言：“{{message}}” ",
};

const traditionalChinese: Wording = {
  locale: "zh-Hant",
  emails: {
    verify_email: {
      subject: "{{product}}：您的驗證碼是 {{code}}",
      text: "請輸入 {{code}} 以驗證您的電子郵件。驗證碼將在 {{minutes}} 分鐘後失效。如果這不是您本人的操作，請忽略這封郵件。",
    },
    reset_password: {
      subject: "{{product}}：您的驗證碼是 {{code}}",
      text: "請輸入 {{code}} 以重設您的密碼。驗證碼將在 {{minutes}} 分鐘後失效。如果這不是您本人的操作，請忽略這封郵件。",
    },
    friend_request: {
      subject: "{{product}}：{{sender}} 想與您成為好友",
      text: "{{sender}}（{{senderEmail}}）邀請您在 {{product}} 上成為好友。{{note}}登入後開啟「好友」即可接受或拒絕。",
    },
    friend_invitation: {
      subject: "{{product}}：{{sender}} 邀請您加入",
      text: "{{sender}}（{{senderEmail}}）邀請您加入 {{product}}。{{note}}請透過此連結接受邀請：{{web}}/invite/{{token}} 連結 {{days}} 天內有效。如果您不認識 {{sender}}，請忽略這封郵件。",
    },
  },
  note: "對方留言：「{{message}}」 ",
};

const wordings: Readonly<Record<EmailLocale, Wording>> = {
  en: english,
  "zh-Hans": simplifiedChinese,
  "zh-Hant": traditionalChinese,
};

/** Fills each `{{name}}` that `values` names; any other placeholder stays. */
export function fillPlaceholders(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? (values[name] as string) : placeholder,
  );
}

function writer(wording: Wording): CodeEmailMessages {
  const write = (
    name: EmailTemplateName,
    productName: string,
    web: string,
    data: Readonly<Record<string, string>>,
  ): WrittenEmail => {
    const { subject, text } = wording.emails[name];
    const values = { product: productName, web, ...data };
    return {
      subject: fillPlaceholders(subject, values),
      text: fillPlaceholders(text, values),
      template: { name, locale: wording.locale, data },
    };
  };
  const note = (message: string | null) =>
    message === null ? "" : fillPlaceholders(wording.note, { message });
  return {
    codeEmail: ({ productName, code, purpose, expiresInMinutes }) =>
      write(purpose, productName, "", {
        code,
        minutes: String(expiresInMinutes),
      }),
    friendRequestEmail: ({ productName, senderName, senderEmail, message }) =>
      write("friend_request", productName, "", {
        sender: senderName,
        senderEmail,
        note: note(message),
      }),
    friendInvitationEmail: ({
      productName,
      senderName,
      senderEmail,
      message,
      webBaseUrl,
      token,
      expiresInDays,
    }) =>
      write("friend_invitation", productName, webBaseUrl, {
        sender: senderName,
        senderEmail,
        note: note(message),
        token: encodeURIComponent(token),
        days: String(expiresInDays),
      }),
  };
}

/**
 * The languages the emails are written in, by tag, with the tag each falls
 * back to when it has no messages of its own. A locale not listed here reads
 * its language subtag ("zh-SG" -> "zh") and then English.
 */
const catalogs: ReadonlyMap<string, CodeEmailMessages> = new Map([
  ["en", writer(english)],
  ["zh-Hans", writer(simplifiedChinese)],
  ["zh-Hant", writer(traditionalChinese)],
  ["zh", writer(simplifiedChinese)],
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
  const fallback = catalogs.get("en") as CodeEmailMessages;
  if (locale === null || locale === undefined) return fallback;
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
  return fallback;
}

/** One email template as a mail provider stores it. */
export interface EmailTemplateSource {
  readonly name: EmailTemplateName;
  readonly locale: EmailLocale;
  /** The body, with the product name and web origin written in. */
  readonly text: string;
}

/**
 * Every email's body as a template for a provider that sends from stored
 * templates: the product name and web origin are written in, and each
 * per-email value stays a `{{name}}` placeholder that the email's
 * `template.data` fills.
 */
export function emailTemplateSources(options: {
  readonly productName: string;
  readonly webBaseUrl: string;
}): readonly EmailTemplateSource[] {
  const statics = {
    product: options.productName,
    web: options.webBaseUrl.replace(/\/+$/, ""),
  };
  return emailLocales.flatMap((locale) =>
    emailTemplateNames.map((name) => ({
      name,
      locale,
      text: fillPlaceholders(wordings[locale].emails[name].text, statics),
    })),
  );
}
