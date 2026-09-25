import { z } from "zod";
import { maximumDocumentSizeBytes } from "@livtales/schemas";
import {
  LocalFilesystemStorageProvider,
  TencentCosStorageProvider,
  type StorageProvider,
} from "@livtales/storage";

const selectionSchema = z.object({
  DOCUMENT_STORAGE_PROVIDER: z
    .enum(["local-filesystem", "tencent-cos"])
    .default("local-filesystem"),
  LOCAL_STORAGE_ROOT: z.string().min(1).default(".livtales/storage"),
});
const cosSchema = z.object({
  COS_BUCKET: z.string().min(1),
  COS_REGION: z.string().min(1),
  COS_SECRET_ID: z.string().min(1),
  COS_SECRET_KEY: z.string().min(1),
  COS_SECURITY_TOKEN: z.string().min(1).optional(),
  COS_CREDENTIALS_EXPIRE_AT: z.iso
    .datetime()
    .transform((value) => new Date(value))
    .optional(),
  COS_KMS_KEY_ID: z.string().min(1).optional(),
});

export function createDocumentStorage(
  environment: NodeJS.ProcessEnv,
): StorageProvider {
  const selection = selectionSchema.parse(environment);
  if (selection.DOCUMENT_STORAGE_PROVIDER === "local-filesystem")
    return new LocalFilesystemStorageProvider({
      root: selection.LOCAL_STORAGE_ROOT,
    });
  const cos = cosSchema.parse(environment);
  return new TencentCosStorageProvider({
    bucket: cos.COS_BUCKET,
    region: cos.COS_REGION,
    secretId: cos.COS_SECRET_ID,
    secretKey: cos.COS_SECRET_KEY,
    securityToken: cos.COS_SECURITY_TOKEN,
    credentialsExpireAt: cos.COS_CREDENTIALS_EXPIRE_AT,
    kmsKeyId: cos.COS_KMS_KEY_ID,
    maximumObjectSizeBytes: maximumDocumentSizeBytes,
  });
}
