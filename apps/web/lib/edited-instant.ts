import { tr } from "../i18n/active-locale";
import { fromDateTimeInput, toDateTimeInput } from "./format";

/** The instants an editor keeps, named for the messages that refuse one. */
export type EditedInstantKind = "due" | "transaction" | "reminder";

/** Preserves unchanged precision and rejects local times normalized by Date. */
export function editedInstant(
  value: string,
  original: string | null | undefined,
  kind: EditedInstantKind,
): string | null {
  if (value === toDateTimeInput(original ?? null)) return original ?? null;
  let instant: string | null;
  try {
    instant = fromDateTimeInput(value);
  } catch {
    throw new Error(tr("validation.validInstant")(kind));
  }
  if (toDateTimeInput(instant) !== value)
    throw new Error(tr("validation.unavailableInstant")(kind));
  return instant;
}
