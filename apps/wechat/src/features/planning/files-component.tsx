import { ApiClientError, TransportError } from "@livtales/api-client";
import { Button, Picker, Text, View } from "@tarojs/components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { NativeFiles } from "../../files/native-files";
import { createRuntimeFilePlatform } from "../../files/runtime-platform";
import { getMessages, type AppLocale } from "../../i18n/catalog";
import { useReadyAppRuntime } from "../../runtime/app-runtime";

function isPickerCancelled(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "errMsg" in error &&
    typeof error.errMsg === "string" &&
    error.errMsg.toLowerCase().includes("cancel")
  );
}

export function FilesComponent({
  canEdit,
  eventId,
  locale,
  workspaceId,
}: {
  readonly canEdit: boolean;
  readonly eventId: string;
  readonly locale: AppLocale;
  readonly workspaceId: string;
}) {
  const runtime = useReadyAppRuntime();
  const files = useMemo(
    () =>
      new NativeFiles(
        runtime.api,
        runtime.apiBaseUrl,
        runtime.sessions.getCredential,
        createRuntimeFilePlatform(),
      ),
    [runtime],
  );
  const queryClient = useQueryClient();
  const messages = getMessages(locale);
  const [parentId, setParentId] = useState(eventId);
  const [busy, setBusy] = useState<"upload" | "open" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      operation.current?.abort();
      void files.cleanup();
    };
  }, [files]);

  const targets = useQuery({
    queryKey: ["wechat-file-targets", workspaceId, eventId],
    queryFn: () => runtime.api.getEventAttachmentTargets(eventId),
    retry: 1,
  });
  const choices = targets.data
    ? [targets.data.event, ...targets.data.tasks, ...targets.data.expenses]
    : [{ id: eventId, displayName: messages.eventOverview }];
  const selectedIndex = Math.max(
    0,
    choices.findIndex((item) => item.id === parentId),
  );
  const selectedParentId = choices[selectedIndex]?.id ?? eventId;
  const attachments = useQuery({
    queryKey: ["wechat-file-attachments", workspaceId, selectedParentId],
    queryFn: () => runtime.api.listDocumentAttachments(selectedParentId),
    retry: 1,
  });

  async function start(
    kind: "upload" | "open",
    run: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    if (operation.current !== null) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(kind);
    setError(null);
    try {
      await run(controller.signal);
    } catch (reason) {
      if (
        !controller.signal.aborted &&
        !(reason instanceof TransportError && reason.kind === "aborted") &&
        !isPickerCancelled(reason)
      ) {
        setError(
          reason instanceof ApiClientError &&
            reason.code === "payload_too_large"
            ? messages.fileTooLarge
            : kind === "upload"
              ? messages.fileUploadFailed
              : messages.fileOpenFailed,
        );
      }
    } finally {
      if (operation.current === controller) operation.current = null;
      setBusy(null);
    }
  }

  function attach(): void {
    void start("upload", async (signal) => {
      const file = await files.choose();
      await files.attach(selectedParentId, file, signal);
      await queryClient.invalidateQueries({
        queryKey: ["wechat-file-attachments", workspaceId, selectedParentId],
      });
    });
  }

  function open(documentId: string, filename: string): void {
    void start("open", (signal) => files.open(documentId, filename, signal));
  }

  return (
    <View className="files-component">
      {targets.isError ? (
        <Button className="text-button" onClick={() => void targets.refetch()}>
          {messages.retry}
        </Button>
      ) : null}
      {choices.length > 1 ? (
        <Picker
          mode="selector"
          onChange={(event) => {
            operation.current?.abort();
            setParentId(choices[Number(event.detail.value)]?.id ?? eventId);
            setError(null);
          }}
          range={choices.map((choice) => choice.displayName)}
          value={selectedIndex}
        >
          <View className="files-target">
            {messages.attachTo}: {choices[selectedIndex]?.displayName}
          </View>
        </Picker>
      ) : null}
      {attachments.isPending ? (
        <Text className="projection-empty">{messages.loading}</Text>
      ) : attachments.isError ? (
        <View className="projection-error">
          <Text>{messages.fileListFailed}</Text>
          <Button
            className="text-button"
            onClick={() => void attachments.refetch()}
          >
            {messages.retry}
          </Button>
        </View>
      ) : (
        <>
          {attachments.data?.items.length === 0 ? (
            <Text className="projection-empty">{messages.noItems}</Text>
          ) : null}
          {attachments.data?.items.map(({ document }) => (
            <Button
              className="projection-row-button"
              disabled={busy !== null}
              key={document.id}
              onClick={() => open(document.id, document.originalFilename)}
            >
              <View className="projection-row">
                <Text className="projection-row__title">
                  {document.originalFilename}
                </Text>
                <Text className="projection-row__detail">
                  {Math.ceil(Number(document.sizeBytes) / 1024)} KB
                </Text>
              </View>
            </Button>
          ))}
          {attachments.data?.lockedAttachmentCount ? (
            <Text className="projection-empty">
              {messages.lockedFiles.replace(
                "{count}",
                String(attachments.data.lockedAttachmentCount),
              )}
            </Text>
          ) : null}
        </>
      )}
      {error ? <Text className="files-error">{error}</Text> : null}
      {busy ? (
        <Button
          className="text-button"
          onClick={() => operation.current?.abort()}
        >
          {messages.cancel}{" "}
          {busy === "upload" ? messages.fileUploading : messages.fileOpening}
        </Button>
      ) : canEdit ? (
        <Button className="text-button" onClick={attach}>
          {messages.addFile}
        </Button>
      ) : null}
    </View>
  );
}
