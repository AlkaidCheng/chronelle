"use client";

import { ApiClientError } from "@livtales/api-client";
import type {
  ObjectMoveCounts,
  ObjectMovePreview,
  SessionResponse,
} from "@livtales/schemas";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { EditorDialogHeader } from "../../components/editor-dialog-controls";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import { WorkspaceMark } from "../../components/workspace-mark";
import { useAuthSession } from "../../lib/auth-session";
import { newId } from "../../lib/new-id";
import {
  useMoveEvent,
  useMovePreviewQuery,
  useMoveTargetsQuery,
} from "../../lib/queries";
import { useSessionDialog } from "../../lib/use-session-dialog";
import { useWorkspaceIdentity } from "../../lib/use-workspace-identity";

/** The record kinds "Moves with it" counts, in the order it lists them. */
const countedKinds = [
  "scheduleItems",
  "todos",
  "subtasks",
  "expenses",
  "reminders",
  "notes",
  "files",
  "inTrash",
] as const satisfies readonly (keyof ObjectMoveCounts)[];

const knownObjectTypes = new Set([
  "event",
  "task",
  "expense",
  "reminder",
  "document",
  "person",
  "note",
]);

/**
 * Move to space: an Owner of the Event's space chooses another space they
 * can add records to, reviews what moves with the Event, what stays behind,
 * the links the move removes, and who can see it after, then moves it. The
 * app then opens the Event in its new space with a notice that offers the
 * old one.
 */
export function MoveToSpaceDialog({
  event,
  session,
  onClose,
}: {
  readonly event: { readonly id: string; readonly displayName: string };
  readonly session: SessionResponse;
  readonly onClose: () => void;
}) {
  const t = useTranslations("spaces.move");
  const roles = useTranslations("members.roles");
  const id = useId();
  const dialog = useSessionDialog(onClose);
  const router = useRouter();
  const { switchWorkspace } = useAuthSession();
  const identityOf = useWorkspaceIdentity(session);
  const targets = useMoveTargetsQuery(event.id);
  const [chosen, setChosen] = useState<string | null>(null);
  const [step, setStep] = useState<"choose" | "review">("choose");
  const preview = useMovePreviewQuery(
    event.id,
    step === "review" ? chosen : null,
  );
  const move = useMoveEvent(event.id);
  const [changed, setChanged] = useState(false);
  // One move keeps its command id across retries, so a repeat after a lost
  // response returns the first result; another space starts a new one.
  const commandIds = useRef(new Map<string, string>());
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const items = targets.data?.items ?? [];
  const allowed = items.filter((target) => target.allowed);
  const selected = chosen ?? allowed[0]?.workspace.id ?? null;

  useEffect(() => {
    if (step === "review") reviewHeading.current?.focus();
  }, [step]);

  function close() {
    if (!move.isPending) onClose();
  }

  function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (step === "choose") {
      if (selected === null) return;
      setChosen(selected);
      setChanged(false);
      move.reset();
      setStep("review");
      return;
    }
    const reviewed = preview.data;
    if (reviewed === undefined || chosen === null || move.isPending) return;
    setChanged(false);
    const commandId = commandIds.current.get(chosen) ?? newId();
    commandIds.current.set(chosen, commandId);
    const from = identityOf(reviewed.from).title;
    const to = identityOf(reviewed.to).title;
    move.mutate(
      {
        workspaceId: chosen,
        expectedDroppedLinks: reviewed.expectedDroppedLinks,
        commandId,
      },
      {
        onSuccess: ({ move: result }) => {
          const removed = result.droppedLinks + result.unassignedTasks;
          switchWorkspace(result.to.id, {
            message:
              removed === 0
                ? t("moved", { name: event.displayName, space: to })
                : t("movedRemoving", {
                    name: event.displayName,
                    space: to,
                    count: removed,
                  }),
            action: {
              label: t("open", { space: from }),
              run: async (opened) => {
                opened.switchWorkspace(result.from.id);
                router.replace("/events");
              },
            },
          });
        },
        onError: (error) => {
          if (
            error instanceof ApiClientError &&
            error.code === "move_changed"
          ) {
            setChanged(true);
            void preview.refetch();
          }
        },
      },
    );
  }

  const reviewed = step === "review" ? preview.data : undefined;
  const title =
    reviewed === undefined
      ? t("title")
      : t("go", { space: identityOf(reviewed.to).title });
  const removing = reviewed?.expectedDroppedLinks ?? 0;

  return (
    <dialog
      ref={dialog}
      className="event-create-dialog move-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(cancelEvent) => {
        cancelEvent.preventDefault();
        close();
      }}
    >
      <EditorDialogHeader
        headingId={`${id}-title`}
        title={title}
        closeLabel={t("close")}
        isPending={move.isPending}
        onClose={close}
      />
      <form onSubmit={submit} aria-busy={move.isPending}>
        <div className="event-create-body move-dialog-body">
          {step === "choose" ? (
            targets.isPending ? (
              <LoadingState label={t("loading")} />
            ) : targets.isError ? (
              <ErrorNotice error={targets.error} />
            ) : (
              <>
                <div
                  aria-label={t("spaces")}
                  className="move-targets"
                  role="radiogroup"
                >
                  {items.map((target) => {
                    const identity = identityOf(target.workspace);
                    const checked = target.workspace.id === selected;
                    return (
                      <label
                        className={[
                          "move-target",
                          target.allowed ? null : "is-unavailable",
                          checked ? "is-selected" : null,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        key={target.workspace.id}
                      >
                        <input
                          checked={checked}
                          className="move-target-radio"
                          disabled={!target.allowed}
                          name={`${id}-target`}
                          onChange={() => setChosen(target.workspace.id)}
                          type="radio"
                          value={target.workspace.id}
                        />
                        <WorkspaceMark mark={identity.mark} />
                        <span className="move-target-name">
                          {identity.title}
                          <small className="move-target-detail">
                            {t("members", {
                              role:
                                target.workspace.role === null
                                  ? ""
                                  : roles(target.workspace.role),
                              count: target.memberCount,
                            })}
                          </small>
                        </span>
                        {target.current ? (
                          <span className="move-target-note">{t("here")}</span>
                        ) : target.allowed ? null : (
                          <span className="move-target-note">
                            {t("cannot")}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
                {allowed.length === 0 ? (
                  <p className="field-hint">{t("noOther")}</p>
                ) : null}
              </>
            )
          ) : preview.isPending ? (
            <LoadingState label={t("reviewing")} />
          ) : preview.isError ? (
            <ErrorNotice error={preview.error} />
          ) : (
            <MoveReview
              headingRef={reviewHeading}
              preview={preview.data}
              session={session}
            />
          )}
          {changed ? (
            <p className="move-changed" role="alert">
              {t("changed")}
            </p>
          ) : null}
          {move.isError &&
          !(
            move.error instanceof ApiClientError &&
            move.error.code === "move_changed"
          ) ? (
            <ErrorNotice error={move.error} />
          ) : null}
        </div>
        <footer className="event-create-footer">
          <button
            className="button button-quiet"
            disabled={move.isPending}
            onClick={step === "choose" ? close : () => setStep("choose")}
            type="button"
          >
            {step === "choose" ? t("cancel") : t("back")}
          </button>
          <button
            className="button button-primary"
            disabled={
              move.isPending ||
              (step === "choose"
                ? selected === null
                : reviewed === undefined || preview.isFetching)
            }
            type="submit"
          >
            {step === "choose"
              ? t("continue")
              : move.isPending
                ? t("moving")
                : removing > 0
                  ? t("goRemoving", { count: removing })
                  : title}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

/** What the move carries, removes, leaves behind, and who sees it after. */
function MoveReview({
  headingRef,
  preview,
  session,
}: {
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly preview: ObjectMovePreview;
  readonly session: SessionResponse;
}) {
  const t = useTranslations("spaces.move");
  const roles = useTranslations("members.roles");
  const types = useTranslations("objectTypes");
  const identityOf = useWorkspaceIdentity(session);
  const from = identityOf(preview.from).title;
  const to = identityOf(preview.to).title;
  const kindOf = (objectType: string) =>
    knownObjectTypes.has(objectType)
      ? types(objectType as "event")
      : objectType;
  const more = (list: { readonly items: readonly unknown[]; total: number }) =>
    list.total > list.items.length ? (
      <li className="move-fact-item move-more">
        {t("more", { count: list.total - list.items.length })}
      </li>
    ) : null;
  const { access } = preview;
  const members =
    access.targetMembers.owner +
    access.targetMembers.editor +
    access.targetMembers.viewer;
  const staysBehind =
    preview.peopleKept.total + preview.labels.total + preview.clearedLinks > 0;
  const headingId = useId();

  return (
    <div className="move-facts">
      <section className="move-fact" aria-labelledby={headingId}>
        <h3
          className="move-fact-title"
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
        >
          {t("moves")}
        </h3>
        <ul className="move-fact-list">
          {countedKinds.map((kind) =>
            preview.moves[kind] === 0 ? null : (
              <li className="move-fact-item" key={kind}>
                {t(`count.${kind}`, { count: preview.moves[kind] })}
              </li>
            ),
          )}
          <li className="move-fact-item">{t("movesRest")}</li>
        </ul>
      </section>
      {preview.expectedDroppedLinks > 0 ? (
        <section
          className="move-fact move-warning"
          aria-labelledby={`${headingId}-removed`}
        >
          <h3 className="move-fact-title" id={`${headingId}-removed`}>
            {t("removed")}
          </h3>
          <p className="move-warning-intro">
            {t("removedIntro", { space: from })}
          </p>
          <ul className="move-fact-list">
            {preview.droppedLinks.items.map((link) => (
              <li className="move-fact-item" key={link.relationId}>
                {t("linkedTo", {
                  other: link.other.displayName,
                  kind: kindOf(link.other.objectType),
                  record: link.scoped.displayName,
                })}
              </li>
            ))}
            {more(preview.droppedLinks)}
            {preview.unassignedTasks.items.map((task) => (
              <li className="move-fact-item" key={task.taskId}>
                {t("unassigned", {
                  task: task.displayName,
                  person: task.person.displayName,
                })}
              </li>
            ))}
            {more(preview.unassignedTasks)}
          </ul>
        </section>
      ) : null}
      {staysBehind ? (
        <section className="move-fact" aria-labelledby={`${headingId}-stays`}>
          <h3 className="move-fact-title" id={`${headingId}-stays`}>
            {t("stays")}
          </h3>
          <ul className="move-fact-list">
            {preview.peopleKept.items.map((person) => (
              <li className="move-fact-item" key={person.id}>
                {t("personStays", { name: person.displayName, space: from })}
              </li>
            ))}
            {more(preview.peopleKept)}
            {preview.labels.items.map((label) => (
              <li className="move-fact-item" key={label.name}>
                {label.existing
                  ? t("labelJoins", { name: label.name, space: to })
                  : t("labelCreated", { name: label.name, space: to })}
              </li>
            ))}
            {more(preview.labels)}
            {preview.clearedLinks > 0 ? (
              <li className="move-fact-item">
                {t("cleared", { count: preview.clearedLinks })}
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}
      <section className="move-fact" aria-labelledby={`${headingId}-after`}>
        <h3 className="move-fact-title" id={`${headingId}-after`}>
          {t("after")}
        </h3>
        <ul className="move-fact-list">
          <li className="move-fact-item">
            {t("targetMembers", { space: to, count: members })}
          </li>
          {access.keepingShares.items.map((share) => (
            <li className="move-fact-item" key={share.userId}>
              {t("keepsShare", {
                name: share.displayName,
                role: roles(share.role),
              })}
            </li>
          ))}
          {more(access.keepingShares)}
          {access.droppedGrants.items.map((grant) => (
            <li className="move-fact-item" key={grant.userId}>
              {t("coveredShare", { name: grant.displayName, space: to })}
            </li>
          ))}
          {more(access.droppedGrants)}
          {access.losingAccess.items.map((account) => (
            <li className="move-fact-item" key={account.userId}>
              {t("losesAccess", { name: account.displayName, space: from })}
            </li>
          ))}
          {more(access.losingAccess)}
          {access.lapsingShares > 0 ? (
            <li className="move-fact-item">
              {t("lapsing", { count: access.lapsingShares })}
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
