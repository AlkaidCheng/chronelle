"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";

import { ErrorNotice, LoadingState } from "../../components/feedback";
import { useFriendsQuery } from "../../lib/friend-queries";
import { personInitials } from "../../lib/person-collection";
import {
  useAddWorkspaceMember,
  useRemoveWorkspaceMember,
  useSessionQuery,
  useWorkspaceMembersQuery,
} from "../../lib/queries";

type MemberRole = "editor" | "viewer";

/**
 * Members of the current workspace: each member with their role, and for
 * an Owner, a friend to add as viewer or editor (or whose role to change)
 * and Remove on every member but the personal owner and themselves.
 */
export function MembersSection() {
  const t = useTranslations("members");
  const id = useId();
  const session = useSessionQuery();
  const members = useWorkspaceMembersQuery();
  const friends = useFriendsQuery();
  const add = useAddWorkspaceMember();
  const remove = useRemoveWorkspaceMember();
  const [friendId, setFriendId] = useState("");
  const [role, setRole] = useState<MemberRole>("viewer");
  const me = session.data?.user.id;
  const mine = members.data?.items.find((member) => member.userId === me);
  const isOwner = mine?.role === "owner";
  const choices = (friends.data?.friends ?? []).filter(
    (friend) =>
      !members.data?.items.some((member) => member.userId === friend.userId),
  );
  const chosen =
    friendId === "" ? choices[0] : choices.find((f) => f.id === friendId);

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (chosen === undefined) return;
    add.mutate(
      { friendId: chosen.id, role },
      { onSuccess: () => setFriendId("") },
    );
  }

  if (members.isError)
    return (
      <ErrorNotice
        error={members.error}
        onRefresh={() => void members.refetch()}
      />
    );
  if (members.data === undefined) return <LoadingState label={t("loading")} />;
  return (
    <div className="members-section">
      <ul aria-label={t("title")} className="friends-list members-list">
        {members.data.items.map((member) => (
          <li className="friends-row" key={member.userId}>
            <span aria-hidden="true" className="friend-mark">
              {personInitials(member.displayName)}
            </span>
            <div className="friends-row-body">
              <p>
                <strong>{member.displayName}</strong>
                <span className="friends-meta">
                  {member.email ?? ""}
                  {member.personal ? ` \u00b7 ${t("personal")}` : ""}
                  {member.friendId !== null ? ` \u00b7 ${t("friend")}` : ""}
                </span>
              </p>
            </div>
            <span className={`status-chip status-${member.role}`}>
              {t(`roles.${member.role}`)}
            </span>
            {isOwner && !member.personal && member.userId !== me ? (
              <button
                className="button button-quiet button-small"
                disabled={remove.isPending}
                onClick={() => remove.mutate(member.userId)}
                type="button"
              >
                {t("remove")}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {remove.isError ? <ErrorNotice error={remove.error} /> : null}
      {isOwner ? (
        <form className="members-add surface-subtle" onSubmit={handleAdd}>
          <span className="share-group-title">{t("addFriend")}</span>
          {choices.length === 0 ? (
            <p className="field-hint">{t("noFriends")}</p>
          ) : (
            <div className="members-add-row">
              <label className="field field-wide">
                <span id={`${id}-friend`}>{t("friend")}</span>
                <select
                  aria-labelledby={`${id}-friend`}
                  onChange={(input) => setFriendId(input.target.value)}
                  value={chosen?.id ?? ""}
                >
                  {choices.map((friend) => (
                    <option key={friend.id} value={friend.id}>
                      {friend.displayName}
                      {friend.email === null ? "" : ` (${friend.email})`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span id={`${id}-role`}>{t("access")}</span>
                <select
                  aria-labelledby={`${id}-role`}
                  onChange={(input) =>
                    setRole(input.target.value as MemberRole)
                  }
                  value={role}
                >
                  <option value="viewer">{t("roles.viewer")}</option>
                  <option value="editor">{t("roles.editor")}</option>
                </select>
              </label>
              <button
                className="button button-primary"
                disabled={add.isPending}
                type="submit"
              >
                {t("add")}
              </button>
            </div>
          )}
          {add.isError ? <ErrorNotice error={add.error} /> : null}
        </form>
      ) : null}
    </div>
  );
}
