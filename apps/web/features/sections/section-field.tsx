"use client";

import type { SectionResponse } from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import { useId } from "react";

/**
 * The section a record sits in, as a choice among the view's sections
 * with "No section" first. Shown only when the editor knows the sections
 * of the Event's view; a record outside an Event has none.
 */
export function SectionField({
  disabled = false,
  onChange,
  sections,
  value,
}: {
  readonly disabled?: boolean;
  /** The section's id, or the empty string for none. */
  readonly onChange: (section: string) => void;
  readonly sections: readonly SectionResponse[];
  readonly value: string;
}) {
  const t = useTranslations("sections");
  const id = useId();
  // A section the view no longer has reads as none.
  const known = sections.some((section) => section.id === value);
  // Named by the span alone: a select wrapped in a label would otherwise
  // take its options' text into its name.
  return (
    <label className="field field-wide section-field">
      <span id={id}>{t("field")}</span>
      <select
        aria-labelledby={id}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={known ? value : ""}
      >
        <option value="">{t("none")}</option>
        {sections.map((section) => (
          <option key={section.id} value={section.id}>
            {section.name}
          </option>
        ))}
      </select>
    </label>
  );
}
