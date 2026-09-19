import type { SectionResponse } from "@chronelle/schemas";

interface Sectioned {
  readonly id: string;
  readonly sectionId: string | null;
}

/** One section of a view with the records it holds, in the order they arrived. */
export interface SectionGroup<Item extends Sectioned> {
  readonly section: SectionResponse;
  readonly items: readonly Item[];
}

/**
 * The records of a view split by section: the loose ones first, then each
 * section in its order. A record naming a section the view no longer has
 * counts as loose.
 */
export function groupBySection<Item extends Sectioned>(
  items: readonly Item[],
  sections: readonly SectionResponse[],
): {
  readonly loose: readonly Item[];
  readonly groups: readonly SectionGroup<Item>[];
} {
  const known = new Set(sections.map((section) => section.id));
  const loose = items.filter(
    (item) => item.sectionId === null || !known.has(item.sectionId),
  );
  const groups = sections.map((section) => ({
    section,
    items: items.filter((item) => item.sectionId === section.id),
  }));
  return { loose, groups };
}

/**
 * The section a moved section lands after when it steps up or down: null
 * puts it first. Undefined when it is already at that end.
 */
export function sectionAfterStep(
  sections: readonly SectionResponse[],
  sectionId: string,
  direction: -1 | 1,
): string | null | undefined {
  const at = sections.findIndex((section) => section.id === sectionId);
  if (at < 0) return undefined;
  const target = at + direction;
  if (target < 0 || target >= sections.length) return undefined;
  // Moving up lands after the one before the target; moving down after the target.
  const after = direction < 0 ? sections[target - 1] : sections[target];
  return after?.id ?? null;
}

/** The section a dropped section lands after, from its place among the others. */
export function sectionAfterIndex(
  others: readonly string[],
  index: number,
): string | null {
  return index <= 0 ? null : (others[index - 1] ?? null);
}
