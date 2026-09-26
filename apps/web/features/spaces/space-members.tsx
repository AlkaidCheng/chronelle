"use client";

import type { WorkspaceMember } from "@livtales/schemas";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";
import { ConfirmAction } from "../../components/confirm-action";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import { useNotices } from "../../components/notices";
import { useFriendsQuery } from "../../lib/friend-queries";
import { personInitials } from "../../lib/person-collection";
import {
  useAddWorkspaceMember,
  useChangeWorkspaceMemberRole,
  useRemoveWorkspaceMember,
  useSessionQuery,
  useWorkspaceMembersQuery,
} from "../../lib/queries";

type MemberRole = WorkspaceMember["role"];

/**
 * Members of the current space, each with their role. An Owner changes a
 * member's role (Owner, Editor, or Viewer; a Personal space has one Owner),
 * adds a friend with a role, and removes any member but the personal owner
 * and themselves. The personal owner's role and the last Owner's role are
 * fixed: a space keeps at least one Owner.
 */
export function SpaceMembersSection() {
  const t = useTranslations("members");
  const verbs = useTranslations("verbs");
  const confirm = useTranslations("confirm");
  const done = useTranslations("done");
  const { post } = useNotices();
  const id = useId();
  const session = useSessionQuery();
  const members = useWorkspaceMembersQuery();
  const friends = useFriendsQuery();
  const add = useAddWorkspaceMember();
  const changeRole = useChangeWorkspaceMemberRole();
  const remove = useRemoveWorkspaceMember();
  const [friendId, setFriendId] = useState("");
  const [role, setRole] = useState<MemberRole>("viewer");
  const me = session.data?.user.id;
  const items = members.data?.items ?? [];
  const mine = items.find((member) => member.userId === me);
  const isOwner = mine?.role === "owner";
  const personalSpace = items.some((member) => member.personal);
  const roleChoices: readonly MemberRole[] = personalSpace
    ? ["editor", "viewer"]
    : ["owner", "editor", "viewer"];
  const ownerCount = items.filter((member) => member.role === "owner").length;
  const fixedRole = (member: WorkspaceMember) =>
    member.personal || (member.role === "owner" && ownerCount === 1);
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
      <ul aria-label={t("title")} className="space-member-list">
        {items.map((member) => (
          <li className="space-member" key={member.userId}>
            <span aria-hidden="true" className="person-avatar">
              {personInitials(member.displayName)}
            </span>
            <span className="space-member-name">
              {member.displayName}
              <small className="space-member-detail">
                {[
                  member.email,
                  member.personal ? t("personal") : null,
                  member.friendId !== null ? t("friend") : null,
                ]
                  .filter((part) => part !== null)
                  .join(" \u00b7 ")}
              </small>
            </span>
            {isOwner && !fixedRole(member) ? (
              <select
                aria-label={t("roleFor", { name: member.displayName })}
                className="space-role-select"
                disabled={changeRole.isPending}
                onChange={(event) =>
                  changeRole.mutate({
                    userId: member.userId,
                    role: event.target.value as MemberRole,
                  })
                }
                value={member.role}
              >
                {roleChoices.map((choice) => (
                  <option key={choice} value={choice}>
                    {t(`roles.${choice}`)}
                  </option>
                ))}
              </select>
            ) : (
              <span
                className="space-role-fixed"
                title={
                  member.role === "owner" && !member.personal
                    ? t("lastOwner")
                    : undefined
                }
              >
                {t(`roles.${member.role}`)}
              </span>
            )}
            {isOwner && !member.personal && member.userId !== me ? (
              <ConfirmAction
                className="space-member-remove"
                disabled={remove.isPending}
                label={verbs("removeMember")}
                onConfirm={() =>
                  remove.mutate(member.userId, {
                    onSuccess: () => post({ message: done("memberRemoved") }),
                  })
                }
                pending={remove.isPending}
                question={confirm("removeMember", {
                  name: member.displayName,
                })}
                trigger={<span aria-hidden="true">&#215;</span>}
              />
            ) : (
              <span className="space-member-slot" />
            )}
          </li>
        ))}
      </ul>
      {remove.isError ? <ErrorNotice error={remove.error} /> : null}
      {changeRole.isError ? <ErrorNotice error={changeRole.error} /> : null}
      {isOwner ? (
        choices.length === 0 ? (
          <p className="settings-note">{t("noFriends")}</p>
        ) : (
          <form className="members-add-row" onSubmit={handleAdd}>
            <label className="space-member-add">
              <span className="visually-hidden" id={`${id}-friend`}>
                {t("friend")}
              </span>
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
            <select
              aria-label={t("access")}
              className="space-role-select"
              onChange={(input) => setRole(input.target.value as MemberRole)}
              value={role}
            >
              {roleChoices.map((choice) => (
                <option key={choice} value={choice}>
                  {t(`roles.${choice}`)}
                </option>
              ))}
            </select>
            <button
              className="button button-secondary"
              disabled={add.isPending}
              type="submit"
            >
              {t("add")}
            </button>
          </form>
        )
      ) : null}
      {add.isError ? <ErrorNotice error={add.error} /> : null}
    </div>
  );
}
