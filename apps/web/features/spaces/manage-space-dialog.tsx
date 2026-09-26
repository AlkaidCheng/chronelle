"use client";

import type { SessionResponse } from "@livtales/schemas";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AlertIcon, InfoIcon, PeopleIcon } from "../../components/icons";
import { SectionDialog } from "../../components/section-dialog";
import { WorkspaceMark } from "../../components/workspace-mark";
import { useCurrentWorkspaceIdentity } from "../../lib/use-workspace-identity";
import { SpaceMembersSection } from "./space-members";
import { SpaceGeneralSection, SpaceLeaveSection } from "./space-sections";

type ManageSpaceSection = "general" | "members" | "danger";

/**
 * Manage space, over the page it opens from: the space's mark and name
 * above its sections (General, Members, and Danger zone), the chosen
 * one at the right. Closing returns to the page as it was; leaving the
 * space opens the account's own.
 */
export function ManageSpaceDialog({
  session,
  onClose,
  onLeft,
}: {
  readonly session: SessionResponse;
  readonly onClose: () => void;
  readonly onLeft: () => void;
}) {
  const t = useTranslations("spaces");
  const identity = useCurrentWorkspaceIdentity(session);
  const [current, setCurrent] = useState<ManageSpaceSection>("members");
  return (
    <SectionDialog
      label={t("manageSpace")}
      heading={
        <span className="section-dialog-space">
          <WorkspaceMark mark={identity.mark} />
          <span className="section-dialog-space-name">{identity.title}</span>
        </span>
      }
      sections={[
        { id: "general", label: t("general"), icon: <InfoIcon /> },
        { id: "members", label: t("members"), icon: <PeopleIcon /> },
        {
          id: "danger",
          label: t("danger"),
          icon: <AlertIcon />,
          tone: "danger",
        },
      ]}
      current={current}
      onSelect={(id) => setCurrent(id as ManageSpaceSection)}
      onClose={onClose}
      closeLabel={t("close")}
    >
      {current === "general" ? (
        <SpaceGeneralSection session={session} />
      ) : current === "members" ? (
        <SpaceMembersSection />
      ) : (
        <SpaceLeaveSection session={session} onLeft={onLeft} />
      )}
    </SectionDialog>
  );
}
