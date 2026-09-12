"use client";

import { useRef, useState } from "react";
import { DraftNotice, ErrorNotice } from "../../components/feedback";
import { EditorSubmitButton } from "../../components/editor-form";

interface EditorControlsProps {
  readonly draft: {
    readonly hasNewerVersion: boolean;
    readonly loadLatest: () => void;
  };
  readonly mutation: {
    readonly isPending: boolean;
    readonly isError: boolean;
    readonly isSuccess: boolean;
    readonly error: unknown;
    readonly reset: () => void;
  };
  readonly onCancel?: (() => void) | undefined;
  readonly onRefresh?: (() => Promise<void>) | undefined;
  readonly submitLabel: string;
  readonly disabled?: boolean;
}

export function EditorControls({
  draft,
  mutation,
  onCancel,
  onRefresh,
  submitLabel,
  disabled = false,
}: EditorControlsProps) {
  const refreshing = useRef(false);
  const currentMutation = useRef(mutation);
  currentMutation.current = mutation;
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);

  async function refresh() {
    if (onRefresh === undefined || refreshing.current) return;
    refreshing.current = true;
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      await onRefresh();
      if (
        currentMutation.current.isError &&
        currentMutation.current.error === mutation.error
      ) {
        mutation.reset();
      }
    } catch (error) {
      setRefreshError(error);
    } finally {
      refreshing.current = false;
      setIsRefreshing(false);
    }
  }

  return (
    <>
      {mutation.isError ? (
        <>
          <ErrorNotice
            error={mutation.error}
            onRefresh={
              onRefresh === undefined ? undefined : () => void refresh()
            }
            refreshLabel="Refresh latest"
            isRefreshing={isRefreshing}
          />
          <p className="editor-help">
            Your draft is still here. Use {submitLabel} to submit it again.
            {onRefresh === undefined
              ? ""
              : " Refreshing only checks for updated data."}
          </p>
          {refreshError === null ? null : <ErrorNotice error={refreshError} />}
        </>
      ) : null}
      <div className="form-actions">
        {onCancel === undefined ? null : (
          <button
            className="button button-quiet"
            disabled={mutation.isPending}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        )}
        <EditorSubmitButton
          className="button button-primary"
          disabled={disabled || draft.hasNewerVersion || mutation.isPending}
        >
          {mutation.isPending ? "Saving..." : submitLabel}
        </EditorSubmitButton>
      </div>
      <p
        aria-label="Save status"
        className={mutation.isSuccess ? "editor-help" : "visually-hidden"}
        role="status"
      >
        {mutation.isPending
          ? "Saving changes..."
          : mutation.isSuccess
            ? "Saved successfully."
            : ""}
      </p>
      {draft.hasNewerVersion ? (
        <DraftNotice
          onLoadLatest={() => {
            draft.loadLatest();
            mutation.reset();
            setRefreshError(null);
          }}
        />
      ) : null}
    </>
  );
}
