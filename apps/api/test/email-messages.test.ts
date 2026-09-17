import { describe, expect, it } from "vitest";

import { messagesFor } from "../src/authentication/email-messages.js";

const input = {
  productName: "Chronelle",
  code: "482913",
  purpose: "verify_email" as const,
  expiresInMinutes: 15,
};

describe("messagesFor", () => {
  it("writes English for no locale, an unknown locale, and en variants", () => {
    for (const locale of [null, undefined, "fr", "en", "en-GB", "xx-YY"]) {
      const { subject, text } = messagesFor(locale).codeEmail(input);
      expect(subject).toBe("Chronelle: your code is 482913");
      expect(text).toContain("Enter 482913 to verify your email");
      expect(text).toContain("15 minutes");
    }
  });

  it("writes Simplified Chinese for zh-Hans, zh, and Simplified regions", () => {
    for (const locale of ["zh-Hans", "zh", "zh-CN", "zh-SG", "zh-Hans-CN"]) {
      const { subject, text } = messagesFor(locale).codeEmail(input);
      expect(subject).toBe("Chronelle：您的验证码是 482913");
      expect(text).toContain("验证您的邮箱");
      expect(text).toContain("15 分钟");
    }
  });

  it("writes Traditional Chinese for zh-Hant and Traditional regions", () => {
    for (const locale of ["zh-Hant", "zh-TW", "zh-HK", "zh-MO", "zh-Hant-TW"]) {
      const { subject, text } = messagesFor(locale).codeEmail(input);
      expect(subject).toBe("Chronelle：您的驗證碼是 482913");
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
