import { ApiClientError } from "@livtales/api-client";
import type { ReminderResponse, SessionResponse } from "@livtales/schemas";
import { Button, Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { useEffect, useMemo, useRef, useState } from "react";

import { useSession } from "../../auth/session-context";
import { EditorStateCard } from "../../components/editor";
import { formatInstant } from "../../events/format";
import { deviceTimeZone } from "../../events/wall-clock";
import {
  getMessages,
  resolveLocale,
  type MessageKey,
} from "../../i18n/catalog";
import { canEditReminder } from "../../reminders/data";
import type { ReminderDraftSnapshot } from "../../reminders/draft-store";
import {
  emptyReminderFields,
  fieldsFromReminder,
  reminderCreatePayload,
  reminderUpdatePayload,
  ReminderEditorValidationError,
  sameReminderFields,
  type ReminderEditorFields,
  type ReminderEditorIssue,
} from "../../reminders/editor";
import {
  useCreateEventReminder,
  useReminderAccess,
  useUpdateEventReminder,
} from "../../reminders/queries";
import { useReadyAppRuntime } from "../../runtime/app-runtime";
import { useEditorDraftPersistence } from "../../runtime/use-editor-draft";
import { usePlanningProjection } from "../planning/queries";
import { ReminderEditorFieldsForm } from "./editor-fields";
import "../../styles/editor.scss";

const issueKeys: Record<ReminderEditorIssue, MessageKey> = {
  "name-required": "validationReminderNameRequired",
  "name-too-long": "validationReminderNameTooLong",
  "date-invalid": "validationReminderDate",
  "time-invalid": "validationReminderTime",
  "invalid-local-time": "validationLocalTime",
  "invalid-time-zone": "validationTimeZone",
};

const statusKeys: Record<ReminderResponse["status"], MessageKey> = {
  pending: "reminderPending",
  triggered: "reminderTriggered",
  dismissed: "reminderDismissed",
  cancelled: "reminderCancelled",
};

function ReminderEditor({
  eventId,
  reminderId,
  session,
}: {
  readonly eventId: string;
  readonly reminderId: string | null;
  readonly session: SessionResponse;
}) {
  const locale = resolveLocale(session.user.locale ?? undefined);
  const messages = getMessages(locale);
  const runtime = useReadyAppRuntime();
  const projection = usePlanningProjection(
    session.workspace.id,
    eventId,
    "reminders",
  );
  const reminders =
    projection.data?.kind === "reminders" ? projection.data.value : undefined;
  const source = reminders?.items.find((item) => item.id === reminderId);
  const access = useReminderAccess(session.workspace.id, reminderId ?? eventId);
  const create = useCreateEventReminder(session.workspace.id, eventId);
  const update = useUpdateEventReminder(session.workspace.id, eventId);
  const mutation = reminderId === null ? create : update;
  const timeZone = deviceTimeZone(session.user.timeZone);
  const identity = useMemo(
    () => ({
      eventId,
      reminderId,
      userId: session.user.id,
      workspaceId: session.workspace.id,
    }),
    [eventId, reminderId, session.user.id, session.workspace.id],
  );
  const [draft, setDraft] = useState<ReminderDraftSnapshot | null>(null);
  const [conflict, setConflict] = useState<ReminderResponse | null>(null);
  const [issue, setIssue] = useState<ReminderEditorIssue | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [initializationFailed, setInitializationFailed] = useState(false);
  const initializing = useRef(false);
  const editable = canEditReminder(access.data);
  const { clearPendingDraft, reportStorageFailure, storageFailed } =
    useEditorDraftPersistence({
      draft,
      identity,
      same: sameReminderFields,
      store: runtime.reminderDrafts,
    });

  useEffect(() => {
    if (
      initializationFailed ||
      initializing.current ||
      !editable ||
      reminders === undefined ||
      (reminderId !== null && source === undefined)
    )
      return;
    initializing.current = true;
    let active = true;
    void runtime.reminderDrafts
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
          ? fieldsFromReminder(source, timeZone)
          : emptyReminderFields(timeZone);
        const commandId =
          reminderId === null ? await runtime.createCommandId() : null;
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
    identity,
    initializationFailed,
    reminderId,
    reminders,
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
    if (sameReminderFields(draft.fields, draft.baseline)) {
      const fields = fieldsFromReminder(source, timeZone);
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
      void runtime.reminderDrafts.remove(identity).catch(() => undefined);
  }, [access.error, identity, projection.error, runtime]);

  function change(fields: Partial<ReminderEditorFields>): void {
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

  async function latestReminder(): Promise<ReminderResponse | undefined> {
    const latest = await projection.refetch();
    return latest.data?.kind === "reminders"
      ? latest.data.value.items.find((item) => item.id === reminderId)
      : undefined;
  }

  async function finish(): Promise<void> {
    clearPendingDraft();
    await runtime.reminderDrafts.remove(identity).catch(reportStorageFailure);
    await Taro.navigateBack();
  }

  async function save(latest: ReminderResponse | undefined = source) {
    if (draft === null || mutation.isPending) return;
    setIssue(null);
    try {
      if (reminderId === null) {
        if (draft.commandId === null)
          throw new Error("The Reminder creation command is unavailable.");
        await create.mutateAsync(
          reminderCreatePayload(draft.fields, draft.commandId),
        );
      } else {
        if (latest === undefined) return;
        await update.mutateAsync({
          id: reminderId,
          payload: reminderUpdatePayload(draft.fields, latest),
        });
      }
      await finish();
    } catch (error) {
      if (error instanceof ReminderEditorValidationError) {
        setIssue(error.issue);
      } else if (
        reminderId !== null &&
        error instanceof ApiClientError &&
        error.code === "version_conflict"
      ) {
        try {
          const refreshed = await latestReminder();
          if (refreshed !== undefined) setConflict(refreshed);
        } catch {
          // The failed mutation remains visible for retry.
        }
      }
    }
  }

  async function adoptLatest(): Promise<void> {
    if (draft === null || conflict === null) return;
    const fields = fieldsFromReminder(conflict, timeZone);
    setDraft({
      ...draft,
      baseline: fields,
      fields,
      sourceVersion: conflict.version,
      updatedAt: new Date().toISOString(),
    });
    setConflict(null);
    setRecovered(false);
    await runtime.reminderDrafts.remove(identity).catch(reportStorageFailure);
  }

  async function discard(): Promise<void> {
    await runtime.reminderDrafts.remove(identity).catch(reportStorageFailure);
    if (reminderId === null) {
      await Taro.navigateBack();
      return;
    }
    const latest = await latestReminder();
    if (latest === undefined) return;
    const fields = fieldsFromReminder(latest, timeZone);
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
    (reminderId !== null && reminders !== undefined && source === undefined) ||
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
            reminderId === null
              ? messages.cannotCreateReminder
              : messages.cannotEditReminder
          }
          onAction={() => void Taro.navigateBack()}
          title={
            reminderId === null
              ? messages.createReminderTitle
              : messages.editReminderTitle
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

  const dirty = !sameReminderFields(draft.fields, draft.baseline);
  const disabled = mutation.isPending || conflict !== null;
  return (
    <View className="editor-shell">
      <View className="editor-header">
        <Button className="editor-nav" onClick={() => void Taro.navigateBack()}>
          {messages.cancel}
        </Button>
        <Text className="editor-heading">
          {reminderId === null
            ? messages.createReminderTitle
            : messages.editReminderTitle}
        </Text>
        <View className="editor-nav-spacer" />
      </View>
      {conflict ? (
        <View className="conflict-card" role="alert">
          <Text className="conflict-card__title">
            {messages.reminderConflictTitle}
          </Text>
          <Text className="conflict-card__detail">
            {messages.reminderConflictDetail}
          </Text>
          <View className="conflict-current">
            <Text className="conflict-current__label">
              {messages.currentReminder}
            </Text>
            <Text className="conflict-current__name">
              {conflict.displayName}
            </Text>
            <Text className="conflict-current__date">
              {messages[statusKeys[conflict.status]]} ·{" "}
              {formatInstant(conflict.remindAt, {
                hourCycle: session.user.hourCycle,
                locale,
                timeZone,
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
                sameReminderFields(
                  draft.fields,
                  fieldsFromReminder(conflict, timeZone),
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
        <Text className="editor-alert">{messages.reminderSaveFailed}</Text>
      ) : null}
      <ReminderEditorFieldsForm
        disabled={disabled}
        fields={draft.fields}
        locale={locale}
        onChange={change}
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
              : reminderId === null
                ? messages.createReminder
                : messages.save}
        </Button>
      </View>
    </View>
  );
}

export default function ReminderEditorPage() {
  const route = useRouter();
  const auth = useSession();
  const eventId =
    typeof route.params.eventId === "string" && route.params.eventId.length > 0
      ? route.params.eventId
      : null;
  const reminderId =
    typeof route.params.reminderId === "string" &&
    route.params.reminderId.length > 0
      ? route.params.reminderId
      : null;
  if (auth.state.status === "ready" && eventId !== null)
    return (
      <ReminderEditor
        eventId={eventId}
        reminderId={reminderId}
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
