"use client";

import type { ExpenseResponse } from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Chip, ChipPanel } from "../../components/chip";
import { Composer } from "../../components/composer";
import { DatePanel } from "../../components/date-panel";
import { ErrorNotice } from "../../components/feedback";
import { CalendarIcon, WalletIcon } from "../../components/icons";
import type { ComposerSlots } from "../../lib/composer-slots";
import {
  useKeepEditorDraft,
  useKeptEditorDraft,
} from "../../lib/editor-draft-context";
import {
  type ExpenseDraftSnapshot,
  eventCreationDraftKeys,
  isDraftConflictError,
} from "../../lib/editor-draft-store";
import {
  type ExpenseFields,
  expenseFieldsPayload,
  readExpenseFields,
} from "../../lib/expense-fields";
import { formatDateTime, fromDateTimeInput } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import {
  type ContextCreateAttempt,
  useCreateExpense,
  useUpdateExpense,
} from "../../lib/queries";
import { useComposerCare, useComposerChips } from "../../lib/use-composer-care";
import { useEditorDraft } from "../../lib/use-editor-draft";
import { ConflictNotice } from "./conflict-notice";

type ExpenseChip = "amount" | "paidOn";

const nameLimit = 240;

/** The time a day paid takes until one is typed: noon. */
const defaultTime = "12:00";

/**
 * The composer for an expense: the name, then Amount (with its currency)
 * and Paid on (the date panel with the time) as chips. With an expense it
 * edits that expense in place and saves one versioned update; without one
 * it adds expenses, Enter adding and keeping the composer open for the
 * next. Its fields are a draft in the tab. More hands the fields to the
 * full editor.
 */
export function ExpenseComposer({
  draftKey,
  eventId,
  expense: latest,
  now = new Date(),
  onMore,
  onRefresh,
  onSaved,
  sectionId,
  slotKey,
  slots,
}: {
  /** The key a new expense's draft is kept under, apart from the dialog's. */
  readonly draftKey?: string | undefined;
  readonly eventId: string;
  /** The expense being edited; absent for a new one. */
  readonly expense?: ExpenseResponse | undefined;
  /** Today, for tests. */
  readonly now?: Date;
  /** Opens the full editor with the composer's fields. */
  readonly onMore: (fields: ExpenseFields) => void;
  /** Reloads the list, so a stale save can be compared with the newest version. */
  readonly onRefresh: () => Promise<unknown>;
  /** A saved edit, for the list to announce. */
  readonly onSaved?: ((expense: ExpenseResponse) => void) | undefined;
  /**
   * The section a new expense starts in, null for none, when the list has
   * sections; absent where it has none, so the field is left out.
   */
  readonly sectionId?: string | null | undefined;
  readonly slotKey: string;
  readonly slots: ComposerSlots;
}) {
  const t = useTranslations("composer");
  const rows = useTranslations("rows");
  const form = useTranslations("expenseForm");
  const draftId =
    latest?.id ?? draftKey ?? eventCreationDraftKeys(eventId).expense;
  const kept = useKeptEditorDraft(draftId);
  const [initial] = useState<ExpenseDraftSnapshot | undefined>(() =>
    kept !== undefined && !kept.pending && kept.snapshot.kind === "expense"
      ? kept.snapshot
      : undefined,
  );
  // A fresh add starts in the row's section; the section is a field only
  // where the list has sections, as the dialog's is.
  const fresh = useCallback(
    (): ExpenseFields => ({
      ...readExpenseFields(),
      ...(sectionId === undefined ? {} : { section: sectionId ?? "" }),
    }),
    [sectionId],
  );
  const initialize = useCallback(
    (source: ExpenseResponse | undefined) =>
      source === undefined ? fresh() : readExpenseFields(source),
    [fresh],
  );
  const draft = useEditorDraft(latest, initialize, initial);
  const expense = draft.source;
  const adding = expense === undefined;
  const [attempt] = useState<ContextCreateAttempt>(
    () => initial?.creationAttempt ?? { current: null },
  );
  const snapshot = useMemo<ExpenseDraftSnapshot>(
    () => ({
      ...draft.snapshot,
      kind: "expense",
      ...(adding ? { creationAttempt: attempt } : {}),
    }),
    [adding, attempt, draft.snapshot],
  );
  const close = useCallback(() => slots.close(slotKey), [slotKey, slots]);
  const recovery = useKeepEditorDraft(
    draftId,
    snapshot,
    draft.isDirty,
    close,
    expense?.id ?? eventId,
  );
  const create = useCreateExpense(eventId, attempt);
  const update = useUpdateExpense();
  const mutation = adding ? create : update;
  const busy = mutation.isPending;
  const { fields } = draft;
  const [fieldError, setFieldError] = useState("");
  const [status, setStatus] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const chips = useComposerChips<ExpenseChip>();
  // The amount's field takes focus as its panel opens.
  useEffect(() => {
    if (chips.openChip === "amount") amountInput.current?.focus();
  }, [chips.openChip]);
  const { submitOnceRebased } = useComposerCare({
    hasNewerVersion: draft.hasNewerVersion,
    isDirty: draft.isDirty,
    nameInput,
    onRefresh,
    slotKey,
    slots,
    stale: update.isError && isDraftConflictError(update.error),
    staleError: update.error,
  });
  const discard = () => {
    recovery.discard();
    close();
  };

  function submit() {
    if (busy || draft.hasNewerVersion || !recovery.isRetained) return;
    // The amount lives in a chip's panel, which may be closed at submit,
    // so the form cannot check it; the panel opens on a refused one.
    if (
      !/^-?\d{1,15}(\.\d{1,4})?$/.test(fields.amount) ||
      !/^[A-Za-z]{3}$/.test(fields.currency)
    ) {
      setFieldError(t("amountNeeded"));
      chips.open("amount");
      return;
    }
    let input: ReturnType<typeof expenseFieldsPayload>;
    try {
      input = expenseFieldsPayload(fields, expense);
      setFieldError("");
    } catch (error) {
      setFieldError(error instanceof Error ? error.message : t("keys"));
      return;
    }
    if (expense === undefined) {
      void recovery.save(
        () => create.mutateAsync(input),
        () => {
          draft.change({ ...fresh(), occurredAt: fields.occurredAt });
          setStatus(t("added"));
          nameInput.current?.focus();
        },
      );
      return;
    }
    void recovery.save(
      () =>
        update.mutateAsync({
          id: expense.id,
          input: { ...input, expectedVersion: expense.version },
        }),
      (saved) => {
        draft.accept(saved);
        onSaved?.(saved);
        close();
      },
    );
  }

  const paid = fromDateTimeInput(fields.occurredAt);
  const comparing = !adding && draft.hasNewerVersion;
  const notice = comparing ? (
    <ConflictNotice
      draft={draft}
      objectId={expense.id}
      onKeepMine={() => {
        submitOnceRebased.current = true;
        update.reset();
        draft.rebase(draft.fields);
      }}
      onMerge={(merged) => {
        submitOnceRebased.current = true;
        update.reset();
        draft.rebase(merged);
      }}
      onTakeTheirs={() => {
        draft.loadLatest();
        update.reset();
      }}
    />
  ) : mutation.isError ? (
    <ErrorNotice error={mutation.error} />
  ) : null;
  const asked = slots.open === slotKey && slots.pending !== null;

  return (
    <Composer
      busy={busy}
      chips={
        <>
          <Chip
            buttonRef={chips.ref("amount")}
            clearLabel={t("clear", { field: t("amount") })}
            disabled={busy}
            icon={<WalletIcon className="chip-icon" />}
            label={t("amount")}
            onClear={() => draft.change({ amount: "" })}
            onPress={() => chips.toggle("amount")}
            open={chips.openChip === "amount"}
            value={
              fields.amount.trim() === ""
                ? ""
                : formatMoney(fields.amount, fields.currency)
            }
          >
            {chips.openChip === "amount" ? (
              <ChipPanel label={t("amount")} onClose={chips.close("amount")}>
                <div className="form-grid money-grid chip-money">
                  <label className="field">
                    <span>{form("amount")}</span>
                    <input
                      disabled={busy}
                      inputMode="decimal"
                      ref={amountInput}
                      onChange={(event) =>
                        draft.change({ amount: event.target.value })
                      }
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        chips.close("amount")(true);
                      }}
                      pattern="-?\d{1,15}(\.\d{1,4})?"
                      placeholder="0.00"
                      value={fields.amount}
                    />
                  </label>
                  <label className="field currency-field">
                    <span>{form("currency")}</span>
                    <input
                      disabled={busy}
                      maxLength={3}
                      minLength={3}
                      onChange={(event) =>
                        draft.change({
                          currency: event.target.value.toUpperCase(),
                        })
                      }
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        chips.close("amount")(true);
                      }}
                      pattern="[A-Za-z]{3}"
                      value={fields.currency}
                    />
                  </label>
                </div>
              </ChipPanel>
            ) : null}
          </Chip>
          <Chip
            buttonRef={chips.ref("paidOn")}
            clearLabel={t("clear", { field: t("paidOn") })}
            disabled={busy}
            icon={<CalendarIcon className="chip-icon" />}
            label={t("paidOn")}
            onClear={() => draft.change({ occurredAt: "" })}
            onPress={() => chips.toggle("paidOn")}
            open={chips.openChip === "paidOn"}
            value={paid === null ? "" : formatDateTime(paid)}
          >
            {chips.openChip === "paidOn" ? (
              <DatePanel
                disabled={busy}
                kind="day"
                label={t("paidOn")}
                now={now}
                onChange={(next) =>
                  draft.change({
                    occurredAt:
                      next.day === ""
                        ? ""
                        : `${next.day}T${next.time === "" ? defaultTime : next.time}`,
                  })
                }
                onClose={chips.close("paidOn")}
                timeOpen
                timeRequired
                value={{
                  day: fields.occurredAt.slice(0, 10),
                  time: fields.occurredAt.slice(11, 16),
                }}
              />
            ) : null}
          </Chip>
        </>
      }
      error={fieldError}
      label={
        adding ? t("newExpense") : rows("edit", { name: expense.displayName })
      }
      more={{
        label: t("moreRecordLabel"),
        onOpen: () => {
          const current = fields;
          discard();
          onMore(current);
        },
      }}
      name={{
        label: t("expenseName"),
        limit: nameLimit,
        onChange: (displayName) => {
          setStatus("");
          draft.change({ displayName });
        },
        placeholder: t("expenseName"),
        value: fields.displayName,
      }}
      nameRef={nameInput}
      notice={notice}
      onCancel={discard}
      onEscape={discard}
      onSubmit={submit}
      question={
        asked
          ? {
              text: t("unsaved"),
              onDiscard: () => {
                recovery.discard();
                slots.answer(slotKey, true);
              },
              onKeep: () => slots.answer(slotKey, false),
            }
          : undefined
      }
      status={status}
      submitDisabled={
        fields.displayName.trim() === "" ||
        draft.hasNewerVersion ||
        !recovery.isRetained
      }
      submitLabel={adding ? t("addExpense") : t("save")}
    />
  );
}
