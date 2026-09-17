import type { PersonResponse } from "@chronelle/schemas";

import { activeLocale } from "../i18n/active-locale";
import { personDisplayName } from "./person-fields";

/** How the People collection lays its people out. */
export type PersonLayout = "list" | "cards";

export const personLayouts: readonly PersonLayout[] = ["list", "cards"];

export function isPersonLayout(value: unknown): value is PersonLayout {
  return personLayouts.includes(value as PersonLayout);
}

/** The orders the People collection offers. */
export type PersonSort = "name" | "updated";

export const personSorts: readonly PersonSort[] = ["name", "updated"];

/**
 * Whether a person is linked to an account. The keys stay open for the
 * finer states a connection brings (a friend, an invitation sent).
 */
export type PersonAccountFilter = "all" | "linked" | "unlinked";

export const personAccountFilters: readonly PersonAccountFilter[] = [
  "all",
  "linked",
  "unlinked",
];

/** What the People collection narrows by, beyond the name query the server takes. */
export interface PersonFilters {
  readonly account: PersonAccountFilter;
  readonly label: string;
}

export const defaultPersonFilters: PersonFilters = {
  account: "all",
  label: "",
};

/** How many choices differ from the defaults: what the Filter button counts. */
export function activePersonFilterCount(filters: PersonFilters): number {
  return Number(filters.account !== "all") + Number(filters.label !== "");
}

/** The people that pass the filters, in the given order. */
export function filterPersons(
  items: readonly PersonResponse[],
  filters: PersonFilters,
): PersonResponse[] {
  return items.filter(
    (person) =>
      (filters.account === "all" ||
        (filters.account === "linked") === (person.userId !== null)) &&
      (filters.label === "" || person.labelIds.includes(filters.label)),
  );
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The comparison behind one sort, ties broken by id so the order is stable. */
export function comparePersons(
  sort: PersonSort,
): (a: PersonResponse, b: PersonResponse) => number {
  switch (sort) {
    case "name":
      return (a, b) =>
        personDisplayName(a).localeCompare(
          personDisplayName(b),
          activeLocale(),
          { sensitivity: "base" },
        ) || compareText(a.id, b.id);
    case "updated":
      return (a, b) =>
        compareText(b.updatedAt, a.updatedAt) || compareText(a.id, b.id);
  }
}

export function sortPersons(
  items: readonly PersonResponse[],
  sort: PersonSort,
): PersonResponse[] {
  return [...items].sort(comparePersons(sort));
}

/**
 * The letters on a person's avatar: the first character of a name written
 * in Han, kana, or Hangul, else the initials of its first two words.
 */
export function personInitials(name: string): string {
  const trimmed = name.trim();
  const first = [...trimmed][0];
  if (first === undefined) return "?";
  if (
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
      first,
    )
  )
    return first;
  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => [...part][0]?.toUpperCase() ?? "")
    .join("");
}

/** The account a person stands for: the signed-in user's, another member's, or none. */
export function personAccount(
  person: Pick<PersonResponse, "userId">,
  me: string | undefined,
): "me" | "linked" | null {
  if (person.userId === null) return null;
  return me !== undefined && person.userId === me ? "me" : "linked";
}
