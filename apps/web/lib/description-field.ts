import { tr } from "../i18n/active-locale";

/** The most characters a description (of an Event or a Task) may hold once trimmed. */
export const descriptionLimit = 2000;

/** The description as the API takes it: trimmed, null when empty, refused past the limit. */
export function descriptionPayload(text: string): string | null {
  const description = text.trim() === "" ? null : text.trim();
  if (description !== null && description.length > descriptionLimit)
    throw new Error(
      tr("validation")("descriptionLength", { limit: descriptionLimit }),
    );
  return description;
}
