import { CalendarIcon, CheckIcon, SearchIcon, TrashIcon } from "./icons";

export const workspaceDestinations = [
  {
    href: "/events",
    label: "Events",
    description: "Browse your plans",
    icon: CalendarIcon,
  },
  {
    href: "/tasks",
    label: "Tasks",
    description: "Everything you have to do",
    icon: CheckIcon,
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
