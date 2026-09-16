"use client";

import type {
  EventResponse,
  ExpenseResponse,
  TaskResponse,
} from "@chronelle/schemas";
import { type FormEvent, useEffect, useId, useMemo, useState } from "react";

import {
  EmptyState,
  ErrorNotice,
  LoadingState,
} from "../../components/feedback";
import { DownloadIcon, LockIcon, PaperclipIcon } from "../../components/icons";
import { formatBytes, shortId } from "../../lib/format";
import { HistoryButton } from "../history/history-button";
import { LifecycleButton } from "../recovery/lifecycle-provider";
import { PanelHeading, RowActions } from "./component-frame";
import {
  useAttachDocument,
  useDocumentAttachments,
  useDownloadDocument,
} from "../../lib/queries";

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
  const targets = useMemo<readonly AttachmentTarget[]>(
    () => [
      { id: event.id, label: `Event: ${event.displayName}` },
      ...tasks.map((task) => ({
        id: task.id,
        label: `Task: ${task.displayName}`,
      })),
      ...expenses.map((expense) => ({
        id: expense.id,
        label: `Expense: ${expense.displayName}`,
      })),
    ],
    [event.displayName, event.id, expenses, tasks],
  );
  const [parentObjectId, setParentObjectId] = useState(event.id);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInputVersion, setFileInputVersion] = useState(0);
  const targetInputId = useId();
  const fileInputId = useId();
  const attachments = useDocumentAttachments(parentObjectId);
  const attach = useAttachDocument(parentObjectId);
  const download = useDownloadDocument();

  useEffect(() => {
    if (!targets.some((target) => target.id === parentObjectId)) {
      setParentObjectId(event.id);
    }
  }, [event.id, parentObjectId, targets]);

  function handleUpload(formEvent: FormEvent<HTMLFormElement>): void {
    formEvent.preventDefault();
    if (selectedFile === null) {
      return;
    }
    attach.mutate(selectedFile, {
      onSuccess: () => {
        setSelectedFile(null);
        setFileInputVersion((version) => version + 1);
      },
    });
  }

  const firstError = attach.error ?? download.error;
  const isUploading = attach.isPending;

  return (
    <section className="planning-panel documents-panel">
      <PanelHeading
        description="Private attachments stay connected to one canonical Event, Task, or Expense."
        title="Files"
      />

      <label className="field attachment-target" htmlFor={targetInputId}>
        <span>Show files attached to</span>
        <select
          disabled={isUploading}
          id={targetInputId}
          onChange={(input) => setParentObjectId(input.target.value)}
          value={parentObjectId}
        >
          {targets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.label}
            </option>
          ))}
        </select>
      </label>

      {canEdit ? (
        <form
          className="attachment-upload surface-subtle"
          onSubmit={handleUpload}
        >
          <label className="field" htmlFor={fileInputId}>
            <span>Choose a private file</span>
            <input
              disabled={isUploading}
              id={fileInputId}
              key={fileInputVersion}
              onChange={(input) =>
                setSelectedFile(input.target.files?.[0] ?? null)
              }
              required
              type="file"
            />
          </label>
          <div className="attachment-upload-actions">
            <span>
              Maximum 25 MB. Filename, type, size, and checksum are verified.
            </span>
            <button
              className="button button-primary"
              disabled={isUploading || selectedFile === null}
              type="submit"
            >
              {isUploading ? "Uploading..." : "Attach file"}
            </button>
          </div>
          {isUploading ? (
            <progress
              aria-label="Uploading attachment"
              className="upload-progress"
            />
          ) : null}
        </form>
      ) : (
        <div className="locked-reference surface-subtle">
          <LockIcon />
          <div>
            <strong>Read-only files</strong>
            <p>You can download attachments shared through this Event.</p>
          </div>
        </div>
      )}

      {firstError === null ? null : (
        <ErrorNotice
          error={firstError}
          onRefresh={() => {
            attach.reset();
            download.reset();
          }}
          refreshLabel="Dismiss"
        />
      )}
      {attachments.isPending ? (
        <LoadingState label="Loading private files" />
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
                <strong>Private attachments</strong>
                <p>
                  {attachments.data.lockedAttachmentCount} attachment
                  {attachments.data.lockedAttachmentCount === 1
                    ? " is"
                    : "s are"}{" "}
                  outside your permission scope.
                </p>
              </div>
            </div>
          ) : null}
          {attachments.data.items.length === 0 ? (
            <EmptyState
              description={
                canEdit
                  ? "Choose a file above to attach it without exposing a public URL."
                  : "Shared files will appear here when available. This event is read-only."
              }
              title="No files attached"
            />
          ) : (
            <div className="attachment-list">
              {attachments.data.items.map((attachment) => {
                const file = attachment.document;
                const isDownloading =
                  download.isPending && download.variables === file.id;
                return (
                  <article
                    className="attachment-row"
                    key={attachment.relationId}
                  >
                    <span className="attachment-file-icon">
                      <PaperclipIcon />
                    </span>
                    <div className="attachment-copy">
                      <strong>{file.originalFilename}</strong>
                      <span>
                        {file.mimeType} / {formatBytes(Number(file.sizeBytes))}{" "}
                        / ID {shortId(file.id)}
                      </span>
                      <code title={file.checksumSha256}>
                        SHA-256 {file.checksumSha256.slice(0, 12)}...
                      </code>
                    </div>
                    <RowActions>
                      <button
                        className="button button-secondary button-small"
                        disabled={download.isPending}
                        onClick={() =>
                          download.mutate(file.id, {
                            onSuccess: (blob) =>
                              saveDownload(blob, file.originalFilename),
                          })
                        }
                        type="button"
                      >
                        <DownloadIcon />
                        {isDownloading ? "Preparing..." : "Download"}
                      </button>
                      <HistoryButton
                        objectId={file.id}
                        displayName={file.originalFilename}
                      />
                      {canEdit ? (
                        <LifecycleButton
                          target={{
                            ...file,
                            relation: {
                              id: attachment.relationId,
                              version: attachment.relationVersion,
                            },
                          }}
                        />
                      ) : null}
                    </RowActions>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
