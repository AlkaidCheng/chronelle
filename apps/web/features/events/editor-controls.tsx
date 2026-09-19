"use client";

import { ApiClientError } from "@chronelle/api-client";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ErrorNotice } from "../../components/feedback";
import { EditorSubmitButton } from "../../components/editor-form";
import { useCanonicalInvalidation } from "../../lib/queries";
import { ConflictNotice, type FieldFormatter } from "./conflict-notice";

interface EditorControlsProps<
  Fields extends Record<string, string | undefined>,
> {
  readonly draft: {
    readonly fields: Fields;
    readonly baseline: Fields;
    readonly theirs: Fields | undefined;
    readonly hasNewerVersion: boolean;
    readonly loadLatest: () => void;
    readonly rebase: (fields: Fields) => void;
  };
  readonly mutation: {
    readonly isPending: boolean;
    readonly isError: boolean;
    readonly isSuccess: boolean;
    readonly error: unknown;
    readonly reset: () => void;
  };
  /**
   * The record behind the draft, for the comparison a stale write shows;
   * absent while creating, when no other version can exist.
   */
  readonly conflict?: EditorConflict | undefined;
  readonly onCancel?: (() => void) | undefined;
  readonly onRefresh?: (() => Promise<void>) | undefined;
  readonly submitLabel: string;
  readonly disabled?: boolean;
}

const isStaleWrite = (error: unknown) =>
  error instanceof ApiClientError && error.code === "version_conflict";

/** The record behind a draft, and where its form shows the comparison. */
export interface EditorConflict {
  readonly objectId: string;
  readonly format?: FieldFormatter | undefined;
  /** The element at the top of the fields that takes the comparison; the footer takes it without one. */
  readonly slot?: HTMLElement | null | undefined;
}

/**
 * The place a form gives a stale write's comparison, at the top of its
 * fields: render the element with `ref`, pass `slot` in the conflict. A
 * callback ref, so the comparison can portal there from the first render
 * after the element mounts.
 */
export function useConflictSlot() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return { slot, ref: setSlot };
}

export function EditorControls<
  Fields extends Record<string, string | undefined>,
>({
  draft,
  mutation,
  conflict,
  onCancel,
  onRefresh,
  submitLabel,
  disabled = false,
}: EditorControlsProps<Fields>) {
  const refreshing = useRef(false);
  const invalidate = useCanonicalInvalidation();
  const currentMutation = useRef(mutation);
  currentMutation.current = mutation;
  const t = useTranslations("editor");
  const common = useTranslations("common");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const actions = useRef<HTMLDivElement>(null);
  const submitOnceRebased = useRef(false);

  const resetWhenDone = useRef(false);

  /**
   * Reads the newest version. A person's own Refresh clears the refusal
   * once it lands; the read a stale save starts by itself leaves the
   * refusal standing unless a newer version arrives and is compared.
   */
  async function refresh(resetError: boolean) {
    if (onRefresh === undefined) return;
    if (resetError) resetWhenDone.current = true;
    if (refreshing.current) return;
    refreshing.current = true;
    setIsRefreshing(true);
    setRefreshError(null);
    const failed = mutation.error;
    try {
      await onRefresh();
      // Whatever lists stand behind the editor learn of the newer version too.
      void invalidate();
      if (
        resetWhenDone.current &&
        currentMutation.current.isError &&
        currentMutation.current.error === failed
      ) {
        mutation.reset();
      }
    } catch (error) {
      setRefreshError(error);
    } finally {
      resetWhenDone.current = false;
      refreshing.current = false;
      setIsRefreshing(false);
    }
  }

  // A save refused as stale fetches the newest version at once, so the
  // comparison appears in place of the refusal.
  const staleError = mutation.isError && isStaleWrite(mutation.error);
  const latestRefresh = useRef(refresh);
  latestRefresh.current = refresh;
  const refreshedFor = useRef<unknown>(null);
  useEffect(() => {
    if (!staleError || refreshedFor.current === mutation.error) return;
    refreshedFor.current = mutation.error;
    void latestRefresh.current(false);
  }, [staleError, mutation.error]);

  // Keep mine and Save merged version pin the draft to the newest version,
  // then submit the form as the person would.
  useEffect(() => {
    if (!submitOnceRebased.current || draft.hasNewerVersion) return;
    submitOnceRebased.current = false;
    actions.current?.closest("form")?.requestSubmit();
  }, [draft.hasNewerVersion]);

  const comparing = draft.hasNewerVersion && conflict !== undefined;
  const comparison = comparing ? (
    <ConflictNotice
      draft={draft}
      format={conflict.format}
      objectId={conflict.objectId}
      onKeepMine={() => {
        submitOnceRebased.current = true;
        mutation.reset();
        draft.rebase(draft.fields);
      }}
      onMerge={(fields) => {
        submitOnceRebased.current = true;
        mutation.reset();
        draft.rebase(fields);
      }}
      onTakeTheirs={() => {
        draft.loadLatest();
        mutation.reset();
        setRefreshError(null);
      }}
    />
  ) : null;

  return (
    <>
      {conflict?.slot ? createPortal(comparison, conflict.slot) : comparison}
      {mutation.isError && !comparing ? (
        <>
          <ErrorNotice
            error={mutation.error}
            onRefresh={
              onRefresh === undefined ? undefined : () => void refresh(true)
            }
            refreshLabel={t("refreshLatest")}
            isRefreshing={isRefreshing}
          />
          <p className="editor-help">
            {t("draftKept", { submit: submitLabel })}
            {onRefresh === undefined ? "" : ` ${t("refreshOnlyChecks")}`}
          </p>
          {refreshError === null ? null : <ErrorNotice error={refreshError} />}
        </>
      ) : null}
      <div className="form-actions" ref={actions}>
        {onCancel === undefined ? null : (
          <button
            className="button button-quiet"
            disabled={mutation.isPending}
            onClick={onCancel}
            type="button"
          >
            {common("cancel")}
          </button>
        )}
        <EditorSubmitButton
          className="button button-primary"
          disabled={disabled || draft.hasNewerVersion || mutation.isPending}
        >
          {mutation.isPending ? t("saving") : submitLabel}
        </EditorSubmitButton>
      </div>
      <p
        aria-label={t("saveStatus")}
        className={mutation.isSuccess ? "editor-help" : "visually-hidden"}
        role="status"
      >
        {mutation.isPending
          ? t("savingChanges")
          : mutation.isSuccess
            ? t("saved")
            : ""}
      </p>
    </>
  );
}
