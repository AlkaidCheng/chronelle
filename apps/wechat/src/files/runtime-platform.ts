import { ApiClientError } from "@livtales/api-client";
import Taro from "@tarojs/taro";

import type { NativeFilePlatform, NativeTask } from "./native-files";

const documentExtensions = [
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "pdf",
] as const;

export function createRuntimeFilePlatform(): NativeFilePlatform {
  const files = Taro.getFileSystemManager();
  return {
    async choose() {
      const result = await Taro.chooseMessageFile({ count: 1, type: "all" });
      const file = result.tempFiles[0];
      if (file === undefined) {
        throw new ApiClientError(0, "no_file", "No file was selected.");
      }
      return { name: file.name, path: file.path, size: file.size };
    },
    read: (path) =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        files.readFile({
          filePath: path,
          success: (result) => {
            if (result.data instanceof ArrayBuffer) resolve(result.data);
            else reject(new TypeError("The selected file is not binary."));
          },
          fail: reject,
        });
      }),
    upload: ({ filePath, headers, url }) =>
      Taro.uploadFile({
        filePath,
        header: headers,
        name: "file",
        timeout: 120_000,
        url,
      }) as NativeTask<{ readonly statusCode: number }>,
    download: ({ headers, url }) =>
      Taro.downloadFile({
        header: headers,
        timeout: 120_000,
        url,
      }) as NativeTask<{
        readonly statusCode: number;
        readonly tempFilePath: string;
      }>,
    async open(path, filename) {
      const extension = filename.split(".").at(-1)?.toLowerCase();
      if (documentExtensions.some((value) => value === extension)) {
        await Taro.openDocument({
          filePath: path,
          fileType: extension as (typeof documentExtensions)[number],
          showMenu: false,
        });
      } else if (
        ["jpg", "jpeg", "png", "gif", "webp"].includes(extension ?? "")
      ) {
        await Taro.previewImage({ urls: [path], showmenu: false });
      } else {
        throw new ApiClientError(
          415,
          "unsupported_file_type",
          "This file type cannot be opened in WeChat.",
        );
      }
    },
    remove: (path) =>
      new Promise<void>((resolve, reject) => {
        files.unlink({
          filePath: path,
          success: () => resolve(),
          fail: reject,
        });
      }),
  };
}
