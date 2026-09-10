import { CalendarIcon, SearchIcon, TrashIcon } from "./icons";

export const workspaceDestinations = [
  {
    href: "/events",
    label: "Events",
    description: "Browse your plans",
    icon: CalendarIcon,
  },
  {
    href: "/search",
    label: "Search",
    description: "Find objects you can access",
    icon: SearchIcon,
  },
  {
    href: "/trash",
    label: "Trash",
    description: "Review recoverable objects",
    icon: TrashIcon,
  },
] as const;
