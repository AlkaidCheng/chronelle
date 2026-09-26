"use client";

import type { SessionResponse, WorkspaceMember } from "@livtales/schemas";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { ConfirmAction } from "../../components/confirm-action";
import { CountedField } from "../../components/counted-field";
import { ErrorNotice } from "../../components/feedback";
import { useNotices } from "../../components/notices";
import {
  useLeaveSpace,
  useRenameSpace,
  useWorkspaceMembersQuery,
} from "../../lib/queries";
import type { CarriedNotice } from "../../lib/auth-session";
import { useCurrentWorkspaceIdentity } from "../../lib/use-workspace-identity";
import { currentWorkspace } from "../../lib/workspace-identity";

/**
 * A space's name and the account's role in it. Its Owners rename a shared
 * space; a Personal space keeps its name.
 */
export function SpaceGeneralSection({
  session,
}: {
  readonly session: SessionResponse;
}) {
  const t = useTranslations("spaces");
  const roles = useTranslations("members.roles");
  const { post } = useNotices();
  const space = currentWorkspace(session);
  const identity = useCurrentWorkspaceIdentity(session);
  const rename = useRenameSpace();
  const [name, setName] = useState(space.displayName);
  const canRename = space.role === "owner" && !space.personal;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = name.trim();
    if (displayName === "" || displayName === space.displayName) return;
    rename.mutate(displayName, {
      onSuccess: (renamed) =>
        post({ message: t("renamed", { name: renamed.displayName }) }),
    });
  }

  return (
    <div className="settings-preferences">
      {canRename ? (
        <form className="settings-name" onSubmit={submit}>
          <CountedField
            className="settings-name-field"
            disabled={rename.isPending}
            label={t("name")}
            limit={80}
            onChange={setName}
            required
            value={name}
          />
          <button
            className="button button-secondary"
            disabled={
              rename.isPending ||
              name.trim() === "" ||
              name.trim() === space.displayName
            }
            type="submit"
          >
            {t("saveName")}
          </button>
        </form>
      ) : (
        <dl className="settings-facts">
          <div>
            <dt>{t("name")}</dt>
            <dd>{identity.title}</dd>
          </div>
        </dl>
      )}
      {space.personal ? (
        <p className="settings-note">{t("personalName")}</p>
      ) : null}
      {rename.isError ? <ErrorNotice error={rename.error} /> : null}
      <dl className="settings-facts">
        <div>
          <dt>{t("yourRole")}</dt>
          <dd>{space.role === null ? "" : roles(space.role)}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Leaving the current space: any member but the Owner of a Personal space
 * leaves; the last Owner of a shared space makes another member an Owner
 * first. `onLeft` opens another space, with the notice to show there.
 */
export function SpaceLeaveSection({
  session,
  onLeft,
}: {
  readonly session: SessionResponse;
  readonly onLeft: (notice: CarriedNotice) => void;
}) {
  const t = useTranslations("spaces");
  const space = currentWorkspace(session);
  const identity = useCurrentWorkspaceIdentity(session);
  const members = useWorkspaceMembersQuery();
  const leave = useLeaveSpace();
  const owners = (members.data?.items ?? []).filter(
    (member: WorkspaceMember) => member.role === "owner",
  );
  const lastOwner = space.role === "owner" && owners.length <= 1;

  if (space.personal)
    return <p className="settings-note">{t("personalStays")}</p>;
  return (
    <div className="settings-row">
      <div>
        <h3>{t("leave")}</h3>
        <p>{lastOwner ? t("lastOwnerLeave") : t("leaveNote")}</p>
      </div>
      <ConfirmAction
        className="button button-secondary"
        disabled={lastOwner || leave.isPending}
        label={t("leave")}
        onConfirm={() =>
          leave.mutate(undefined, {
            onSuccess: () =>
              onLeft({ message: t("left", { name: identity.title }) }),
          })
        }
        pending={leave.isPending}
        question={t("leaveQuestion", { name: identity.title })}
      />
      {leave.isError ? <ErrorNotice error={leave.error} /> : null}
    </div>
  );
}
