"use client";

import { DraftNotice, ErrorNotice } from "../../components/feedback";

interface EditorControlsProps {
  readonly draft: {
    readonly hasNewerVersion: boolean;
    readonly loadLatest: () => void;
  };
  readonly mutation: {
    readonly isPending: boolean;
    readonly isError: boolean;
    readonly error: unknown;
    readonly reset: () => void;
  };
  readonly onCancel?: (() => void) | undefined;
  readonly onRefresh?: (() => Promise<void>) | undefined;
  readonly submitLabel: string;
}

export function EditorControls({
  draft,
  mutation,
  onCancel,
  onRefresh,
  submitLabel,
}: EditorControlsProps) {
  return (
    <>
      {mutation.isError ? (
        <ErrorNotice
          error={mutation.error}
          onRefresh={
            onRefresh === undefined
              ? undefined
              : () => {
                  void onRefresh().then(() => mutation.reset());
                }
          }
        />
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
        <button
          className="button button-primary"
          disabled={draft.hasNewerVersion || mutation.isPending}
          type="submit"
        >
          {mutation.isPending ? "Saving..." : submitLabel}
        </button>
      </div>
      {draft.hasNewerVersion ? (
        <DraftNotice
          onLoadLatest={() => {
            draft.loadLatest();
            mutation.reset();
          }}
        />
      ) : null}
    </>
  );
}
