"use client";

import { useTranslations } from "next-intl";

import { HeadMenu, type HeadMenuEntry } from "../../components/head-menu";
import { FilterIcon, LayoutIcon, SortIcon } from "../../components/icons";
import {
  activePersonFilterCount,
  defaultPersonFilters,
  type PersonAccountFilter,
  personAccountFilters,
  type PersonFilters,
  type PersonLayout,
  personLayouts,
  type PersonSort,
  personSorts,
} from "../../lib/person-collection";

/** Sort as one quiet control; the button reads the order when it is not the default. */
export function PersonSortControl({
  onChange,
  sort,
}: {
  readonly onChange: (sort: PersonSort) => void;
  readonly sort: PersonSort;
}) {
  const t = useTranslations("controls");
  return (
    <HeadMenu
      active={sort !== "name"}
      entries={personSorts.map((choice) => ({
        kind: "radio",
        label: t(`sorts.${choice}`),
        checked: choice === sort,
        onSelect: () => {
          if (choice !== sort) onChange(choice);
        },
      }))}
      icon={<SortIcon />}
      label={t("sort")}
      name={sort === "name" ? undefined : t(`sorts.${sort}`)}
    />
  );
}

/**
 * Filter as one quiet control over the account (everyone, those with an
 * account, those without) and the labels the workspace knows. Choices keep
 * the menu open; the button counts them.
 */
export function PersonFilterControl({
  filters,
  labels,
  onChange,
}: {
  readonly filters: PersonFilters;
  readonly labels: readonly { readonly id: string; readonly name: string }[];
  readonly onChange: (filters: PersonFilters) => void;
}) {
  const t = useTranslations("controls");
  const people = useTranslations("people");
  const count = activePersonFilterCount(filters);
  const radio = (
    label: string,
    checked: boolean,
    change: Partial<PersonFilters>,
  ): HeadMenuEntry => ({
    kind: "radio",
    label,
    checked,
    closes: false,
    onSelect: () => onChange({ ...filters, ...change }),
  });
  const entries: HeadMenuEntry[] = [
    { kind: "label", text: people("account") },
    ...personAccountFilters.map((choice: PersonAccountFilter) =>
      radio(people(`accounts.${choice}`), filters.account === choice, {
        account: choice,
      }),
    ),
  ];
  if (labels.length > 0)
    entries.push(
      { kind: "rule" },
      { kind: "label", text: t("label") },
      radio(t("anyLabel"), filters.label === "", { label: "" }),
      ...labels.map((label) =>
        radio(label.name, filters.label === label.id, { label: label.id }),
      ),
    );
  entries.push(
    { kind: "rule" },
    {
      kind: "item",
      label: t("clearFilters"),
      onSelect: () => onChange(defaultPersonFilters),
    },
  );
  return (
    <HeadMenu
      active={count > 0}
      entries={entries}
      icon={<FilterIcon />}
      label={t("filter")}
      name={count === 0 ? undefined : t("filterCount", { count })}
    />
  );
}

/** Layout as one quiet control reading the current choice: List or Namecards. */
export function PersonLayoutControl({
  layout,
  onChange,
}: {
  readonly layout: PersonLayout;
  readonly onChange: (layout: PersonLayout) => void;
}) {
  const t = useTranslations("controls");
  const people = useTranslations("people");
  return (
    <HeadMenu
      entries={personLayouts.map((choice) => ({
        kind: "radio",
        label: people(`layouts.${choice}`),
        checked: choice === layout,
        onSelect: () => {
          if (choice !== layout) onChange(choice);
        },
      }))}
      icon={<LayoutIcon />}
      label={t("layout")}
      name={people(`layouts.${layout}`)}
    />
  );
}
