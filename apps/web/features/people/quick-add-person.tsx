"use client";

import { useTranslations } from "next-intl";

import {
  QuickAddRow,
  type QuickAddSlots,
} from "../../components/quick-add-row";
import { useCreatePerson } from "../../lib/queries";

/** The one quick add row of the People collection, the same in both layouts. */
export const quickAddPersonSlot = "people";

/**
 * The quick "Add a person" row at the end of the People collection: Enter
 * creates a person with the typed name and keeps the field open for the
 * next one. The person goes through the same creation request as the
 * editor's.
 */
export function QuickAddPerson({ slots }: { readonly slots: QuickAddSlots }) {
  const t = useTranslations("people");
  const create = useCreatePerson();
  return (
    <QuickAddRow
      label={t("addPerson")}
      name={t("newPersonName")}
      onAdd={(displayName) => create.mutateAsync({ displayName })}
      placeholder={t("personName")}
      slot={quickAddPersonSlot}
      slots={slots}
      text={t("addPerson")}
    />
  );
}
