import type { EventPage } from "@livtales/schemas";

import { tr } from "../i18n/active-locale";
import { componentKindLabel } from "./event-components";

const sentenceLimit = 3;

interface Placement {
  readonly pageId: string;
  readonly pageName: string;
  readonly index: number;
  readonly kind: EventPage["components"][number]["kind"];
}

function placements(pages: readonly EventPage[]): Map<string, Placement> {
  const found = new Map<string, Placement>();
  for (const page of pages)
    page.components.forEach((component, index) => {
      found.set(component.id, {
        pageId: page.id,
        pageName: page.name,
        index,
        kind: component.kind,
      });
    });
  return found;
}

/**
 * When one component alone accounts for the new order, that is the one that
 * moved (the one moved up when two could explain a swap); otherwise the
 * components outside the longest common order moved.
 */
function movedIds(
  before: readonly string[],
  after: readonly string[],
): Set<string> {
  const shared = before.filter((id) => after.includes(id));
  const kept = after.filter((id) => shared.includes(id));
  const candidates = shared.filter((id) => {
    const rest = shared.filter((other) => other !== id);
    const restAfter = kept.filter((other) => other !== id);
    return rest.every((other, index) => other === restAfter[index]);
  });
  const single = candidates.find((id) => kept.indexOf(id) < shared.indexOf(id));
  if (single !== undefined && kept.join() !== shared.join())
    return new Set([single]);
  const stable = stableIds(shared, kept);
  return new Set(shared.filter((id) => !stable.has(id)));
}

/** The ids of a sequence that keep their relative order in the next one. */
function stableIds(
  before: readonly string[],
  after: readonly string[],
): Set<string> {
  const positions = new Map(after.map((id, index) => [id, index]));
  const sequence = before.filter((id) => positions.has(id));
  // Longest increasing subsequence of the next positions: what did not move.
  const tails: number[] = [];
  const previous: (number | undefined)[] = [];
  const tailIndex: number[] = [];
  sequence.forEach((id, index) => {
    const position = positions.get(id) ?? 0;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((tails[middle] ?? 0) < position) low = middle + 1;
      else high = middle;
    }
    tails[low] = position;
    tailIndex[low] = index;
    previous[index] = low > 0 ? tailIndex[low - 1] : undefined;
  });
  const stable = new Set<string>();
  let cursor = tailIndex[tails.length - 1];
  while (cursor !== undefined) {
    stable.add(sequence[cursor] ?? "");
    cursor = previous[cursor];
  }
  return stable;
}

/**
 * What one layout version changed against the one before it, as sentences
 * in the active language: pages added, removed, or renamed; components
 * added, removed, moved to another page, or moved within one. Up to three
 * sentences, then how many more changes there were.
 */
export function describeLayoutChanges(
  before: readonly EventPage[],
  after: readonly EventPage[],
): { readonly sentences: string[]; readonly more: number } {
  const t = tr("layoutRecovery");
  const sentences: string[] = [];
  const beforePages = new Map(before.map((page) => [page.id, page]));
  const afterPages = new Map(after.map((page) => [page.id, page]));
  for (const page of after)
    if (!beforePages.has(page.id))
      sentences.push(t("addedPage", { page: page.name }));
  for (const page of before)
    if (!afterPages.has(page.id))
      sentences.push(t("removedPage", { page: page.name }));
  for (const page of after) {
    const earlier = beforePages.get(page.id);
    if (earlier !== undefined && earlier.name !== page.name)
      sentences.push(
        t("renamedPage", { before: earlier.name, after: page.name }),
      );
  }
  const was = placements(before);
  const now = placements(after);
  for (const [id, placement] of now)
    if (!was.has(id) && beforePages.has(placement.pageId))
      sentences.push(
        t("addedComponent", {
          component: componentKindLabel(placement.kind),
          page: placement.pageName,
        }),
      );
  for (const [id, placement] of was)
    if (!now.has(id) && afterPages.has(placement.pageId))
      sentences.push(
        t("removedComponent", {
          component: componentKindLabel(placement.kind),
        }),
      );
  for (const page of after) {
    const earlier = beforePages.get(page.id);
    if (earlier === undefined) continue;
    const moved = movedIds(
      earlier.components.map((component) => component.id),
      page.components.map((component) => component.id),
    );
    page.components.forEach((component, index) => {
      const placement = was.get(component.id);
      if (placement === undefined) return;
      if (placement.pageId !== page.id) {
        sentences.push(
          t("movedToPage", {
            component: componentKindLabel(component.kind),
            page: page.name,
          }),
        );
        return;
      }
      if (!moved.has(component.id)) return;
      const next = page.components[index + 1];
      sentences.push(
        next === undefined
          ? t("movedToEnd", {
              component: componentKindLabel(component.kind),
              page: page.name,
            })
          : t("moved", {
              component: componentKindLabel(component.kind),
              other: componentKindLabel(next.kind),
            }),
      );
    });
  }
  return {
    sentences: sentences.slice(0, sentenceLimit),
    more: Math.max(0, sentences.length - sentenceLimit),
  };
}
