"use client";

import { useTranslations } from "next-intl";

import { descriptionLimit } from "../lib/description-field";

/**
 * The description an Event or a Task carries: a field of plain text, line
 * breaks kept, under the record's name in its editor. Its placeholder is
 * its visible label; it starts one line tall and grows with its text.
 */
export function DescriptionField({
  disabled = false,
  onChange,
  value,
}: {
  readonly disabled?: boolean | undefined;
  readonly onChange: (value: string) => void;
  readonly value: string;
}) {
  const t = useTranslations("editor");
  const rows = Math.min(8, Math.max(1, value.split("\n").length));
  return (
    <label className="field field-wide">
      <span className="visually-hidden">{t("description")}</span>
      <textarea
        disabled={disabled}
        maxLength={descriptionLimit}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("descriptionPlaceholder")}
        rows={rows}
        value={value}
      />
    </label>
  );
}
