"use client";

import type { AccessibleWorkspace, WorkspaceMember } from "@livtales/schemas";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { CountedField } from "../../components/counted-field";
import { EditorDialogHeader } from "../../components/editor-dialog-controls";
import { ErrorNotice } from "../../components/feedback";
import { useFriendsQuery } from "../../lib/friend-queries";
import { personInitials } from "../../lib/person-collection";
import { useCreateSpace, useSessionQuery } from "../../lib/queries";
import { useSessionDialog } from "../../lib/use-session-dialog";

type MemberRole = WorkspaceMember["role"];

interface ChosenMember {
  readonly friendId: string;
  readonly role: MemberRole;
}

const memberRoles: readonly MemberRole[] = ["owner", "editor", "viewer"];

/**
 * New space: its name and the friends it is shared with, each with a role
 * (Owner, Editor, or Viewer); the account creating it is its Owner. Create
 * space opens the new space; `unadded` counts the friends who could not be
 * added to it.
 */
export function NewSpaceDialog({
  onClose,
  onCreated,
}: {
  readonly onClose: () => void;
  readonly onCreated: (space: AccessibleWorkspace, unadded: number) => void;
}) {
  const t = useTranslations("spaces");
  const roles = useTranslations("members.roles");
  const id = useId();
  const dialog = useSessionDialog(onClose);
  const session = useSessionQuery();
  const friends = useFriendsQuery();
  const create = useCreateSpace();
  const [name, setName] = useState("");
  const [members, setMembers] = useState<readonly ChosenMember[]>([]);
  const nameInput = useRef<HTMLInputElement>(null);
  const known = friends.data?.friends ?? [];
  const available = known.filter(
    (friend) => !members.some((member) => member.friendId === friend.id),
  );

  useEffect(() => nameInput.current?.focus(), []);

  function close() {
    if (!create.isPending) onClose();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = name.trim();
    if (displayName === "" || create.isPending) return;
    create.mutate(
      { displayName, members },
      {
        onSuccess: ({ space, unadded }) => onCreated(space, unadded.length),
      },
    );
  }

  const roleSelect = (
    label: string,
    value: MemberRole,
    onChange: (role: MemberRole) => void,
  ) => (
    <select
      aria-label={label}
      className="space-role-select"
      disabled={create.isPending}
      onChange={(event) => onChange(event.target.value as MemberRole)}
      value={value}
    >
      {memberRoles.map((role) => (
        <option key={role} value={role}>
          {roles(role)}
        </option>
      ))}
    </select>
  );

  return (
    <dialog
      ref={dialog}
      className="event-create-dialog space-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <EditorDialogHeader
        headingId={`${id}-title`}
        title={t("newSpace")}
        closeLabel={t("close")}
        isPending={create.isPending}
        onClose={close}
      />
      <form onSubmit={submit} aria-busy={create.isPending}>
        <div className="event-create-body">
          <CountedField
            disabled={create.isPending}
            hint={t("nameHint")}
            inputRef={nameInput}
            label={t("name")}
            limit={80}
            onChange={setName}
            required
            value={name}
          />
          <fieldset className="space-members">
            <legend>{t("members")}</legend>
            <ul className="space-member-list" aria-label={t("members")}>
              <li className="space-member">
                <span aria-hidden="true" className="person-avatar">
                  {personInitials(session.data?.user.displayName ?? "")}
                </span>
                <span className="space-member-name">
                  {session.data?.user.displayName}
                  <small className="space-member-detail">{t("you")}</small>
                </span>
                <span className="space-role-fixed">{roles("owner")}</span>
                <span className="space-member-slot" />
              </li>
              {members.map((member) => {
                const friend = known.find(
                  (item) => item.id === member.friendId,
                );
                const displayName = friend?.displayName ?? "";
                return (
                  <li className="space-member" key={member.friendId}>
                    <span aria-hidden="true" className="person-avatar">
                      {personInitials(displayName)}
                    </span>
                    <span className="space-member-name">
                      {displayName}
                      {friend?.email ? (
                        <small className="space-member-detail">
                          {friend.email}
                        </small>
                      ) : null}
                    </span>
                    {roleSelect(
                      t("roleFor", { name: displayName }),
                      member.role,
                      (role) =>
                        setMembers((current) =>
                          current.map((item) =>
                            item.friendId === member.friendId
                              ? { ...item, role }
                              : item,
                          ),
                        ),
                    )}
                    <button
                      aria-label={t("remove", { name: displayName })}
                      className="space-member-remove"
                      disabled={create.isPending}
                      onClick={() =>
                        setMembers((current) =>
                          current.filter(
                            (item) => item.friendId !== member.friendId,
                          ),
                        )
                      }
                      type="button"
                    >
                      &#215;
                    </button>
                  </li>
                );
              })}
            </ul>
            {known.length === 0 ? (
              <p className="field-hint">{t("noFriends")}</p>
            ) : available.length === 0 ? null : (
              <label className="space-member-add">
                <span className="visually-hidden">{t("addFriend")}</span>
                <select
                  disabled={create.isPending}
                  onChange={(event) => {
                    const friendId = event.target.value;
                    if (friendId === "") return;
                    setMembers((current) => [
                      ...current,
                      { friendId, role: "editor" },
                    ]);
                  }}
                  value=""
                >
                  <option value="">{t("addFriend")}</option>
                  {available.map((friend) => (
                    <option key={friend.id} value={friend.id}>
                      {friend.displayName}
                      {friend.email === null ? "" : ` (${friend.email})`}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </fieldset>
          {create.isError ? <ErrorNotice error={create.error} /> : null}
        </div>
        <footer className="event-create-footer">
          <button
            className="button button-quiet"
            disabled={create.isPending}
            onClick={close}
            type="button"
          >
            {t("cancel")}
          </button>
          <button
            className="button button-primary"
            disabled={create.isPending || name.trim() === ""}
            type="submit"
          >
            {create.isPending ? t("creating") : t("create")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
