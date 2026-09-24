import { ApiClientError } from "@chronelle/api-client";
import type { SessionResponse, TaskResponse } from "@chronelle/schemas";
import { Button, Input, Text, Textarea, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { useEffect, useMemo, useRef, useState } from "react";

import { useSession } from "../../auth/session-context";
import { EditorFieldLabel, EditorStateCard } from "../../components/editor";
import { deviceTimeZone } from "../../events/wall-clock";
import { usePlanningProjection } from "../planning/queries";
import {
  getMessages,
  resolveLocale,
  type MessageKey,
} from "../../i18n/catalog";
import { useReadyAppRuntime } from "../../runtime/app-runtime";
import { useEditorDraftPersistence } from "../../runtime/use-editor-draft";
import { useNavigationTitle } from "../../shell/use-navigation-title";
import type { TaskDraftSnapshot } from "../../tasks/draft-store";
import {
  emptyTaskFields,
  fieldsFromTask,
  sameTaskFields,
  taskCreatePayload,
  TaskEditorValidationError,
  taskUpdatePayload,
  type TaskEditorFields,
  type TaskEditorIssue,
} from "../../tasks/editor";
import {
  canEditTask,
  useCreateEventTask,
  useTaskAccess,
  useUpdateEventTask,
} from "../../tasks/queries";
import { TaskConflictCard, TaskMetadataEditor } from "./editor-components";
import "../../styles/editor.scss";

function issueMessage(issue: TaskEditorIssue): MessageKey {
  const messages: Record<TaskEditorIssue, MessageKey> = {
    "description-too-long": "validationDescriptionTooLong",
    "due-date-required": "validationDueDateRequired",
    "due-time-required": "validationDueTimeRequired",
    "invalid-date": "validationInvalidDate",
    "invalid-local-time": "validationLocalTime",
    "invalid-time-zone": "validationTimeZone",
    "location-too-long": "validationLocationTooLong",
    "name-required": "validationTaskNameRequired",
    "name-too-long": "validationTaskNameTooLong",
  };
  return messages[issue];
}

function TaskEditor({
  eventId,
  initialSectionId,
  session,
  taskId,
}: {
  readonly eventId: string;
  readonly initialSectionId: string | null;
  readonly session: SessionResponse;
  readonly taskId: string | null;
}) {
  const locale = resolveLocale(session.user.locale ?? undefined);
  const messages = getMessages(locale);
  const runtime = useReadyAppRuntime();
  const projection = usePlanningProjection(
    session.workspace.id,
    eventId,
    "todos",
  );
  const todoProjection =
    projection.data?.kind === "todos" ? projection.data.value : undefined;
  const sourceTask = todoProjection?.items.find((task) => task.id === taskId);
  const access = useTaskAccess(session.workspace.id, taskId ?? eventId);
  const create = useCreateEventTask(session.workspace.id, eventId);
  const update = useUpdateEventTask(session.workspace.id, eventId);
  const mutation = taskId === null ? create : update;
  const [draft, setDraft] = useState<TaskDraftSnapshot | null>(null);
  const [conflict, setConflict] = useState<TaskResponse | null>(null);
  const [issue, setIssue] = useState<TaskEditorIssue | null>(null);
  const [initializationFailed, setInitializationFailed] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const initializing = useRef(false);
  const identity = useMemo(
    () => ({
      eventId,
      taskId,
      userId: session.user.id,
      workspaceId: session.workspace.id,
    }),
    [eventId, session.user.id, session.workspace.id, taskId],
  );
  const fallbackTimeZone = deviceTimeZone(session.user.timeZone);
  const editable = canEditTask(access.data);
  const { reportStorageFailure, storageFailed } = useEditorDraftPersistence({
    draft,
    identity,
    same: sameTaskFields,
    store: runtime.taskDrafts,
  });

  useEffect(() => {
    if (
      initializationFailed ||
      initializing.current ||
      !editable ||
      todoProjection === undefined ||
      (taskId !== null && sourceTask === undefined)
    )
      return;
    initializing.current = true;
    let active = true;
    void runtime.taskDrafts
      .load(identity)
      .then(async (stored) => {
        if (!active) return;
        if (stored !== null) {
          setDraft(stored);
          setRecovered(true);
          if (
            sourceTask !== undefined &&
            stored.sourceVersion !== sourceTask.version
          )
            setConflict(sourceTask);
          return;
        }
        const sectionId = todoProjection.sections.some(
          (section) => section.id === initialSectionId,
        )
          ? initialSectionId
          : null;
        const baseline = sourceTask
          ? fieldsFromTask(sourceTask, fallbackTimeZone)
          : emptyTaskFields(fallbackTimeZone, sectionId);
        const commandId =
          taskId === null ? await runtime.createCommandId() : null;
        if (!active) return;
        setDraft({
          ...identity,
          baseline,
          commandId,
          fields: baseline,
          sourceVersion: sourceTask?.version ?? null,
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
    fallbackTimeZone,
    identity,
    initialSectionId,
    initializationFailed,
    runtime,
    sourceTask,
    taskId,
    todoProjection,
  ]);

  useEffect(() => {
    if (
      draft === null ||
      sourceTask === undefined ||
      draft.sourceVersion === sourceTask.version
    )
      return;
    if (sameTaskFields(draft.fields, draft.baseline)) {
      const fields = fieldsFromTask(sourceTask, fallbackTimeZone);
      setDraft((current) =>
        current === null
          ? null
          : {
              ...current,
              baseline: fields,
              fields,
              sourceVersion: sourceTask.version,
              updatedAt: new Date().toISOString(),
            },
      );
    } else {
      setConflict(sourceTask);
    }
  }, [draft, fallbackTimeZone, sourceTask]);

  useEffect(() => {
    const denied = [access.error, projection.error].some(
      (error) =>
        error instanceof ApiClientError && [403, 404].includes(error.status),
    );
    if (denied) void runtime.taskDrafts.remove(identity).catch(() => undefined);
  }, [access.error, identity, projection.error, runtime]);

  function change(changeSet: Partial<TaskEditorFields>): void {
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
  }

  async function finish(): Promise<void> {
    await runtime.taskDrafts.remove(identity).catch(reportStorageFailure);
    await Taro.navigateBack();
  }

  async function latestCanonicalTask(): Promise<TaskResponse | undefined> {
    const refreshed = await projection.refetch();
    return refreshed.data?.kind === "todos"
      ? refreshed.data.value.items.find((task) => task.id === taskId)
      : undefined;
  }

  async function save(
    source: TaskResponse | undefined = sourceTask,
  ): Promise<void> {
    if (draft === null || mutation.isPending) return;
    setIssue(null);
    try {
      if (taskId === null) {
        if (draft.commandId === null)
          throw new Error("The Task creation command is unavailable.");
        await create.mutateAsync(
          taskCreatePayload(draft.fields, draft.commandId),
        );
      } else {
        if (source === undefined) return;
        await update.mutateAsync({
          id: taskId,
          input: taskUpdatePayload(draft.fields, source),
        });
      }
      await finish();
    } catch (error) {
      if (error instanceof TaskEditorValidationError) {
        setIssue(error.issue);
        return;
      }
      if (
        taskId !== null &&
        error instanceof ApiClientError &&
        error.code === "version_conflict"
      ) {
        const latest = await latestCanonicalTask();
        if (latest !== undefined) setConflict(latest);
      }
    }
  }

  async function adoptLatest(): Promise<void> {
    if (draft === null || conflict === null) return;
    const fields = fieldsFromTask(conflict, fallbackTimeZone);
    setDraft({
      ...draft,
      baseline: fields,
      fields,
      sourceVersion: conflict.version,
      updatedAt: new Date().toISOString(),
    });
    setConflict(null);
    setRecovered(false);
    await runtime.taskDrafts.remove(identity).catch(reportStorageFailure);
  }

  async function discardDraft(): Promise<void> {
    await runtime.taskDrafts.remove(identity).catch(reportStorageFailure);
    if (taskId === null) {
      await Taro.navigateBack();
      return;
    }
    const latest = await latestCanonicalTask();
    if (latest === undefined) return;
    const fields = fieldsFromTask(latest, fallbackTimeZone);
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
    (taskId !== null &&
      todoProjection !== undefined &&
      sourceTask === undefined) ||
    [access.error, projection.error].some(
      (error) =>
        error instanceof ApiClientError && [403, 404].includes(error.status),
    );
  if (inaccessible) {
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
  }
  if (access.isError || projection.isError) {
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
  }
  if (!access.isPending && !editable) {
    return (
      <View className="editor-shell">
        <EditorStateCard
          action={messages.backToEvents}
          detail={
            taskId === null
              ? messages.cannotCreateTask
              : messages.cannotEditTask
          }
          onAction={() => void Taro.navigateBack()}
          title={
            taskId === null ? messages.createTaskTitle : messages.editTaskTitle
          }
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

  const dirty = !sameTaskFields(draft.fields, draft.baseline);
  const disabled = mutation.isPending || conflict !== null;
  return (
    <View className="editor-shell">
      <View className="editor-header">
        <Button className="editor-nav" onClick={() => void Taro.navigateBack()}>
          {messages.cancel}
        </Button>
        <Text className="editor-heading">
          {taskId === null ? messages.createTaskTitle : messages.editTaskTitle}
        </Text>
        <View className="editor-nav-spacer" />
      </View>

      {conflict ? (
        <TaskConflictCard
          draft={draft}
          latest={conflict}
          locale={locale}
          onKeepMine={() => void save(conflict)}
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
        <Text className="editor-alert">{messages.taskSaveFailed}</Text>
      ) : null}

      <View className="editor-form">
        <View className="editor-field">
          <EditorFieldLabel>{messages.taskName}</EditorFieldLabel>
          <Input
            className="editor-input editor-input--title"
            disabled={disabled}
            maxlength={240}
            onInput={(event) => change({ displayName: event.detail.value })}
            placeholder={messages.taskNamePlaceholder}
            value={draft.fields.displayName}
          />
        </View>

        <TaskMetadataEditor
          disabled={disabled}
          fields={draft.fields}
          locale={locale}
          onChange={change}
          sections={todoProjection?.sections ?? []}
        />

        <View className="editor-field">
          <EditorFieldLabel>{messages.taskLocation}</EditorFieldLabel>
          <Input
            className="editor-input"
            disabled={disabled}
            maxlength={240}
            onInput={(event) => change({ location: event.detail.value })}
            placeholder={messages.taskLocationPlaceholder}
            value={draft.fields.location}
          />
        </View>
        <View className="editor-field">
          <EditorFieldLabel>{messages.taskDetails}</EditorFieldLabel>
          <Textarea
            className="editor-textarea"
            disabled={disabled}
            maxlength={2000}
            onInput={(event) => change({ description: event.detail.value })}
            placeholder={messages.taskDetailsPlaceholder}
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
              : taskId === null
                ? messages.createTask
                : messages.save}
        </Button>
      </View>
    </View>
  );
}

export default function TaskEditorPage() {
  const route = useRouter();
  const auth = useSession();
  useNavigationTitle("task");
  const eventId =
    typeof route.params.eventId === "string" && route.params.eventId.length > 0
      ? route.params.eventId
      : null;
  const taskId =
    typeof route.params.taskId === "string" && route.params.taskId.length > 0
      ? route.params.taskId
      : null;
  const sectionId =
    typeof route.params.sectionId === "string" &&
    route.params.sectionId.length > 0
      ? route.params.sectionId
      : null;
  if (auth.state.status === "ready" && eventId !== null) {
    return (
      <TaskEditor
        eventId={eventId}
        initialSectionId={sectionId}
        session={auth.state.session}
        taskId={taskId}
      />
    );
  }
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
