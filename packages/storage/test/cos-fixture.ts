import COS from "cos-nodejs-sdk-v5";
import { vi } from "vitest";
import {
  TencentCosStorageProvider,
  type TencentCosStorageOptions,
} from "../src/index.js";

export const cosOptions: TencentCosStorageOptions = {
  bucket: "livtales-test-1250000000",
  region: "ap-guangzhou",
  secretId: "test-secret-id",
  secretKey: "test-secret-key",
  maximumObjectSizeBytes: 1024,
};

export function createCosFixture(
  options: Partial<TencentCosStorageOptions> = {},
) {
  const configuration = { ...cosOptions, ...options };
  const client = new COS({
    SecretId: configuration.secretId,
    SecretKey: configuration.secretKey,
    ...(configuration.securityToken === undefined
      ? {}
      : { SecurityToken: configuration.securityToken }),
  });
  const versioning = vi.spyOn(client, "getBucketVersioning").mockResolvedValue({
    statusCode: 200,
    headers: {},
    VersioningConfiguration: {},
  } as COS.GetBucketVersioningResult);
  const acl = vi.spyOn(client, "getBucketAcl").mockResolvedValue({
    statusCode: 200,
    headers: {},
    ACL: "private",
    Owner: { ID: "owner" },
    Grants: [{ Grantee: { ID: "owner" }, Permission: "FULL_CONTROL" }],
  } as COS.GetBucketAclResult);
  const content = new Map<string, Uint8Array>();
  const transport = vi.fn<typeof fetch>(async (url) => {
    const bytes = content.get(
      decodeURIComponent(new URL(String(url)).pathname).slice(1),
    );
    return bytes === undefined
      ? new Response(null, { status: 404 })
      : new Response(new Uint8Array(bytes).buffer, {
          status: 200,
          headers: {
            "x-cos-server-side-encryption":
              configuration.kmsKeyId === undefined ? "AES256" : "cos/kms",
          },
        });
  });
  return {
    provider: new TencentCosStorageProvider(configuration, {
      client,
      fetch: transport,
    }),
    client,
    versioning,
    acl,
    transport,
    content,
  };
}
