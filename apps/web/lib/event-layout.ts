import type { EventComponentView, EventPage } from "@chronelle/schemas";

/** Move an existing item before an anchor, or to the end when the anchor is null. */
function reorder<T extends { id: string }>(
  items: T[],
  id: string,
  beforeId: string | null,
): T[] {
  const item = items.find((candidate) => candidate.id === id);
  if (!item || id === beforeId) return items;
  if (beforeId !== null && !items.some((item) => item.id === beforeId))
    return items;
  const remaining = items.filter((candidate) => candidate.id !== id);
  const index =
    beforeId === null
      ? remaining.length
      : remaining.findIndex((candidate) => candidate.id === beforeId);
  remaining.splice(index, 0, item);
  return remaining.every((item, index) => item === items[index])
    ? items
    : remaining;
}

export function moveEventPage(
  pages: EventPage[],
  pageId: string,
  beforeId: string | null,
): EventPage[] {
  return reorder(pages, pageId, beforeId);
}

/** Layout moves preserve component identities and never touch canonical records. */
export function moveEventComponent(
  pages: EventPage[],
  componentId: string,
  targetPageId: string,
  beforeId: string | null,
): EventPage[] {
  const source = pages.find((page) =>
    page.components.some((component) => component.id === componentId),
  );
  const target = pages.find((page) => page.id === targetPageId);
  const component = source?.components.find((item) => item.id === componentId);
  if (!source || !target || !component) return pages;
  if (source === target) {
    const components = reorder(source.components, componentId, beforeId);
    return components === source.components
      ? pages
      : pages.map((page) => (page === source ? { ...page, components } : page));
  }
  if (target.components.length >= 20) return pages;
  const index =
    beforeId === null
      ? target.components.length
      : target.components.findIndex((item) => item.id === beforeId);
  if (index < 0) return pages;
  return pages.map((page) => {
    if (page === source)
      return {
        ...page,
        components: page.components.filter((item) => item !== component),
      };
    if (page === target)
      return {
        ...page,
        components: [
          ...page.components.slice(0, index),
          component,
          ...page.components.slice(index),
        ],
      };
    return page;
  });
}

/** Records the view of one component; the pages are returned unchanged when it already shows it. */
export function setEventComponentView(
  pages: EventPage[],
  componentId: string,
  view: EventComponentView,
): EventPage[] {
  const page = pages.find((page) =>
    page.components.some((component) => component.id === componentId),
  );
  const component = page?.components.find((item) => item.id === componentId);
  if (!page || !component || component.view === view) return pages;
  return pages.map((item) =>
    item === page
      ? {
          ...item,
          components: item.components.map((entry) =>
            entry === component ? { ...entry, view } : entry,
          ),
        }
      : item,
  );
}
