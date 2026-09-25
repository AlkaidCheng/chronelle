import {
  eventPagesSchema,
  type EventComponent,
  type EventComponentKind,
  type EventComponentView,
  type EventPage,
} from "@livtales/schemas";

type MoveDirection = -1 | 1;

function validate(pages: readonly EventPage[]): EventPage[] {
  return eventPagesSchema.parse(pages);
}

function move<T>(
  items: readonly T[],
  index: number,
  direction: MoveDirection,
): T[] {
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return [...items];
  const next = [...items];
  const current = next[index];
  const neighbor = next[target];
  if (current === undefined || neighbor === undefined) return next;
  next[index] = neighbor;
  next[target] = current;
  return next;
}

function updatePage(
  pages: readonly EventPage[],
  pageId: string,
  update: (page: EventPage) => EventPage,
): EventPage[] {
  return validate(
    pages.map((page) => (page.id === pageId ? update(page) : page)),
  );
}

export function addPage(
  pages: readonly EventPage[],
  page: Pick<EventPage, "id" | "name">,
): EventPage[] {
  return validate([...pages, { ...page, components: [] }]);
}

export function renamePage(
  pages: readonly EventPage[],
  pageId: string,
  name: string,
): EventPage[] {
  return updatePage(pages, pageId, (page) => ({ ...page, name }));
}

export function removePage(
  pages: readonly EventPage[],
  pageId: string,
): EventPage[] {
  return validate(pages.filter((page) => page.id !== pageId));
}

export function movePage(
  pages: readonly EventPage[],
  pageId: string,
  direction: MoveDirection,
): EventPage[] {
  return validate(
    move(
      pages,
      pages.findIndex((page) => page.id === pageId),
      direction,
    ),
  );
}

export function addComponent(
  pages: readonly EventPage[],
  pageId: string,
  component: Pick<EventComponent, "id" | "kind">,
): EventPage[] {
  return updatePage(pages, pageId, (page) => ({
    ...page,
    components: [...page.components, component],
  }));
}

export function removeComponent(
  pages: readonly EventPage[],
  pageId: string,
  componentId: string,
): EventPage[] {
  return updatePage(pages, pageId, (page) => ({
    ...page,
    components: page.components.filter(
      (component) => component.id !== componentId,
    ),
  }));
}

export function moveComponent(
  pages: readonly EventPage[],
  pageId: string,
  componentId: string,
  direction: MoveDirection,
): EventPage[] {
  return updatePage(pages, pageId, (page) => ({
    ...page,
    components: move(
      page.components,
      page.components.findIndex((component) => component.id === componentId),
      direction,
    ),
  }));
}

export function setComponentView(
  pages: readonly EventPage[],
  componentId: string,
  view: EventComponentView,
): EventPage[] {
  return validate(
    pages.map((page) => ({
      ...page,
      components: page.components.map((component) =>
        component.id === componentId ? { ...component, view } : component,
      ),
    })),
  );
}

export function hasComponentKind(
  pages: readonly EventPage[],
  kind: EventComponentKind,
): boolean {
  return pages.some((page) =>
    page.components.some((component) => component.kind === kind),
  );
}
