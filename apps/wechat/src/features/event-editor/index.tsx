import { ApiClientError } from "@livtales/api-client";
import type {
  EventResponse,
  ObjectAccessResponse,
  SessionResponse,
} from "@livtales/schemas";
import { Button, Input, Text, Textarea, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { useEffect, useMemo, useRef, useState } from "react";

import { useSession } from "../../auth/session-context";
import { canCreateInActiveWorkspace } from "../../auth/workspace-access";
import { EditorFieldLabel, EditorStateCard } from "../../components/editor";
import type { EventDraftSnapshot } from "../../events/draft-store";
import { deviceTimeZone } from "../../events/wall-clock";
import {
  emptyEventFields,
  EventEditorValidationError,
  eventCreatePayload,
  eventUpdatePayload,
  fieldsFromEvent,
  sameEventFields,
  type EventEditorFields,
  type EventEditorIssue,
} from "../../events/editor";
import {
  useCreateEvent,
  useEventOverview,
  useUpdateEvent,
} from "../../events/queries";
import {
  getMessages,
  resolveLocale,
  type MessageKey,
} from "../../i18n/catalog";
import { useReadyAppRuntime } from "../../runtime/app-runtime";
import { useEditorDraftPersistence } from "../../runtime/use-editor-draft";
import { EventConflictCard, EventScheduleEditor } from "./editor-components";
import "../../styles/editor.scss";

function issueMessage(issue: EventEditorIssue): MessageKey {
  const messages: Record<EventEditorIssue, MessageKey> = {
    "description-too-long": "validationDescriptionTooLong",
    "end-before-start": "validationEndBeforeStart",
    "end-incomplete": "validationEndIncomplete",
    "invalid-date": "validationInvalidDate",
    "invalid-local-time": "validationLocalTime",
    "invalid-time-zone": "validationTimeZone",
    "location-too-long": "validationLocationTooLong",
    "name-required": "validationNameRequired",
    "name-too-long": "validationNameTooLong",
    "start-required": "validationStartRequired",
  };
  return messages[issue];
}

function mayEdit(access: ObjectAccessResponse): boolean {
  return access.actions.includes("edit");
}

function EventEditor({
  eventId,
  session,
}: {
  readonly eventId: string | null;
  readonly session: SessionResponse;
}) {
  const locale = resolveLocale(session.user.locale ?? undefined);
  const messages = getMessages(locale);
  const runtime = useReadyAppRuntime();
  const overview = useEventOverview(session.workspace.id, eventId);
  const create = useCreateEvent(session.workspace.id);
  const update = useUpdateEvent(session.workspace.id, eventId ?? "new");
  const mutation = eventId === null ? create : update;
  const [draft, setDraft] = useState<EventDraftSnapshot | null>(null);
  const [conflict, setConflict] = useState<EventResponse | null>(null);
  const [issue, setIssue] = useState<EventEditorIssue | null>(null);
  const [initializationFailed, setInitializationFailed] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const initializing = useRef(false);
  const identity = useMemo(
    () => ({
      eventId,
      userId: session.user.id,
      workspaceId: session.workspace.id,
    }),
    [eventId, session.user.id, session.workspace.id],
  );
  const sourceEvent = overview.data?.event;
  const fallbackTimeZone = deviceTimeZone(session.user.timeZone);
  const canCreate = canCreateInActiveWorkspace(session);
  const { reportStorageFailure, storageFailed } = useEditorDraftPersistence({
    draft,
    identity,
    same: sameEventFields,
    store: runtime.eventDrafts,
  });

  useEffect(() => {
    if (
      initializationFailed ||
      initializing.current ||
      (eventId === null && !canCreate) ||
      (eventId !== null && sourceEvent === undefined)
    )
      return;
    initializing.current = true;
    setInitializationFailed(false);
    let active = true;
    void runtime.eventDrafts
      .load(identity)
      .then(async (stored) => {
        if (!active) return;
        if (stored !== null) {
          setDraft(stored);
          setRecovered(true);
          if (
            sourceEvent !== undefined &&
            stored.sourceVersion !== sourceEvent.version
          )
            setConflict(sourceEvent);
          return;
        }
        const baseline = sourceEvent
          ? fieldsFromEvent(sourceEvent, fallbackTimeZone)
          : emptyEventFields(fallbackTimeZone);
        const commandId =
          eventId === null ? await runtime.createCommandId() : null;
        if (!active) return;
        setDraft({
          ...identity,
          baseline,
          commandId,
          fields: baseline,
          sourceVersion: sourceEvent?.version ?? null,
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
    canCreate,
    eventId,
    fallbackTimeZone,
    identity,
    initializationFailed,
    runtime,
    sourceEvent,
  ]);

  useEffect(() => {
    if (
      draft === null ||
      sourceEvent === undefined ||
      draft.sourceVersion === sourceEvent.version
    )
      return;
    if (sameEventFields(draft.fields, draft.baseline)) {
      const fields = fieldsFromEvent(sourceEvent, fallbackTimeZone);
      setDraft((current) =>
        current === null
          ? null
          : {
              ...current,
              baseline: fields,
              fields,
              sourceVersion: sourceEvent.version,
              updatedAt: new Date().toISOString(),
            },
      );
    } else {
      setConflict(sourceEvent);
    }
  }, [draft, fallbackTimeZone, sourceEvent]);

  useEffect(() => {
    if (
      eventId !== null &&
      overview.error instanceof ApiClientError &&
      [403, 404].includes(overview.error.status)
    )
      void runtime.eventDrafts.remove(identity).catch(() => undefined);
  }, [eventId, identity, overview.error, runtime]);

  const change = (changeSet: Partial<EventEditorFields>) => {
    setIssue(null);
    mutation.reset();
    setDraft((current) =>
      current === null
        ? null
        : {
            ...current,
            fields: { ...current.fields, ...changeSet },
            updatedAt: new Date().toISOString(),
          },
    );
  };

  async function finish(saved: EventResponse) {
    await runtime.eventDrafts.remove(identity).catch(reportStorageFailure);
    if (eventId === null) {
      await Taro.redirectTo({
        url: `/pages/event/index?id=${encodeURIComponent(saved.id)}`,
      });
    } else {
      await Taro.navigateBack();
    }
  }

  async function save(expectedVersion?: number) {
    if (draft === null || mutation.isPending) return;
    setIssue(null);
    try {
      let saved: EventResponse;
      if (eventId === null) {
        if (draft.commandId === null)
          throw new Error("The Event creation command is unavailable.");
        saved = await create.mutateAsync(
          eventCreatePayload(draft.fields, draft.commandId),
        );
      } else {
        saved = await update.mutateAsync(
          eventUpdatePayload(
            draft.fields,
            expectedVersion ?? draft.sourceVersion ?? 0,
          ),
        );
      }
      await finish(saved);
    } catch (error) {
      if (error instanceof EventEditorValidationError) {
        setIssue(error.issue);
        return;
      }
      if (
        eventId !== null &&
        error instanceof ApiClientError &&
        error.code === "version_conflict"
      ) {
        const refreshed = await overview.refetch();
        if (refreshed.data !== undefined) setConflict(refreshed.data.event);
      }
    }
  }

  async function adoptLatest() {
    if (draft === null || conflict === null) return;
    const fields = fieldsFromEvent(conflict, fallbackTimeZone);
    const next = {
      ...draft,
      baseline: fields,
      fields,
      sourceVersion: conflict.version,
      updatedAt: new Date().toISOString(),
    };
    setDraft(next);
    setConflict(null);
    setRecovered(false);
    await runtime.eventDrafts.remove(identity).catch(reportStorageFailure);
  }

  async function discardDraft() {
    await runtime.eventDrafts.remove(identity).catch(reportStorageFailure);
    if (eventId === null) {
      await Taro.navigateBack();
      return;
    }
    const latest = overview.data?.event;
    if (latest !== undefined) {
      const fields = fieldsFromEvent(latest, fallbackTimeZone);
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
  }

  const accessFailure =
    eventId !== null &&
    overview.error instanceof ApiClientError &&
    [403, 404].includes(overview.error.status);
  if (accessFailure) {
    return (
      <View className="editor-shell">
        <EditorStateCard
          action={messages.backToEvents}
          detail={messages.permissionLostDetail}
          onAction={() => void Taro.reLaunch({ url: "/pages/index/index" })}
          title={messages.permissionLostTitle}
        />
      </View>
    );
  }
  if (eventId !== null && overview.isError) {
    return (
      <View className="editor-shell">
        <EditorStateCard
          action={messages.retry}
          detail={messages.errorDetail}
          onAction={() => void overview.refetch()}
          title={messages.errorTitle}
        />
      </View>
    );
  }
  if (
    eventId !== null &&
    overview.data !== undefined &&
    !mayEdit(overview.data.access)
  ) {
    return (
      <View className="editor-shell">
        <EditorStateCard
          action={messages.backToEvents}
          detail={messages.cannotEdit}
          onAction={() => void Taro.navigateBack()}
          title={messages.editEventTitle}
        />
      </View>
    );
  }
  if (eventId === null && !canCreate) {
    return (
      <View className="editor-shell">
        <EditorStateCard
          action={messages.backToEvents}
          detail={messages.cannotCreate}
          onAction={() => void Taro.navigateBack()}
          title={messages.createEventTitle}
        />
      </View>
    );
  }
  if (draft === null) {
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
  }

  const dirty = !sameEventFields(draft.fields, draft.baseline);
  return (
    <View className="editor-shell">
      <View className="editor-header">
        <Button className="editor-nav" onClick={() => void Taro.navigateBack()}>
          {messages.cancel}
        </Button>
        <Text className="editor-heading">
          {eventId === null
            ? messages.createEventTitle
            : messages.editEventTitle}
        </Text>
        <View className="editor-nav-spacer" />
      </View>

      {conflict ? (
        <EventConflictCard
          draft={draft}
          latest={conflict}
          locale={locale}
          onKeepMine={() => void save(conflict.version)}
          onUseLatest={() => void adoptLatest()}
          pending={mutation.isPending}
          session={session}
        />
      ) : null}
      {recovered && dirty && !conflict ? (
        <View className="draft-notice">
          <Text>{messages.draftRestored}</Text>
          <Button
            className="draft-notice__action"
            onClick={() => void discardDraft()}
          >
            {messages.discardDraft}
          </Button>
        </View>
      ) : null}
      {storageFailed ? (
        <Text className="editor-alert">{messages.storageFailed}</Text>
      ) : null}
      {issue ? (
        <Text className="editor-alert">{messages[issueMessage(issue)]}</Text>
      ) : null}
      {mutation.isError && !conflict && issue === null ? (
        <Text className="editor-alert">{messages.saveFailed}</Text>
      ) : null}

      <View className="editor-form">
        <View className="editor-field">
          <EditorFieldLabel>{messages.eventName}</EditorFieldLabel>
          <Input
            className="editor-input editor-input--title"
            disabled={mutation.isPending}
            maxlength={240}
            onInput={(event) => change({ displayName: event.detail.value })}
            placeholder={messages.eventNamePlaceholder}
            value={draft.fields.displayName}
          />
        </View>

        <EventScheduleEditor
          disabled={mutation.isPending || conflict !== null}
          fields={draft.fields}
          locale={locale}
          onChange={change}
        />

        <View className="editor-field">
          <EditorFieldLabel>{messages.eventLocation}</EditorFieldLabel>
          <Input
            className="editor-input"
            disabled={mutation.isPending}
            maxlength={240}
            onInput={(event) => change({ location: event.detail.value })}
            placeholder={messages.eventLocationPlaceholder}
            value={draft.fields.location}
          />
        </View>
        <View className="editor-field">
          <EditorFieldLabel>{messages.eventDetails}</EditorFieldLabel>
          <Textarea
            className="editor-textarea"
            disabled={mutation.isPending}
            maxlength={2000}
            onInput={(event) => change({ description: event.detail.value })}
            placeholder={messages.eventDetailsPlaceholder}
            value={draft.fields.description}
          />
        </View>
      </View>

      <View className="editor-footer">
        <Button
          className="editor-button editor-button--secondary"
          disabled={mutation.isPending || !dirty}
          onClick={() => void discardDraft()}
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
              : eventId === null
                ? messages.create
                : messages.save}
        </Button>
      </View>
    </View>
  );
}

export default function EventEditorPage() {
  const route = useRouter();
  const auth = useSession();
  const eventId =
    typeof route.params.id === "string" && route.params.id.length > 0
      ? route.params.id
      : null;
  if (auth.state.status === "ready") {
    return <EventEditor eventId={eventId} session={auth.state.session} />;
  }
  const locale = resolveLocale(
    auth.state.status === "onboarding"
      ? (auth.state.session.user.locale ?? undefined)
      : undefined,
  );
  const messages = getMessages(locale);
  return (
    <View className="editor-shell">
      <EditorStateCard detail={messages.errorDetail} title={messages.loading} />
    </View>
  );
}
