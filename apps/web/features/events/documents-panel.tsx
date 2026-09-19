"use client";

import {
  type EventResponse,
  type ExpenseResponse,
  maximumDocumentSizeBytes,
  type TaskResponse,
} from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  EmptyState,
  ErrorNotice,
  LoadingState,
} from "../../components/feedback";
import { HeadMenu } from "../../components/head-menu";
import { IconButton } from "../../components/icon-button";
import {
  DownloadIcon,
  LinkIcon,
  LockIcon,
  PaperclipIcon,
} from "../../components/icons";
import { RowMenu, type RowMenuEntry } from "../../components/row-menu";
import { formatBytes, formatDatePart } from "../../lib/format";
import {
  useAttachDocument,
  useDocumentAttachments,
  useDownloadDocument,
} from "../../lib/queries";
import { useOpenHistory } from "../history/history-provider";
import { useOpenLifecycle } from "../recovery/lifecycle-provider";
import { PanelHeading, RowActions } from "./component-frame";

interface AttachmentTarget {
  readonly id: string;
  readonly label: string;
}

function saveDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function DocumentsPanel({
  canEdit,
  event,
  expenses,
  tasks,
}: {
  readonly canEdit: boolean;
  readonly event: EventResponse;
  readonly expenses: readonly ExpenseResponse[];
  readonly tasks: readonly TaskResponse[];
}) {
  const t = useTranslations("files");
  const targets = useMemo<readonly AttachmentTarget[]>(
    () => [
      { id: event.id, label: t("eventTarget", { name: event.displayName }) },
      ...tasks.map((task) => ({
        id: task.id,
        label: t("taskTarget", { name: task.displayName }),
      })),
      ...expenses.map((expense) => ({
        id: expense.id,
        label: t("expenseTarget", { name: expense.displayName }),
      })),
    ],
    [event.displayName, event.id, expenses, t, tasks],
  );
  const [parentObjectId, setParentObjectId] = useState(event.id);
  const [uploading, setUploading] = useState<string | null>(null);
  const [refused, setRefused] = useState<Error | null>(null);
  const [fileInputVersion, setFileInputVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachments = useDocumentAttachments(parentObjectId);
  const attach = useAttachDocument(parentObjectId);
  const download = useDownloadDocument();
  const openHistory = useOpenHistory();
  const openLifecycle = useOpenLifecycle();

  useEffect(() => {
    if (!targets.some((target) => target.id === parentObjectId)) {
      setParentObjectId(event.id);
    }
  }, [event.id, parentObjectId, targets]);

  // A chosen file goes up at once; the input is rebuilt afterwards so the
  // same file can be chosen again.
  function attachFile(file: File | undefined): void {
    if (file === undefined) return;
    if (file.size > maximumDocumentSizeBytes) {
      setRefused(new Error(t("tooLarge", { name: file.name })));
      setFileInputVersion((version) => version + 1);
      return;
    }
    setRefused(null);
    setUploading(file.name);
    attach.mutate(file, {
      onSettled: () => {
        setUploading(null);
        setFileInputVersion((version) => version + 1);
      },
    });
  }

  const target = targets.find((choice) => choice.id === parentObjectId);
  const attachError = refused ?? attach.error;
  const firstError = attachError ?? download.error;
  const isUploading = attach.isPending;
  const items = attachments.data?.items ?? [];

  return (
    <section className="planning-panel panel-column documents-panel">
      <PanelHeading
        controls={
          <HeadMenu
            busy={isUploading}
            entries={targets.map((choice) => ({
              kind: "radio",
              label: choice.label,
              checked: choice.id === parentObjectId,
              onSelect: () => setParentObjectId(choice.id),
            }))}
            icon={<LinkIcon />}
            label={t("attachedTo")}
            name={target?.label}
          />
        }
        count={
          attachments.data === undefined ? undefined : String(items.length)
        }
        title={t("title")}
      />

      {firstError === null ? null : (
        <>
          <ErrorNotice
            error={firstError}
            onRefresh={() => {
              setRefused(null);
              attach.reset();
              download.reset();
            }}
            refreshLabel={t("dismiss")}
          />
          {attachError === null ? null : (
            <p className="attachment-note">{t("note")}</p>
          )}
        </>
      )}
      {attachments.isPending ? (
        <LoadingState label={t("loading")} />
      ) : attachments.isError ? (
        <ErrorNotice
          error={attachments.error}
          onRefresh={() => void attachments.refetch()}
        />
      ) : attachments.data === undefined ? null : (
        <>
          {attachments.data.lockedAttachmentCount > 0 ? (
            <div className="locked-reference surface-subtle">
              <LockIcon />
              <div>
                <strong>{t("privateTitle")}</strong>
                <p>
                  {t("privateNote", {
                    count: attachments.data.lockedAttachmentCount,
                  })}
                </p>
              </div>
            </div>
          ) : null}
          {items.length === 0 && !canEdit ? (
            <EmptyState title={t("none")} />
          ) : null}
          <div className="attachment-list">
            {items.map((attachment) => {
              const file = attachment.document;
              const isDownloading =
                download.isPending && download.variables === file.id;
              const save = () =>
                download.mutate(file.id, {
                  onSuccess: (blob) =>
                    saveDownload(blob, file.originalFilename),
                });
              const entries: RowMenuEntry[] = [
                { kind: "action", label: t("download"), onSelect: save },
                {
                  kind: "action",
                  label: t("history"),
                  onSelect: () =>
                    openHistory({
                      objectId: file.id,
                      displayName: file.originalFilename,
                    }),
                },
                ...(canEdit
                  ? ([
                      { kind: "rule" },
                      {
                        kind: "action",
                        label: t("moveToTrash"),
                        danger: true,
                        onSelect: () =>
                          openLifecycle({
                            ...file,
                            relation: {
                              id: attachment.relationId,
                              version: attachment.relationVersion,
                            },
                          }),
                      },
                    ] as const)
                  : []),
              ];
              return (
                <article className="attachment-row" key={attachment.relationId}>
                  <span className="attachment-file-icon">
                    <PaperclipIcon />
                  </span>
                  <div className="attachment-copy">
                    <strong>{file.originalFilename}</strong>
                    <span>
                      {formatBytes(Number(file.sizeBytes))} -{" "}
                      {formatDatePart(file.createdAt, "month")}{" "}
                      {formatDatePart(file.createdAt, "day")}
                    </span>
                  </div>
                  <RowActions>
                    <IconButton
                      disabled={download.isPending}
                      label={
                        isDownloading
                          ? t("preparing", { name: file.originalFilename })
                          : t("downloadNamed", { name: file.originalFilename })
                      }
                      onClick={save}
                    >
                      <DownloadIcon />
                    </IconButton>
                    <RowMenu
                      entries={entries}
                      label={t("actionsFor", { name: file.originalFilename })}
                    />
                  </RowActions>
                </article>
              );
            })}
            {canEdit ? (
              <div className="attachment-add">
                <button
                  className="quick-add"
                  disabled={isUploading}
                  onClick={() => fileInput.current?.click()}
                  type="button"
                >
                  <PaperclipIcon />
                  <span>
                    {uploading === null
                      ? t("attach")
                      : t("uploading", { name: uploading })}
                  </span>
                </button>
                <input
                  aria-label={t("choose")}
                  className="visually-hidden"
                  disabled={isUploading}
                  key={fileInputVersion}
                  onChange={(input) => attachFile(input.target.files?.[0])}
                  ref={fileInput}
                  tabIndex={-1}
                  type="file"
                />
                {isUploading ? (
                  <progress
                    aria-label={t("uploadingLabel")}
                    className="upload-progress"
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
