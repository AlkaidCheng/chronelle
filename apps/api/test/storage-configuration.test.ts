import { describe, expect, it } from "vitest";
import { createDocumentStorage } from "../src/documents/storage-configuration.js";

const cos = {
  DOCUMENT_STORAGE_PROVIDER: "tencent-cos",
  COS_BUCKET: "chronelle-test-1250000000",
  COS_REGION: "ap-guangzhou",
  COS_SECRET_ID: "test-secret-id",
  COS_SECRET_KEY: "test-secret-key",
};

describe("document storage configuration", () => {
  it("keeps filesystem storage as the default", () => {
    expect(createDocumentStorage({}).providerId).toBe("local-filesystem");
    expect(
      createDocumentStorage({
        ...cos,
        DOCUMENT_STORAGE_PROVIDER: "local-filesystem",
      }).providerId,
    ).toBe("local-filesystem");
  });
  it("selects COS without initializing network requests", () => {
    expect(createDocumentStorage(cos)).toMatchObject({
      providerId: "tencent-cos",
      encryptionMode: "cos-sse-aes256",
    });
    expect(
      createDocumentStorage({ ...cos, COS_KMS_KEY_ID: "test-kms-key" })
        .encryptionMode,
    ).toBe("cos-sse-kms");
  });
  it.each(["COS_BUCKET", "COS_REGION", "COS_SECRET_ID", "COS_SECRET_KEY"])(
    "requires %s when COS is selected",
    (key) => {
      expect(() =>
        createDocumentStorage({ ...cos, [key]: undefined }),
      ).toThrow();
    },
  );
  it("rejects unknown providers and incomplete temporary credentials", () => {
    expect(() =>
      createDocumentStorage({ DOCUMENT_STORAGE_PROVIDER: "unknown" }),
    ).toThrow();
    expect(() =>
      createDocumentStorage({ ...cos, COS_SECURITY_TOKEN: "test-token" }),
    ).toThrow("configuration");
    expect(() =>
      createDocumentStorage({ ...cos, COS_CREDENTIALS_EXPIRE_AT: "invalid" }),
    ).toThrow();
  });
});
