import type { WorkspaceMark as Mark } from "../lib/workspace-identity";

interface WorkspaceMarkProps {
  readonly mark: Mark;
  readonly className?: string | undefined;
}

/**
 * A workspace's squared mark: the home symbol for the account's own
 * workspace, the owner's initials for one shared with it. Decorative; the
 * name beside it carries the meaning.
 */
export function WorkspaceMark({ mark, className }: WorkspaceMarkProps) {
  return (
    <span
      className={["workspace-mark", className].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      {mark.kind === "home" ? (
        <svg
          aria-hidden="true"
          className="workspace-mark-home"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" />
        </svg>
      ) : (
        mark.text
      )}
    </span>
  );
}
