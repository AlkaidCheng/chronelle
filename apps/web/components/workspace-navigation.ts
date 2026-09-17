import {
  CalendarIcon,
  CheckIcon,
  PeopleIcon,
  SearchIcon,
  TrashIcon,
} from "./icons";

/** Every workspace page the command palette can open; the catalogs name each by `key`. */
export const workspaceDestinations = [
  {
    href: "/events",
    key: "events",
    icon: CalendarIcon,
  },
  {
    href: "/tasks",
    key: "tasks",
    icon: CheckIcon,
  },
  {
    href: "/people",
    key: "people",
    icon: PeopleIcon,
  },
  {
    href: "/search",
    key: "search",
    icon: SearchIcon,
  },
  {
    href: "/trash",
    key: "trash",
    icon: TrashIcon,
  },
] as const;

export type WorkspaceDestination = (typeof workspaceDestinations)[number];

/**
 * The collections the rail lists under Search, in default order. The user
 * reorders and hides them from the rail; a collection added here appends in
 * this position for an account that has not arranged it.
 */
export const railCollections = workspaceDestinations.filter(
  (destination): destination is RailCollection =>
    destination.key === "events" ||
    destination.key === "tasks" ||
    destination.key === "people",
);

export type RailCollection = Extract<
  WorkspaceDestination,
  { key: "events" | "tasks" | "people" }
>;

export const railCollectionKeys: readonly string[] = railCollections.map(
  (collection) => collection.key,
);
