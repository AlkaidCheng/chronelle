import { ApiClientError } from "@chronelle/api-client";
import type { EventPage, SessionResponse } from "@chronelle/schemas";
import { Button, Input, ScrollView, Text, View } from "@tarojs/components";
import Taro, { usePullDownRefresh, useRouter } from "@tarojs/taro";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useSession } from "../../auth/session-context";
import { useEventOverview } from "../../events/queries";
import { getMessages, resolveLocale, type AppLocale } from "../../i18n/catalog";
import { useOnline } from "../../runtime/online";
import { useReadyAppRuntime } from "../../runtime/app-runtime";
import { componentLabel, planningComponentKinds } from "./catalog";
import {
  addComponent,
  addPage,
  moveComponent,
  movePage,
  removeComponent,
  removePage,
  renamePage,
} from "./layout";
import { ProjectionCard } from "./projection-card";
import {
  planningProjectionQueryKey,
  usePlanningLayout,
  useUpdatePlanningLayout,
} from "./queries";
import "./index.scss";

type SaveIssue = "conflict" | "request" | null;
type PageNameIntent =
  | { readonly kind: "create" }
  | { readonly kind: "rename"; readonly pageId: string };

function PageState({
  action,
  detail,
  onAction,
  title,
}: {
  readonly action?: string | undefined;
  readonly detail: string;
  readonly onAction?: (() => void) | undefined;
  readonly title: string;
}) {
  return (
    <View className="planning-state">
      <View className="planning-state__mark" aria-hidden />
      <Text className="planning-state__title">{title}</Text>
      <Text className="planning-state__detail">{detail}</Text>
      {action && onAction ? (
        <Button
          className="planning-button planning-button--secondary"
          onClick={onAction}
        >
          {action}
        </Button>
      ) : null}
    </View>
  );
}

function PageNameDialog({
  error,
  intent,
  locale,
  name,
  onCancel,
  onChange,
  onSubmit,
}: {
  readonly error: string | null;
  readonly intent: PageNameIntent;
  readonly locale: AppLocale;
  readonly name: string;
  readonly onCancel: () => void;
  readonly onChange: (name: string) => void;
  readonly onSubmit: () => void;
}) {
  const messages = getMessages(locale);
  return (
    <View className="dialog-backdrop" catchMove onClick={onCancel}>
      <View
        aria-modal
        className="page-name-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <Text className="page-name-dialog__title">
          {intent.kind === "create" ? messages.addPage : messages.renamePage}
        </Text>
        <Text className="page-name-dialog__label">{messages.pageName}</Text>
        <Input
          className="page-name-dialog__input"
          confirmType="done"
          focus
          maxlength={80}
          onConfirm={onSubmit}
          onInput={(event) => onChange(event.detail.value)}
          placeholder={messages.pageNamePlaceholder}
          value={name}
        />
        {error ? (
          <Text className="page-name-dialog__error">{error}</Text>
        ) : null}
        <View className="page-name-dialog__actions">
          <Button className="text-button" onClick={onCancel}>
            {messages.cancel}
          </Button>
          <Button
            className="text-button text-button--primary"
            onClick={onSubmit}
          >
            {messages.save}
          </Button>
        </View>
      </View>
    </View>
  );
}

function ReadyPlanningPage({
  eventId,
  session,
}: {
  readonly eventId: string;
  readonly session: SessionResponse;
}) {
  const locale = resolveLocale(session.user.locale ?? undefined);
  const messages = getMessages(locale);
  const online = useOnline();
  const runtime = useReadyAppRuntime();
  const queryClient = useQueryClient();
  const overview = useEventOverview(session.workspace.id, eventId);
  const layout = usePlanningLayout(session.workspace.id, eventId);
  const updateLayout = useUpdatePlanningLayout(session.workspace.id, eventId);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [arranging, setArranging] = useState(false);
  const [pendingPages, setPendingPages] = useState<EventPage[] | null>(null);
  const [saveIssue, setSaveIssue] = useState<SaveIssue>(null);
  const [pageNameIntent, setPageNameIntent] = useState<PageNameIntent | null>(
    null,
  );
  const [pageName, setPageName] = useState("");
  const [pageNameError, setPageNameError] = useState<string | null>(null);

  const pages = layout.data?.pages ?? [];
  const selectedPage =
    pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null;
  const canEdit = overview.data?.access.actions.includes("edit") === true;
  const saving = updateLayout.isPending;

  useEffect(() => {
    if (selectedPage === null) {
      setSelectedPageId(null);
    } else if (selectedPage.id !== selectedPageId) {
      setSelectedPageId(selectedPage.id);
    }
  }, [selectedPage, selectedPageId]);

  async function savePages(
    nextPages: EventPage[],
    expectedVersion = layout.data?.version,
  ): Promise<void> {
    if (expectedVersion === undefined || saving) return;
    setPendingPages(nextPages);
    setSaveIssue(null);
    try {
      await updateLayout.mutateAsync({
        expectedVersion,
        pages: nextPages,
      });
      setPendingPages(null);
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.code === "version_conflict"
      ) {
        await layout.refetch();
        setSaveIssue("conflict");
      } else {
        setSaveIssue("request");
      }
    }
  }

  function applyLayout(change: () => EventPage[]): void {
    try {
      void savePages(change());
    } catch {
      void Taro.showToast({ icon: "none", title: messages.layoutSaveFailed });
    }
  }

  function openCreatePage(): void {
    setPageName("");
    setPageNameError(null);
    setPageNameIntent({ kind: "create" });
  }

  function openRenamePage(page: EventPage): void {
    setPageName(page.name);
    setPageNameError(null);
    setPageNameIntent({ kind: "rename", pageId: page.id });
  }

  async function submitPageName(): Promise<void> {
    const intent = pageNameIntent;
    const name = pageName.trim();
    if (intent === null) return;
    if (name.length === 0) {
      setPageNameError(messages.pageNameRequired);
      return;
    }
    setPageNameIntent(null);
    try {
      if (intent.kind === "create") {
        const id = await runtime.createCommandId();
        const next = addPage(pages, { id, name });
        setSelectedPageId(id);
        await savePages(next);
      } else {
        await savePages(renamePage(pages, intent.pageId, name));
      }
    } catch {
      await Taro.showToast({ icon: "none", title: messages.layoutSaveFailed });
    }
  }

  async function deletePage(page: EventPage): Promise<void> {
    const answer = await Taro.showModal({
      cancelText: messages.cancel,
      confirmColor: "#a33c2f",
      confirmText: messages.deletePage,
      content: messages.confirmDeletePageDetail,
      title: messages.confirmDeletePageTitle,
    });
    if (answer.confirm) applyLayout(() => removePage(pages, page.id));
  }

  async function chooseComponent(page: EventPage): Promise<void> {
    try {
      const choice = await Taro.showActionSheet({
        itemList: planningComponentKinds.map((kind) =>
          componentLabel(kind, locale),
        ),
      });
      const kind = planningComponentKinds[choice.tapIndex];
      if (kind === undefined) return;
      const id = await runtime.createCommandId();
      await savePages(addComponent(pages, page.id, { id, kind }));
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "errMsg" in error &&
        typeof error.errMsg === "string" &&
        error.errMsg.toLowerCase().includes("cancel")
      )
        return;
      await Taro.showToast({ icon: "none", title: messages.layoutSaveFailed });
    }
  }

  async function deleteComponent(
    page: EventPage,
    componentId: string,
  ): Promise<void> {
    const answer = await Taro.showModal({
      cancelText: messages.cancel,
      confirmColor: "#a33c2f",
      confirmText: messages.removeComponent,
      content: messages.confirmRemoveComponentDetail,
      title: messages.confirmRemoveComponentTitle,
    });
    if (answer.confirm)
      applyLayout(() => removeComponent(pages, page.id, componentId));
  }

  async function applyPendingToLatest(): Promise<void> {
    if (pendingPages === null) return;
    const latest = await layout.refetch();
    if (latest.data !== undefined) {
      await savePages(pendingPages, latest.data.version);
    }
  }

  function acceptCurrentLayout(): void {
    setPendingPages(null);
    setSaveIssue(null);
  }

  usePullDownRefresh(() => {
    void Promise.all([
      overview.refetch(),
      layout.refetch(),
      queryClient.refetchQueries({
        queryKey: planningProjectionQueryKey(session.workspace.id, eventId),
      }),
    ]).finally(() => Taro.stopPullDownRefresh());
  });

  const inaccessible = [overview.error, layout.error].some(
    (error) =>
      error instanceof ApiClientError &&
      (error.status === 403 || error.status === 404),
  );
  if (inaccessible) {
    return (
      <View className="planning-shell">
        <PageState
          action={messages.backToEvents}
          detail={messages.permissionLostDetail}
          onAction={() => void Taro.reLaunch({ url: "/pages/index/index" })}
          title={messages.permissionLostTitle}
        />
      </View>
    );
  }
  if (overview.isPending || layout.isPending) {
    return (
      <View className="planning-shell">
        <PageState
          detail={messages.planningDescription}
          title={messages.loading}
        />
      </View>
    );
  }
  if (
    overview.isError ||
    layout.isError ||
    overview.data === undefined ||
    layout.data === undefined
  ) {
    return (
      <View className="planning-shell">
        <PageState
          action={messages.retry}
          detail={online ? messages.errorDetail : messages.offlineDetail}
          onAction={() =>
            void Promise.all([overview.refetch(), layout.refetch()])
          }
          title={online ? messages.errorTitle : messages.offlineTitle}
        />
      </View>
    );
  }

  const event = overview.data.event;
  const preferences = {
    hourCycle: session.user.hourCycle,
    locale,
    timeZone: session.user.timeZone,
  } as const;

  return (
    <View className="planning-shell">
      <View className="planning-nav">
        <Button
          className="planning-nav__button"
          onClick={() => void Taro.navigateBack()}
        >
          {messages.backToEvents}
        </Button>
        {canEdit && pages.length > 0 ? (
          <Button
            className={
              arranging
                ? "planning-nav__button planning-nav__button--active"
                : "planning-nav__button"
            }
            disabled={saving}
            onClick={() => setArranging((current) => !current)}
          >
            {arranging ? messages.doneArranging : messages.arrangeLayout}
          </Button>
        ) : null}
      </View>
      <Text className="planning-eyebrow">{messages.planningWorkspace}</Text>
      <Text className="planning-title">{event.displayName}</Text>
      <Text className="planning-intro">{messages.planningDescription}</Text>

      {saving ? (
        <Text className="planning-notice">{messages.layoutSaving}</Text>
      ) : null}
      {saveIssue !== null ? (
        <View className="planning-alert">
          <Text className="planning-alert__title">
            {saveIssue === "conflict"
              ? messages.layoutConflictTitle
              : messages.layoutSaveFailed}
          </Text>
          {saveIssue === "conflict" ? (
            <Text className="planning-alert__detail">
              {messages.layoutConflictDetail}
            </Text>
          ) : null}
          <View className="planning-alert__actions">
            {saveIssue === "conflict" ? (
              <Button className="text-button" onClick={acceptCurrentLayout}>
                {messages.useCurrentLayout}
              </Button>
            ) : null}
            <Button
              className="text-button text-button--primary"
              onClick={() => void applyPendingToLatest()}
            >
              {saveIssue === "conflict"
                ? messages.keepMyLayout
                : messages.retryLayout}
            </Button>
          </View>
        </View>
      ) : null}

      {pages.length === 0 ? (
        <View className="planning-empty">
          <Text className="planning-empty__title">
            {messages.noPlanningPagesTitle}
          </Text>
          <Text className="planning-empty__detail">
            {messages.noPlanningPagesDetail}
          </Text>
          {canEdit ? (
            <Button
              className="planning-button"
              disabled={saving}
              onClick={openCreatePage}
            >
              {messages.addPage}
            </Button>
          ) : null}
        </View>
      ) : (
        <>
          <ScrollView className="page-tabs" scrollX showScrollbar={false}>
            <View className="page-tabs__track">
              {pages.map((page) => (
                <Button
                  className={
                    page.id === selectedPage?.id
                      ? "page-tab page-tab--active"
                      : "page-tab"
                  }
                  key={page.id}
                  onClick={() => setSelectedPageId(page.id)}
                >
                  {page.name}
                </Button>
              ))}
            </View>
          </ScrollView>

          {selectedPage && arranging ? (
            <View className="page-controls">
              <Button
                className="text-button"
                disabled={saving || pages[0]?.id === selectedPage.id}
                onClick={() =>
                  applyLayout(() => movePage(pages, selectedPage.id, -1))
                }
              >
                {messages.moveEarlier}
              </Button>
              <Button
                className="text-button"
                disabled={saving || pages.at(-1)?.id === selectedPage.id}
                onClick={() =>
                  applyLayout(() => movePage(pages, selectedPage.id, 1))
                }
              >
                {messages.moveLater}
              </Button>
              <Button
                className="text-button"
                disabled={saving}
                onClick={() => openRenamePage(selectedPage)}
              >
                {messages.renamePage}
              </Button>
              <Button
                className="text-button text-button--danger"
                disabled={saving}
                onClick={() => void deletePage(selectedPage)}
              >
                {messages.deletePage}
              </Button>
            </View>
          ) : null}

          {selectedPage?.components.length === 0 ? (
            <View className="planning-empty planning-empty--compact">
              <Text className="planning-empty__title">
                {messages.noPageComponentsTitle}
              </Text>
              <Text className="planning-empty__detail">
                {messages.noPageComponentsDetail}
              </Text>
            </View>
          ) : null}

          {selectedPage?.components.map((component, index) => (
            <ProjectionCard
              canEdit={canEdit && arranging}
              canMoveEarlier={index > 0}
              canMoveLater={index < selectedPage.components.length - 1}
              component={component}
              disabled={saving}
              eventId={eventId}
              key={component.id}
              onMoveEarlier={() =>
                applyLayout(() =>
                  moveComponent(pages, selectedPage.id, component.id, -1),
                )
              }
              onMoveLater={() =>
                applyLayout(() =>
                  moveComponent(pages, selectedPage.id, component.id, 1),
                )
              }
              onRemove={() => void deleteComponent(selectedPage, component.id)}
              preferences={preferences}
              workspaceId={session.workspace.id}
            />
          ))}

          {canEdit && arranging && selectedPage ? (
            <View className="layout-add-actions">
              <Button
                className="planning-button planning-button--secondary"
                disabled={saving}
                onClick={() => void chooseComponent(selectedPage)}
              >
                {messages.addComponent}
              </Button>
              <Button
                className="planning-button planning-button--secondary"
                disabled={saving}
                onClick={openCreatePage}
              >
                {messages.addPage}
              </Button>
            </View>
          ) : null}
        </>
      )}
      {pageNameIntent ? (
        <PageNameDialog
          error={pageNameError}
          intent={pageNameIntent}
          locale={locale}
          name={pageName}
          onCancel={() => setPageNameIntent(null)}
          onChange={(value) => {
            setPageName(value);
            setPageNameError(null);
          }}
          onSubmit={() => void submitPageName()}
        />
      ) : null}
    </View>
  );
}

export default function PlanningPage() {
  const route = useRouter();
  const session = useSession();
  const eventId =
    typeof route.params.id === "string" && route.params.id.length > 0
      ? route.params.id
      : null;
  const locale = resolveLocale(
    session.state.status === "ready"
      ? (session.state.session.user.locale ?? undefined)
      : undefined,
  );
  const messages = getMessages(locale);
  if (session.state.status === "ready" && eventId !== null) {
    return (
      <ReadyPlanningPage eventId={eventId} session={session.state.session} />
    );
  }
  return (
    <View className="planning-shell">
      <PageState
        action={messages.backToEvents}
        detail={
          eventId === null
            ? messages.permissionLostDetail
            : messages.errorDetail
        }
        onAction={() => void Taro.reLaunch({ url: "/pages/index/index" })}
        title={
          eventId === null ? messages.permissionLostTitle : messages.loading
        }
      />
    </View>
  );
}
