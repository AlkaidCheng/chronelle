"use client";

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuthSession } from "./auth-session";
import type { CommandHistory } from "./commands";

interface PageHistory {
  readonly page: CommandHistory | null;
  readonly setPage: Dispatch<SetStateAction<CommandHistory | null>>;
}

const Context = createContext<PageHistory | null>(null);

/**
 * Holds the stack a page's Undo edit and its keys act on while a page that
 * shows a shared record is open. It sits above the shell, whose keys read it.
 */
export function CommandHistoryProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [page, setPage] = useState<CommandHistory | null>(null);
  const value = useMemo(() => ({ page, setPage }), [page]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** The stack Undo edit acts on here: the open page's, else the session's; none signed out. */
export function useCommandHistory(): CommandHistory | null {
  const page = useContext(Context)?.page ?? null;
  const { credential } = useAuthSession();
  if (credential === null) return null;
  return page ?? { workspaceId: credential.workspaceId };
}

/**
 * Names the record a page shows. When it lives in another workspace, the
 * page's Undo edit acts on the caller's stack there for as long as the page
 * is open, since the edits made on the page are kept there.
 */
export function usePageCommandHistory(
  record: { readonly id: string; readonly workspaceId: string } | undefined,
) {
  const setPage = useContext(Context)?.setPage;
  const { credential } = useAuthSession();
  const sessionWorkspaceId = credential?.workspaceId;
  const id = record?.id;
  const workspaceId = record?.workspaceId;
  useEffect(() => {
    if (
      setPage === undefined ||
      id === undefined ||
      workspaceId === undefined ||
      workspaceId === sessionWorkspaceId
    )
      return;
    const history: CommandHistory = { workspaceId, objectId: id };
    setPage(history);
    return () => setPage((current) => (current === history ? null : current));
  }, [id, sessionWorkspaceId, setPage, workspaceId]);
}
