import { describe, expect, it } from "vitest";

import {
  emailLocales,
  emailTemplateNames,
  emailTemplateSources,
  fillPlaceholders,
  messagesFor,
} from "../src/authentication/email-messages.js";

const input = {
  productName: "LivTales",
  code: "482913",
  purpose: "verify_email" as const,
  expiresInMinutes: 15,
};

describe("messagesFor", () => {
  it("writes English for no locale, an unknown locale, and en variants", () => {
    for (const locale of [null, undefined, "fr", "en", "en-GB", "xx-YY"]) {
      const { subject, text } = messagesFor(locale).codeEmail(input);
      expect(subject).toBe("LivTales: your code is 482913");
      expect(text).toContain("Enter 482913 to verify your email");
      expect(text).toContain("15 minutes");
    }
  });

  it("writes Simplified Chinese for zh-Hans, zh, and Simplified regions", () => {
    for (const locale of ["zh-Hans", "zh", "zh-CN", "zh-SG", "zh-Hans-CN"]) {
      const { subject, text } = messagesFor(locale).codeEmail(input);
      expect(subject).toBe("LivTales：您的验证码是 482913");
      expect(text).toContain("验证您的邮箱");
      expect(text).toContain("15 分钟");
    }
  });

  it("writes Traditional Chinese for zh-Hant and Traditional regions", () => {
    for (const locale of ["zh-Hant", "zh-TW", "zh-HK", "zh-MO", "zh-Hant-TW"]) {
      const { subject, text } = messagesFor(locale).codeEmail(input);
      expect(subject).toBe("LivTales：您的驗證碼是 482913");
      expect(text).toContain("驗證您的電子郵件");
      expect(text).toContain("15 分鐘");
    }
  });

  it("names the purpose in every language", () => {
    const reset = { ...input, purpose: "reset_password" as const };
    expect(messagesFor("en").codeEmail(reset).text).toContain(
      "reset your password",
    );
    expect(messagesFor("zh-Hans").codeEmail(reset).text).toContain(
      "重置您的密码",
    );
    expect(messagesFor("zh-Hant").codeEmail(reset).text).toContain(
      "重設您的密碼",
    );
  });
});

describe("friend emails", () => {
  const request = {
    productName: "LivTales",
    senderName: "Ana",
    senderEmail: "ana@example.test",
    message: "Climbing on Saturday?",
  };

  it("tells an account who asked, with the note, in its language", () => {
    const english = messagesFor("en").friendRequestEmail(request);
    expect(english.subject).toBe("LivTales: Ana wants to connect");
    expect(english.text).toContain("Ana (ana@example.test)");
    expect(english.text).toContain('"Climbing on Saturday?"');
    expect(
      messagesFor("en").friendRequestEmail({ ...request, message: null }).text,
    ).not.toContain('"');
    expect(messagesFor("zh-Hans").friendRequestEmail(request).subject).toBe(
      "LivTales：Ana 想与您成为好友",
    );
    expect(messagesFor("zh-TW").friendRequestEmail(request).subject).toBe(
      "LivTales：Ana 想與您成為好友",
    );
  });

  it("gives a new address the sign-up link and its validity", () => {
    const input = {
      ...request,
      webBaseUrl: "https://livtales.example",
      token: "t/1",
      expiresInDays: 14,
    };
    const english = messagesFor(null).friendInvitationEmail(input);
    expect(english.subject).toBe("LivTales: Ana invited you");
    expect(english.text).toContain("https://livtales.example/invite/t%2F1");
    expect(english.text).toContain("14 days");
    expect(messagesFor("zh-Hans").friendInvitationEmail(input).text).toContain(
      "14 天内有效",
    );
    expect(messagesFor("zh-Hant").friendInvitationEmail(input).text).toContain(
      "14 天內有效",
    );
  });
});

describe("email templates", () => {
  const webBaseUrl = "https://livtales.example";
  const written = (locale: string) => {
    const messages = messagesFor(locale);
    return [
      messages.codeEmail({
        productName: "LivTales",
        code: "482913",
        purpose: "verify_email",
        expiresInMinutes: 15,
      }),
      messages.codeEmail({
        productName: "LivTales",
        code: "482913",
        purpose: "reset_password",
        expiresInMinutes: 15,
      }),
      messages.friendRequestEmail({
        productName: "LivTales",
        senderName: "Ana",
        senderEmail: "ana@example.test",
        message: "Climbing on Saturday?",
      }),
      messages.friendInvitationEmail({
        productName: "LivTales",
        senderName: "Ana",
        senderEmail: "ana@example.test",
        message: null,
        webBaseUrl,
        token: "t/1",
        expiresInDays: 14,
      }),
    ];
  };
  const sources = emailTemplateSources({
    productName: "LivTales",
    webBaseUrl: `${webBaseUrl}/`,
  });

  it("has one template for every email in every language", () => {
    expect(sources).toHaveLength(
      emailTemplateNames.length * emailLocales.length,
    );
    for (const source of sources) {
      expect(source.text).not.toMatch(/\{\{(product|web)\}\}/);
      expect(source.text).toMatch(/\{\{\w+\}\}/);
    }
    expect(
      sources.find(
        (source) =>
          source.name === "friend_invitation" && source.locale === "en",
      )?.text,
    ).toContain("https://livtales.example/invite/{{token}}");
  });

  it("writes the same email from a stored template as from the catalog", () => {
    for (const locale of emailLocales)
      for (const email of written(locale)) {
        const source = sources.find(
          (item) =>
            item.name === email.template.name &&
            item.locale === email.template.locale,
        );
        expect(email.template.locale).toBe(locale);
        expect(source).toBeDefined();
        const filled = fillPlaceholders(
          source?.text ?? "",
          email.template.data,
        );
        expect(filled).toBe(email.text);
        expect(filled).not.toMatch(/\{\{\w+\}\}/);
      }
  });
});
