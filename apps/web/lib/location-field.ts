import { tr } from "../i18n/active-locale";

/** The most characters a location (of a Task or a schedule item) may hold once trimmed. */
export const locationLimit = 240;

/** The location as the API takes it: trimmed, null when empty, refused past the limit. */
export function locationPayload(text: string): string | null {
  const location = text.trim() === "" ? null : text.trim();
  if (location !== null && location.length > locationLimit)
    throw new Error(
      tr("validation")("locationLength", { limit: locationLimit }),
    );
  return location;
}
