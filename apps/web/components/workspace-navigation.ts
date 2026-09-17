import {
  CalendarIcon,
  CheckIcon,
  PeopleIcon,
  SearchIcon,
  TrashIcon,
} from "./icons";

export const workspaceDestinations = [
  {
    href: "/events",
    key: "events",
    label: "Events",
    description: "Browse your plans",
    icon: CalendarIcon,
  },
  {
    href: "/tasks",
    key: "tasks",
    label: "Tasks",
    description: "Everything you have to do",
    icon: CheckIcon,
  },
  {
    href: "/people",
    key: "people",
    label: "People",
    description: "Who your plans involve",
    icon: PeopleIcon,
  },
  {
    href: "/search",
    key: "search",
    label: "Search",
    description: "Find objects you can access",
    icon: SearchIcon,
  },
  {
    href: "/trash",
    key: "trash",
    label: "Trash",
    description: "Review recoverable objects",
    icon: TrashIcon,
  },
] as const;
