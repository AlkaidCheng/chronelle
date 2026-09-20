"use client";

import { useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { useErrorMessage } from "./feedback";

/** A short outcome shown at the foot of the page, with one optional action. */
export interface PostedNotice {
  readonly message: string;
  readonly action?: {
    readonly label: string;
    /** Runs the action; a rejection replaces the notice with its message. */
    readonly run: () => Promise<unknown>;
  };
  /**
   * Runs once the notice has left without its action: after its time, or
   * on its close button. A step held back for the action's window lands
   * here.
   */
  readonly onSettle?: () => void;
}

interface NoticeEntry extends PostedNotice {
  readonly id: number;
  readonly tone: "success" | "danger";
}

const dismissAfterMs = 8000;
const shownAtOnce = 3;

const NoticesContext = createContext<((notice: PostedNotice) => void) | null>(
  null,
);

/**
 * Keeps the notices posted by mutations and shows the newest few; each one
 * leaves after a while, on its close button, or once its action has run.
 */
export function NoticesProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [entries, setEntries] = useState<readonly NoticeEntry[]>([]);
  const counter = useRef(0);
  // The settle steps of the notices still waiting; one runs when its
  // notice leaves without its action, whether by time, by the close
  // button, or by being pushed out by newer notices.
  const settles = useRef(new Map<number, () => void>());
  const settle = useCallback((id: number) => {
    const step = settles.current.get(id);
    settles.current.delete(id);
    step?.();
  }, []);
  const dismiss = useCallback(
    (id: number, acted = false) => {
      setEntries((current) => current.filter((entry) => entry.id !== id));
      if (acted) settles.current.delete(id);
      else settle(id);
    },
    [settle],
  );
  const post = useCallback(
    (notice: PostedNotice) => {
      const id = ++counter.current;
      if (notice.onSettle !== undefined)
        settles.current.set(id, notice.onSettle);
      setEntries((current) => {
        const kept = current.slice(1 - shownAtOnce);
        for (const pushed of current.slice(0, current.length - kept.length))
          settle(pushed.id);
        return [...kept, { ...notice, id, tone: "success" }];
      });
      window.setTimeout(() => dismiss(id), dismissAfterMs);
    },
    [dismiss, settle],
  );
  const fail = useCallback((id: number, message: string) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.id === id ? { id, message, tone: "danger" } : entry,
      ),
    );
  }, []);
  return (
    <NoticesContext.Provider value={post}>
      {children}
      <NoticeStack entries={entries} onDismiss={dismiss} onFail={fail} />
    </NoticesContext.Provider>
  );
}

/** Posts outcome notices; outside the provider a post is a no-op. */
export function useNotices() {
  const post = useContext(NoticesContext);
  return { post: post ?? (() => undefined) };
}

function NoticeStack({
  entries,
  onDismiss,
  onFail,
}: {
  readonly entries: readonly NoticeEntry[];
  readonly onDismiss: (id: number, acted?: boolean) => void;
  readonly onFail: (id: number, message: string) => void;
}) {
  const common = useTranslations("common");
  const describe = useErrorMessage();
  const [busy, setBusy] = useState<number | null>(null);
  if (entries.length === 0) return null;
  return (
    <div className="notice-stack">
      {entries.map((entry) => (
        <div
          className={`notice-toast notice-toast-${entry.tone}`}
          key={entry.id}
          role={entry.tone === "danger" ? "alert" : "status"}
        >
          <span>{entry.message}</span>
          {entry.action === undefined ? null : (
            <button
              className="notice-toast-action"
              disabled={busy === entry.id}
              onClick={() => {
                setBusy(entry.id);
                entry.action
                  ?.run()
                  .then(() => onDismiss(entry.id, true))
                  .catch((error: unknown) => onFail(entry.id, describe(error)))
                  .finally(() => setBusy(null));
              }}
              type="button"
            >
              {entry.action.label}
            </button>
          )}
          <button
            aria-label={common("close")}
            className="button button-quiet button-small notice-toast-close"
            onClick={() => onDismiss(entry.id)}
            type="button"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
