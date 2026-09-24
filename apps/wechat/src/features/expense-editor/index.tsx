import { ApiClientError } from "@chronelle/api-client";
import type { ExpenseResponse, SessionResponse } from "@chronelle/schemas";
import { Button, Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { useEffect, useMemo, useRef, useState } from "react";

import { useSession } from "../../auth/session-context";
import { EditorStateCard } from "../../components/editor";
import { deviceTimeZone } from "../../events/wall-clock";
import type { ExpenseDraftSnapshot } from "../../expenses/draft-store";
import { canEditExpense } from "../../expenses/data";
import {
  emptyExpenseFields,
  expenseCreatePayload,
  expenseUpdatePayload,
  ExpenseEditorValidationError,
  fieldsFromExpense,
  sameExpenseFields,
  type ExpenseEditorFields,
  type ExpenseEditorIssue,
} from "../../expenses/editor";
import {
  useCreateEventExpense,
  useExpenseAccess,
  useUpdateEventExpense,
} from "../../expenses/queries";
import { formatInstant } from "../../events/format";
import {
  getMessages,
  resolveLocale,
  type MessageKey,
} from "../../i18n/catalog";
import { useReadyAppRuntime } from "../../runtime/app-runtime";
import { useEditorDraftPersistence } from "../../runtime/use-editor-draft";
import { useNavigationTitle } from "../../shell/use-navigation-title";
import { usePlanningProjection } from "../planning/queries";
import { ExpenseEditorFieldsForm } from "./editor-fields";
import "../../styles/editor.scss";

const issueKeys: Record<ExpenseEditorIssue, MessageKey> = {
  "name-required": "validationExpenseNameRequired",
  "name-too-long": "validationExpenseNameTooLong",
  "amount-invalid": "validationExpenseAmount",
  "currency-invalid": "validationExpenseCurrency",
  "date-invalid": "validationExpenseDate",
  "time-invalid": "validationExpenseTime",
  "invalid-local-time": "validationLocalTime",
  "invalid-time-zone": "validationTimeZone",
};

function ExpenseEditor({
  eventId,
  expenseId,
  session,
}: {
  readonly eventId: string;
  readonly expenseId: string | null;
  readonly session: SessionResponse;
}) {
  const locale = resolveLocale(session.user.locale ?? undefined);
  const messages = getMessages(locale);
  const runtime = useReadyAppRuntime();
  const projection = usePlanningProjection(
    session.workspace.id,
    eventId,
    "expenses",
  );
  const expenses =
    projection.data?.kind === "expenses" ? projection.data.value : undefined;
  const source = expenses?.items.find((item) => item.id === expenseId);
  const access = useExpenseAccess(session.workspace.id, expenseId ?? eventId);
  const create = useCreateEventExpense(session.workspace.id, eventId);
  const update = useUpdateEventExpense(session.workspace.id, eventId);
  const mutation = expenseId === null ? create : update;
  const timeZone = deviceTimeZone(session.user.timeZone);
  const identity = useMemo(
    () => ({
      eventId,
      expenseId,
      userId: session.user.id,
      workspaceId: session.workspace.id,
    }),
    [eventId, expenseId, session.user.id, session.workspace.id],
  );
  const [draft, setDraft] = useState<ExpenseDraftSnapshot | null>(null);
  const [conflict, setConflict] = useState<ExpenseResponse | null>(null);
  const [issue, setIssue] = useState<ExpenseEditorIssue | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [initializationFailed, setInitializationFailed] = useState(false);
  const initializing = useRef(false);
  const editable = canEditExpense(access.data);
  const { clearPendingDraft, reportStorageFailure, storageFailed } =
    useEditorDraftPersistence({
      draft,
      identity,
      same: sameExpenseFields,
      store: runtime.expenseDrafts,
    });

  useEffect(() => {
    if (
      initializationFailed ||
      initializing.current ||
      !editable ||
      expenses === undefined ||
      (expenseId !== null && source === undefined)
    )
      return;
    initializing.current = true;
    let active = true;
    void runtime.expenseDrafts
      .load(identity)
      .then(async (stored) => {
        if (!active) return;
        if (stored !== null) {
          setDraft(stored);
          setRecovered(true);
          if (source !== undefined && stored.sourceVersion !== source.version)
            setConflict(source);
          return;
        }
        const baseline = source
          ? fieldsFromExpense(source, timeZone)
          : emptyExpenseFields(
              timeZone,
              null,
              new Date(),
              locale === "en-US" ? "USD" : "CNY",
            );
        const commandId =
          expenseId === null ? await runtime.createCommandId() : null;
        if (!active) return;
        setDraft({
          ...identity,
          baseline,
          commandId,
          fields: baseline,
          sourceVersion: source?.version ?? null,
          updatedAt: new Date().toISOString(),
        });
      })
      .catch(() => {
        if (active) {
          initializing.current = false;
          setInitializationFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [
    editable,
    expenses,
    expenseId,
    identity,
    initializationFailed,
    locale,
    runtime,
    source,
    timeZone,
  ]);

  useEffect(() => {
    if (
      draft === null ||
      source === undefined ||
      draft.sourceVersion === source.version
    )
      return;
    if (sameExpenseFields(draft.fields, draft.baseline)) {
      const fields = fieldsFromExpense(source, timeZone);
      setDraft((current) =>
        current === null
          ? null
          : {
              ...current,
              baseline: fields,
              fields,
              sourceVersion: source.version,
              updatedAt: new Date().toISOString(),
            },
      );
    } else setConflict(source);
  }, [draft, source, timeZone]);

  useEffect(() => {
    if (
      [access.error, projection.error].some(
        (error) =>
          error instanceof ApiClientError && [403, 404].includes(error.status),
      )
    )
      void runtime.expenseDrafts.remove(identity).catch(() => undefined);
  }, [access.error, identity, projection.error, runtime]);

  function change(fields: Partial<ExpenseEditorFields>): void {
    setIssue(null);
    mutation.reset();
    setDraft((current) =>
      current === null
        ? null
        : {
            ...current,
            fields: { ...current.fields, ...fields },
            updatedAt: new Date().toISOString(),
          },
    );
  }

  async function latestExpense(): Promise<ExpenseResponse | undefined> {
    const latest = await projection.refetch();
    return latest.data?.kind === "expenses"
      ? latest.data.value.items.find((item) => item.id === expenseId)
      : undefined;
  }

  async function finish(): Promise<void> {
    clearPendingDraft();
    await runtime.expenseDrafts.remove(identity).catch(reportStorageFailure);
    await Taro.navigateBack();
  }

  async function save(
    latest: ExpenseResponse | undefined = source,
  ): Promise<void> {
    if (draft === null || mutation.isPending) return;
    setIssue(null);
    try {
      if (expenseId === null) {
        if (draft.commandId === null)
          throw new Error("The Expense creation command is unavailable.");
        await create.mutateAsync(
          expenseCreatePayload(draft.fields, draft.commandId),
        );
      } else {
        if (latest === undefined) return;
        await update.mutateAsync({
          id: expenseId,
          payload: expenseUpdatePayload(draft.fields, latest),
        });
      }
      await finish();
    } catch (error) {
      if (error instanceof ExpenseEditorValidationError) {
        setIssue(error.issue);
      } else if (
        expenseId !== null &&
        error instanceof ApiClientError &&
        error.code === "version_conflict"
      ) {
        try {
          const refreshed = await latestExpense();
          if (refreshed !== undefined) setConflict(refreshed);
        } catch {
          // The failed mutation remains visible for retry.
        }
      }
    }
  }

  async function adoptLatest(): Promise<void> {
    if (draft === null || conflict === null) return;
    const fields = fieldsFromExpense(conflict, timeZone);
    setDraft({
      ...draft,
      baseline: fields,
      fields,
      sourceVersion: conflict.version,
      updatedAt: new Date().toISOString(),
    });
    setConflict(null);
    setRecovered(false);
    await runtime.expenseDrafts.remove(identity).catch(reportStorageFailure);
  }

  async function discard(): Promise<void> {
    await runtime.expenseDrafts.remove(identity).catch(reportStorageFailure);
    if (expenseId === null) {
      await Taro.navigateBack();
      return;
    }
    const latest = await latestExpense();
    if (latest === undefined) return;
    const fields = fieldsFromExpense(latest, timeZone);
    setDraft((current) =>
      current === null
        ? null
        : {
            ...current,
            baseline: fields,
            fields,
            sourceVersion: latest.version,
            updatedAt: new Date().toISOString(),
          },
    );
    setConflict(null);
    setRecovered(false);
  }

  const inaccessible =
    (expenseId !== null && expenses !== undefined && source === undefined) ||
    [access.error, projection.error].some(
      (error) =>
        error instanceof ApiClientError && [403, 404].includes(error.status),
    );
  if (inaccessible)
    return (
      <View className="editor-shell">
        <EditorStateCard
          action={messages.backToEvents}
          detail={messages.permissionLostDetail}
          onAction={() => void Taro.navigateBack()}
          title={messages.permissionLostTitle}
        />
      </View>
    );
  if (access.isError || projection.isError)
    return (
      <View className="editor-shell">
        <EditorStateCard
          action={messages.retry}
          detail={messages.errorDetail}
          onAction={() =>
            void Promise.all([access.refetch(), projection.refetch()])
          }
          title={messages.errorTitle}
        />
      </View>
    );
  if (!access.isPending && !editable)
    return (
      <View className="editor-shell">
        <EditorStateCard
          action={messages.backToEvents}
          detail={
            expenseId === null
              ? messages.cannotCreateExpense
              : messages.cannotEditExpense
          }
          onAction={() => void Taro.navigateBack()}
          title={
            expenseId === null
              ? messages.createExpenseTitle
              : messages.editExpenseTitle
          }
        />
      </View>
    );
  if (draft === null)
    return (
      <View className="editor-shell">
        <EditorStateCard
          action={initializationFailed ? messages.retry : undefined}
          detail={
            initializationFailed ? messages.errorDetail : messages.loading
          }
          onAction={
            initializationFailed
              ? () => setInitializationFailed(false)
              : undefined
          }
          title={initializationFailed ? messages.errorTitle : messages.loading}
        />
      </View>
    );

  const dirty = !sameExpenseFields(draft.fields, draft.baseline);
  const disabled = mutation.isPending || conflict !== null;
  return (
    <View className="editor-shell">
      <View className="editor-header">
        <Button className="editor-nav" onClick={() => void Taro.navigateBack()}>
          {messages.cancel}
        </Button>
        <Text className="editor-heading">
          {expenseId === null
            ? messages.createExpenseTitle
            : messages.editExpenseTitle}
        </Text>
        <View className="editor-nav-spacer" />
      </View>
      {conflict ? (
        <View className="conflict-card" role="alert">
          <Text className="conflict-card__title">
            {messages.expenseConflictTitle}
          </Text>
          <Text className="conflict-card__detail">
            {messages.expenseConflictDetail}
          </Text>
          <View className="conflict-current">
            <Text className="conflict-current__label">
              {messages.currentExpense}
            </Text>
            <Text className="conflict-current__name">
              {conflict.displayName}
            </Text>
            <Text className="conflict-current__date">
              {conflict.currency} {conflict.amount} ·{" "}
              {formatInstant(conflict.occurredAt, {
                hourCycle: session.user.hourCycle,
                locale,
                timeZone: session.user.timeZone,
              })}
            </Text>
          </View>
          <View className="conflict-actions">
            <Button
              className="editor-button editor-button--secondary"
              disabled={mutation.isPending}
              onClick={() => void adoptLatest()}
            >
              {messages.useLatest}
            </Button>
            <Button
              className="editor-button editor-button--primary"
              disabled={
                mutation.isPending ||
                sameExpenseFields(
                  draft.fields,
                  fieldsFromExpense(conflict, timeZone),
                )
              }
              loading={mutation.isPending}
              onClick={() => void save(conflict)}
            >
              {messages.keepMine}
            </Button>
          </View>
        </View>
      ) : null}
      {recovered && dirty && !conflict ? (
        <View className="draft-notice">
          <Text>{messages.draftRestored}</Text>
          <Button
            className="draft-notice__action"
            onClick={() => void discard()}
          >
            {messages.discardDraft}
          </Button>
        </View>
      ) : null}
      {storageFailed ? (
        <Text className="editor-alert">{messages.storageFailed}</Text>
      ) : null}
      {issue ? (
        <Text className="editor-alert">{messages[issueKeys[issue]]}</Text>
      ) : null}
      {mutation.isError && !conflict && issue === null ? (
        <Text className="editor-alert">{messages.expenseSaveFailed}</Text>
      ) : null}
      <ExpenseEditorFieldsForm
        disabled={disabled}
        fields={draft.fields}
        locale={locale}
        onChange={change}
        sections={expenses?.sections ?? []}
      />
      <View className="editor-footer">
        <Button
          className="editor-button editor-button--secondary"
          disabled={mutation.isPending || !dirty}
          onClick={() => void discard()}
        >
          {messages.discardDraft}
        </Button>
        <Button
          className="editor-button editor-button--primary"
          disabled={mutation.isPending || conflict !== null || !dirty}
          loading={mutation.isPending}
          onClick={() => void save()}
        >
          {mutation.isPending
            ? messages.saving
            : mutation.isError
              ? messages.retrySave
              : expenseId === null
                ? messages.createExpense
                : messages.save}
        </Button>
      </View>
    </View>
  );
}

export default function ExpenseEditorPage() {
  const route = useRouter();
  const auth = useSession();
  useNavigationTitle("expense");
  const eventId =
    typeof route.params.eventId === "string" && route.params.eventId.length > 0
      ? route.params.eventId
      : null;
  const expenseId =
    typeof route.params.expenseId === "string" &&
    route.params.expenseId.length > 0
      ? route.params.expenseId
      : null;
  if (auth.state.status === "ready" && eventId !== null)
    return (
      <ExpenseEditor
        eventId={eventId}
        expenseId={expenseId}
        session={auth.state.session}
      />
    );
  const locale = resolveLocale(
    auth.state.status === "onboarding"
      ? (auth.state.session.user.locale ?? undefined)
      : undefined,
  );
  const messages = getMessages(locale);
  return (
    <View className="editor-shell">
      <EditorStateCard
        action={eventId === null ? messages.backToEvents : undefined}
        detail={
          eventId === null
            ? messages.permissionLostDetail
            : messages.errorDetail
        }
        onAction={eventId === null ? () => void Taro.navigateBack() : undefined}
        title={
          eventId === null ? messages.permissionLostTitle : messages.loading
        }
      />
    </View>
  );
}
