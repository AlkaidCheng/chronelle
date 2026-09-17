"use client";

import { useTranslations } from "next-intl";

import {
  FilterIcon,
  GridIcon,
  ListIcon,
  SortIcon,
} from "../../components/icons";
import {
  MenuHeading,
  MenuItem,
  MenuSeparator,
  QuietMenu,
} from "../../components/quiet-menu";
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

/** A label the workspace knows, as the filter offers it. */
export interface PersonLabelChoice {
  readonly id: string;
  readonly name: string;
}

/** Sort as one quiet control: by name, or by the latest change first. */
export function PersonSortControl({
  onChange,
  sort,
}: {
  readonly onChange: (sort: PersonSort) => void;
  readonly sort: PersonSort;
}) {
  const t = useTranslations("controls");
  return (
    <QuietMenu
      active={sort !== "name"}
      icon={<SortIcon />}
      label={t("sort")}
      value={sort}
    >
      {personSorts.map((choice) => (
        <MenuItem
          checked={choice === sort}
          key={choice}
          onSelect={() => {
            if (choice !== sort) onChange(choice);
          }}
        >
          {t(`sorts.${choice}`)}
        </MenuItem>
      ))}
    </QuietMenu>
  );
}

/**
 * Filter as one quiet control over the account behind a person and the
 * labels the workspace knows; the chips under the toolbar offer the same
 * choices in the open.
 */
export function PersonFilterControl({
  filters,
  labels,
  onChange,
}: {
  readonly filters: PersonFilters;
  readonly labels: readonly PersonLabelChoice[];
  readonly onChange: (filters: PersonFilters) => void;
}) {
  const t = useTranslations("controls");
  const people = useTranslations("people");
  return (
    <QuietMenu
      active={activePersonFilterCount(filters) > 0}
      icon={<FilterIcon />}
      label={t("filter")}
      value={`${filters.account}:${filters.label}`}
    >
      <MenuHeading>{people("account")}</MenuHeading>
      {personAccountFilters.map((choice: PersonAccountFilter) => (
        <MenuItem
          checked={filters.account === choice}
          key={choice}
          onSelect={() => onChange({ ...filters, account: choice })}
        >
          {people(`accounts.${choice}`)}
        </MenuItem>
      ))}
      {labels.length > 0 ? (
        <>
          <MenuSeparator />
          <MenuHeading>{t("label")}</MenuHeading>
          <MenuItem
            checked={filters.label === ""}
            onSelect={() => onChange({ ...filters, label: "" })}
          >
            {t("anyLabel")}
          </MenuItem>
          {labels.map((label) => (
            <MenuItem
              checked={filters.label === label.id}
              key={label.id}
              onSelect={() => onChange({ ...filters, label: label.id })}
            >
              {label.name}
            </MenuItem>
          ))}
        </>
      ) : null}
      <MenuSeparator />
      <MenuItem onSelect={() => onChange(defaultPersonFilters)}>
        {t("clearFilters")}
      </MenuItem>
    </QuietMenu>
  );
}

/** Layout as a segmented control, List or Namecards, the current one pressed. */
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
    <fieldset className="quiet-segment">
      <legend className="visually-hidden">{t("layout")}</legend>
      {personLayouts.map((choice) => (
        <button
          aria-label={people(`layouts.${choice}`)}
          aria-pressed={choice === layout}
          data-tip={people(`layouts.${choice}`)}
          key={choice}
          onClick={() => {
            if (choice !== layout) onChange(choice);
          }}
          type="button"
        >
          {choice === "cards" ? <GridIcon /> : <ListIcon />}
        </button>
      ))}
    </fieldset>
  );
}

/** The connections the chips under the toolbar offer, in the order shown. */
const chipConnections: readonly PersonAccountFilter[] = [
  "all",
  "friend",
  "invited",
  "unlinked",
];

/**
 * The quick filters under the toolbar: the connection behind a person,
 * then the workspace's labels. A pressed chip is the filter in force; a
 * label chip pressed again lets every label through.
 */
export function PersonChips({
  filters,
  labels,
  onChange,
}: {
  readonly filters: PersonFilters;
  readonly labels: readonly PersonLabelChoice[];
  readonly onChange: (filters: PersonFilters) => void;
}) {
  const people = useTranslations("people");
  const person = useTranslations("person");
  return (
    <div className="chip-rows">
      <fieldset className="chip-row">
        <legend className="visually-hidden">{people("account")}</legend>
        {chipConnections.map((choice) => (
          <button
            aria-pressed={filters.account === choice}
            className="chip"
            key={choice}
            onClick={() => onChange({ ...filters, account: choice })}
            type="button"
          >
            {people(`accounts.${choice}`)}
          </button>
        ))}
      </fieldset>
      {labels.length > 0 ? (
        <fieldset className="chip-row">
          <legend className="visually-hidden">{person("labels")}</legend>
          {labels.map((label) => (
            <button
              aria-pressed={filters.label === label.id}
              className="chip"
              key={label.id}
              onClick={() =>
                onChange({
                  ...filters,
                  label: filters.label === label.id ? "" : label.id,
                })
              }
              type="button"
            >
              {label.name}
            </button>
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}
