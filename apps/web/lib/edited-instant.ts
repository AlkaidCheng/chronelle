import { fromDateTimeInput, toDateTimeInput } from "./format";

/** Preserves unchanged precision and rejects local times normalized by Date. */
export function editedInstant(
  value: string,
  original: string | null | undefined,
  label: string,
): string | null {
  if (value === toDateTimeInput(original ?? null)) return original ?? null;
  let instant: string | null;
  try {
    instant = fromDateTimeInput(value);
  } catch {
    throw new Error(`Choose a valid ${label} date and time.`);
  }
  if (toDateTimeInput(instant) !== value)
    throw new Error(
      `This local time is unavailable. Choose another ${label} time.`,
    );
  return instant;
}
