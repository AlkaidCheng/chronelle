import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { messagesFor } from "../src/authentication/email-messages.js";
import {
  TencentCloudApiError,
  signTencentCloudRequest,
} from "../src/authentication/tencent-cloud-api.js";
import {
  TencentSesEmailSender,
  emailTemplateKeys,
  parseEmailTemplateIds,
} from "../src/authentication/tencent-ses-email-sender.js";

describe("signTencentCloudRequest", () => {
  // The worked example of Tencent Cloud's API 3.0 signature documentation:
  // its canonical request and string to sign do not depend on the key.
  const example = {
    service: "cvm",
    host: "cvm.tencentcloudapi.com",
    action: "DescribeInstances",
    version: "2017-03-12",
    region: "ap-guangzhou",
    payload:
      '{"Limit": 1, "Filters": [{"Values": ["\\u672a\\u547d\\u540d"], "Name": "instance-name"}]}',
    timestamp: 1551113065,
  };

  it("builds the documented canonical request and string to sign", () => {
    const signed = signTencentCloudRequest(
      { secretId: "AKIDEXAMPLE", secretKey: "secret" },
      example,
    );
    expect(signed.canonicalRequest).toBe(
      [
        "POST",
        "/",
        "",
        "content-type:application/json; charset=utf-8",
        "host:cvm.tencentcloudapi.com",
        "x-tc-action:describeinstances",
        "",
        "content-type;host;x-tc-action",
        "35e9c5b0e3ae67532d3c9f17ead6c90222632e5b1ff7f6e89887f1398934f064",
      ].join("\n"),
    );
    expect(
      createHash("sha256").update(signed.canonicalRequest).digest("hex"),
    ).toBe("7019a55be8395899b900fb5564e4200d984910f34794a27cb3fb7d10ff6a1e84");
    expect(signed.stringToSign).toBe(
      [
        "TC3-HMAC-SHA256",
        "1551113065",
        "2019-02-25/cvm/tc3_request",
        "7019a55be8395899b900fb5564e4200d984910f34794a27cb3fb7d10ff6a1e84",
      ].join("\n"),
    );
    expect(signed.authorization).toMatch(
      /^TC3-HMAC-SHA256 Credential=AKIDEXAMPLE\/2019-02-25\/cvm\/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=[0-9a-f]{64}$/,
    );
  });

  it("signs differently with another key", () => {
    const first = signTencentCloudRequest(
      { secretId: "AKIDEXAMPLE", secretKey: "one" },
      example,
    );
    const second = signTencentCloudRequest(
      { secretId: "AKIDEXAMPLE", secretKey: "two" },
      example,
    );
    expect(first.authorization).not.toBe(second.authorization);
  });
});

describe("parseEmailTemplateIds", () => {
  const all = Object.fromEntries(
    emailTemplateKeys.map((key, index) => [key, 1000 + index]),
  );

  it("reads one template ID for every email in every language", () => {
    const ids = parseEmailTemplateIds(JSON.stringify(all));
    expect(ids.size).toBe(12);
    expect(ids.get("verify_email.zh-Hant")).toBe(all["verify_email.zh-Hant"]);
  });

  it("names every template the configuration lacks", () => {
    const { "reset_password.en": _reset, ...partial } = all;
    expect(() =>
      parseEmailTemplateIds(
        JSON.stringify({ ...partial, "friend_request.zh-Hans": "7" }),
      ),
    ).toThrow(
      "TENCENT_SES_TEMPLATES lacks a template ID for reset_password.en, friend_request.zh-Hans.",
    );
    expect(() => parseEmailTemplateIds("[]")).toThrow("must be a JSON object");
    expect(() => parseEmailTemplateIds("{")).toThrow("not valid JSON");
  });
});

describe("TencentSesEmailSender", () => {
  const templates = parseEmailTemplateIds(
    JSON.stringify(
      Object.fromEntries(
        emailTemplateKeys.map((key, index) => [key, 1000 + index]),
      ),
    ),
  );
  const written = messagesFor("zh-Hans").codeEmail({
    productName: "LivTales",
    code: "482913",
    purpose: "verify_email",
    expiresInMinutes: 15,
  });
  const message = { to: "mei@example.test", ...written };

  function sender(reply: unknown) {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify(reply), {
          headers: { "content-type": "application/json" },
        }),
    );
    return {
      fetch,
      sender: new TencentSesEmailSender({
        credential: { secretId: "AKIDEXAMPLE", secretKey: "secret" },
        region: "ap-hongkong",
        from: "LivTales <noreply@mail.example.test>",
        templates,
        fetch,
        now: () => new Date("2026-09-26T08:00:00Z"),
      }),
    };
  }

  it("sends the email's template with its values as a triggered email", async () => {
    const { fetch, sender: ses } = sender({
      Response: { MessageId: "m-1", RequestId: "r-1" },
    });
    await ses.send(message);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://ses.tencentcloudapi.com");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-TC-Action"]).toBe("SendEmail");
    expect(headers["X-TC-Version"]).toBe("2020-10-02");
    expect(headers["X-TC-Region"]).toBe("ap-hongkong");
    expect(headers["X-TC-Timestamp"]).toBe("1790409600");
    expect(headers.Authorization).toMatch(
      /^TC3-HMAC-SHA256 Credential=AKIDEXAMPLE\/2026-09-26\/ses\/tc3_request, /,
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      FromEmailAddress: "LivTales <noreply@mail.example.test>",
      Destination: ["mei@example.test"],
      Subject: "LivTales：您的验证码是 482913",
      Template: {
        TemplateID: templates.get("verify_email.zh-Hans"),
        TemplateData: JSON.stringify({ code: "482913", minutes: "15" }),
      },
      TriggerType: 1,
    });
  });

  it("fails with the API's error code", async () => {
    const { sender: ses } = sender({
      Response: {
        Error: {
          Code: "FailedOperation.NotAuthenticatedSender",
          Message: "The sender is not verified.",
        },
        RequestId: "r-2",
      },
    });
    const sent = ses.send(message);
    await expect(sent).rejects.toBeInstanceOf(TencentCloudApiError);
    await expect(sent).rejects.toMatchObject({
      code: "FailedOperation.NotAuthenticatedSender",
      requestId: "r-2",
    });
  });

  it("refuses an email whose template is not configured", async () => {
    const ses = new TencentSesEmailSender({
      credential: { secretId: "AKIDEXAMPLE", secretKey: "secret" },
      region: "ap-hongkong",
      from: "LivTales <noreply@mail.example.test>",
      templates: new Map(),
      fetch: vi.fn(),
    });
    await expect(ses.send(message)).rejects.toThrow(
      "No Tencent SES template is configured for verify_email.zh-Hans.",
    );
  });
});
