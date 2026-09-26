"use client";

import type { SessionResponse } from "@livtales/schemas";
import { useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";
import { ManageSpaceDialog } from "../features/spaces/manage-space-dialog";
import { NewSpaceDialog } from "../features/spaces/new-space-dialog";
import type { CarriedNotice } from "../lib/auth-session";

interface SpaceDialogs {
  readonly openNewSpace: () => void;
  readonly openManageSpace: () => void;
}

const SpaceDialogsContext = createContext<SpaceDialogs | null>(null);

/**
 * The space dialogs the switcher opens, New space and Manage space, shown
 * over whatever page is open. A space just created opens at once, with a
 * notice when friends could not be added to it; leaving a space opens the
 * account's own.
 */
export function SpaceDialogsProvider({
  session,
  homeWorkspaceId,
  onSwitch,
  children,
}: {
  readonly session: SessionResponse;
  readonly homeWorkspaceId: string;
  /** Opens a space; the notice shows once it has opened. */
  readonly onSwitch: (workspaceId: string, notice?: CarriedNotice) => void;
  readonly children: ReactNode;
}) {
  const t = useTranslations("spaces");
  const [open, setOpen] = useState<"new" | "manage" | null>(null);
  const dialogs = useMemo<SpaceDialogs>(
    () => ({
      openNewSpace: () => setOpen("new"),
      openManageSpace: () => setOpen("manage"),
    }),
    [],
  );
  return (
    <SpaceDialogsContext.Provider value={dialogs}>
      {children}
      {open === "new" ? (
        <NewSpaceDialog
          onClose={() => setOpen(null)}
          onCreated={(space, unadded) => {
            setOpen(null);
            onSwitch(
              space.id,
              unadded > 0
                ? { message: t("unadded", { count: unadded }), tone: "danger" }
                : undefined,
            );
          }}
        />
      ) : null}
      {open === "manage" ? (
        <ManageSpaceDialog
          session={session}
          onClose={() => setOpen(null)}
          onLeft={(notice) => {
            setOpen(null);
            onSwitch(homeWorkspaceId, notice);
          }}
        />
      ) : null}
    </SpaceDialogsContext.Provider>
  );
}

/** Opens the space dialogs; outside the shell, opening does nothing. */
export function useSpaceDialogs(): SpaceDialogs {
  return (
    useContext(SpaceDialogsContext) ?? {
      openNewSpace: () => undefined,
      openManageSpace: () => undefined,
    }
  );
}
