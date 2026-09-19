import type { ReactNode } from "react";
import type { EventView } from "../lib/event-views";

/**
 * A two-tone mark for each event view: an outline with one soft filled
 * shape, drawn in the current color. The gallery shows it large on a card
 * and Manage tabs small before a row's name.
 */
export function ViewMark({
  view,
  className,
}: {
  readonly view: EventView;
  readonly className?: string | undefined;
}) {
  return (
    <svg
      aria-hidden="true"
      className={`view-mark ${className ?? ""}`.trim()}
      fill="none"
      viewBox="0 0 24 24"
    >
      {marks[view]}
    </svg>
  );
}

const soft = "view-mark-soft";

const marks: Record<EventView, ReactNode> = {
  pages: (
    <>
      <rect className={soft} x="4" y="3" width="16" height="18" rx="2.5" />
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  overview: (
    <>
      <rect className={soft} x="3" y="4" width="18" height="5" rx="1.5" />
      <rect x="3" y="4" width="18" height="5" rx="1.5" />
      <rect x="3" y="12" width="8" height="8" rx="1.5" />
      <rect x="14" y="12" width="7" height="8" rx="1.5" />
    </>
  ),
  todos: (
    <>
      <rect className={soft} x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="8" cy="9" r="1.6" />
      <path d="M11.5 9H17M11.5 15H15" />
      <circle cx="8" cy="15" r="1.6" />
      <path d="M7 9l.7.7 1.3-1.4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <rect className={soft} x="6" y="13" width="4" height="3" rx="1" />
      <rect className={soft} x="13" y="13" width="5" height="3" rx="1" />
    </>
  ),
  itinerary: (
    <>
      <path className={soft} d="M6 4h12v16H6z" />
      <path d="M6 4h12v16H6z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
      <circle cx="17.5" cy="16.5" r="3" />
      <path d="M17.5 15v1.5l1 1" />
    </>
  ),
  timeline: (
    <>
      <path d="M7 8.3v1.6M7 14.3v1.6" />
      <circle cx="7" cy="6" r="2" />
      <circle className={soft} cx="7" cy="12" r="2.8" />
      <circle cx="7" cy="12" r="2" />
      <circle cx="7" cy="18" r="2" />
      <rect className={soft} x="12" y="4.5" width="8" height="3" rx="1.5" />
      <rect className={soft} x="12" y="10.5" width="5.5" height="3" rx="1.5" />
      <rect className={soft} x="12" y="16.5" width="9" height="3" rx="1.5" />
    </>
  ),
  expenses: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10.5h18" />
      <rect className={soft} x="14" y="13" width="4.5" height="3" rx="1" />
      <path d="M6.5 15.5h4" />
    </>
  ),
  reminders: (
    <>
      <path className={soft} d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  files: (
    <>
      <path className={soft} d="M7 3h7l5 5v13H7z" />
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5M10 13h6M10 17h4" />
    </>
  ),
  people: (
    <>
      <circle className={soft} cx="9" cy="8" r="3.5" />
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15.5 14.5a5 5 0 0 1 6 5" />
    </>
  ),
  notes: (
    <>
      <path className={soft} d="M5 4h10l4 4v12H5z" />
      <path d="M5 4h10l4 4v12H5z" />
      <path d="M15 4v4h4M8 12h8M8 16h5" />
    </>
  ),
  sharing: (
    <>
      <circle className={soft} cx="18" cy="5" r="3" />
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.2 10.8l7.6-4.6M8.2 13.2l7.6 4.6" />
    </>
  ),
  "removed-links": (
    <>
      <path className={soft} d="M9 7H6.5a4.5 4.5 0 0 0 0 9H9" />
      <path d="M9 7H6.5a4.5 4.5 0 0 0 0 9H9M15 7h2.5a4.5 4.5 0 0 1 0 9H15" />
      <path d="M9 12h3M17 15l4 4M21 15l-4 4" />
    </>
  ),
};
