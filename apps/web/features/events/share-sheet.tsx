"use client";

import type { ShareResponse, ShareScope } from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import {
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ErrorNotice } from "../../components/feedback";
import { PlusIcon } from "../../components/icons";
import { useNotices } from "../../components/notices";
import { useMenuDismissal } from "../../components/quiet-menu";
import { useFriendsQuery } from "../../lib/friend-queries";
import { personInitials } from "../../lib/person-collection";
import {
  usePersonsQuery,
  useRevokeShare,
  useSessionQuery,
  useShareResource,
  useSharesQuery,
} from "../../lib/queries";
import { ShareWithPeople, shareRows } from "./share-with-people";

type SheetRole = "viewer" | "editor";

/** Whether a grant carries exactly this narrowing, or none when `scope` is null (the whole Event). */
export function grantHasScope(
  grant: Pick<ShareResponse, "scope">,
  scope: ShareScope | null,
): boolean {
  if (scope === null) return grant.scope === null;
  return (
    grant.scope !== null &&
    grant.scope.view === scope.view &&
    (grant.scope.sectionId ?? null) === (scope.sectionId ?? null)
  );
}

/**
 * Keeps the sheet against the viewport under the right edge of the head
 * or control that opened it, above it when only that side has room, and
 * re-places it as the page or a list scrolls. The sheet is fixed rather
 * than absolute because a section's head sits inside a scrolling list
 * that would clip it; on a phone the stylesheet makes it a bottom sheet
 * and the position is left alone.
 */
function useSheetPlacement(sheet: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const element = sheet.current;
    const opener = element?.parentElement;
    if (!element || !opener) return;
    const place = () => {
      if (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(max-width: 600px)").matches
      ) {
        element.style.left = "";
        element.style.top = "";
        element.style.maxHeight = "";
        return;
      }
      const gap = 6;
      const edge = 12;
      const anchor = opener.getBoundingClientRect();
      element.style.maxHeight = "";
      const height = element.offsetHeight;
      const below = window.innerHeight - anchor.bottom - gap - edge;
      const above = anchor.top - gap - edge;
      let top = anchor.bottom + gap;
      let room = below;
      if (height > below && height <= above) {
        top = anchor.top - gap - height;
        room = above;
      } else if (height > below) {
        room = Math.min(height, window.innerHeight - 2 * edge);
        top = Math.min(top, window.innerHeight - edge - room);
      }
      element.style.maxHeight = `${Math.max(160, room)}px`;
      const left = Math.min(
        Math.max(edge, anchor.right - element.offsetWidth),
        window.innerWidth - element.offsetWidth - edge,
      );
      element.style.top = `${Math.max(edge, top)}px`;
      element.style.left = `${left}px`;
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && element.contains(event.target))
        return;
      place();
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [sheet]);
}

/**
 * The sheet that shares an Event, one view of it, or one section of it,
 * under the control that opened it: the people who see it with their
 * role, Add people unfolding the picker, and Done. Escape and a press
 * outside close it; a keyboard close returns focus to the opener.
 */
export function ShareSheet({
  eventId,
  hint,
  name,
  onClose,
  scope,
}: {
  readonly eventId: string;
  readonly hint: string;
  /** What is shared, as people read it: the event's name, the view's, or the section's. */
  readonly name: string;
  readonly onClose: (byKeyboard: boolean) => void;
  /** The view or section shared, or null for the whole Event. */
  readonly scope: ShareScope | null;
}) {
  const t = useTranslations("share");
  const id = useId();
  const sheet = useRef<HTMLDivElement>(null);
  const { post } = useNotices();
  const shares = useSharesQuery(eventId, true);
  const share = useShareResource(eventId);
  const revoke = useRevokeShare();
  const session = useSessionQuery();
  const persons = usePersonsQuery();
  const friends = useFriendsQuery();
  const [adding, setAdding] = useState(false);
  useSheetPlacement(sheet);

  useEffect(() => {
    sheet.current
      ?.querySelector<HTMLElement>("select, button")
      ?.focus({ preventScroll: true });
  }, []);
  const contains = useCallback(
    (target: Node) => sheet.current?.parentElement?.contains(target) ?? false,
    [],
  );
  useMenuDismissal(true, contains, onClose);

  const held = useMemo(
    () =>
      (shares.data?.items ?? []).filter((grant) => grantHasScope(grant, scope)),
    [scope, shares.data],
  );
  // The picker offers the people who can be granted at once and do not
  // hold this share yet; a share that waits on an invitation is whole.
  const rows = useMemo(
    () =>
      shareRows({
        friends: friends.data?.friends ?? [],
        grants: held,
        me: session.data?.user.id,
        pending: [],
        people: persons.data?.items ?? [],
        sent: friends.data?.sent ?? [],
        workspaceId: session.data?.workspace.id,
        scope: "workspace",
      }).filter(
        (row) =>
          (row.kind === "friend" || row.kind === "member") &&
          row.held === undefined,
      ),
    [friends.data, held, persons.data, session.data],
  );

  function changeRole(grant: ShareResponse, role: SheetRole) {
    share.mutate(
      {
        principalId: grant.principal.id,
        role,
        ...(scope === null ? {} : { scope }),
      },
      { onSuccess: () => post({ message: t("changed") }) },
    );
  }

  function remove(grant: ShareResponse) {
    revoke.mutate(grant.id, {
      onSuccess: () => post({ message: t("removed") }),
    });
  }

  return (
    <div
      aria-labelledby={`${id}-title`}
      className="share-sheet"
      ref={sheet}
      role="dialog"
    >
      <h3 id={`${id}-title`}>{t("viewTitle", { name })}</h3>
      <p className="share-sheet-hint">{hint}</p>
      {shares.isError ? <ErrorNotice error={shares.error} /> : null}
      {held.length === 0 && !shares.isPending ? (
        <p className="share-sheet-empty">{t("nobody")}</p>
      ) : (
        <ul className="share-sheet-people">
          {held.map((grant) => (
            <li key={grant.id}>
              <span className="share-sheet-who">
                <span aria-hidden="true" className="person-avatar">
                  {personInitials(grant.principal.displayName)}
                </span>
                {grant.principal.displayName}
              </span>
              <select
                aria-label={t("roleFor", { name: grant.principal.displayName })}
                className="share-sheet-role"
                disabled={share.isPending}
                onChange={(input) =>
                  changeRole(grant, input.target.value as SheetRole)
                }
                value={grant.role}
              >
                <option value="viewer">{t("roles.viewer")}</option>
                <option value="editor">{t("roles.editor")}</option>
                {grant.role === "owner" ? (
                  <option value="owner">{t("roles.owner")}</option>
                ) : null}
              </select>
              <button
                aria-label={t("remove", { name: grant.principal.displayName })}
                className="share-sheet-remove"
                disabled={revoke.isPending}
                onClick={() => remove(grant)}
                type="button"
              >
                &#215;
              </button>
            </li>
          ))}
        </ul>
      )}
      {share.isError ? <ErrorNotice error={share.error} /> : null}
      {revoke.isError ? <ErrorNotice error={revoke.error} /> : null}
      {adding ? (
        <ShareWithPeople
          eventId={eventId}
          legend={t("addPeople")}
          rows={rows}
          scope={scope ?? undefined}
        />
      ) : (
        <button
          className="share-sheet-add"
          onClick={() => setAdding(true)}
          type="button"
        >
          <PlusIcon />
          <span>{t("addPeople")}</span>
        </button>
      )}
      <div className="share-sheet-foot">
        <button
          className="button button-quiet"
          onClick={() => onClose(true)}
          type="button"
        >
          {t("done")}
        </button>
      </div>
    </div>
  );
}
