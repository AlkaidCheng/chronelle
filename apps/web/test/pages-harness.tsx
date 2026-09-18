import { CommandScope } from "../components/context-commands";
import { EventPages } from "../features/events/event-pages";
import { EventStrip } from "../features/events/event-strip";
import { useEventPagesState } from "../features/events/use-event-pages";

/** Renders an event's pages the way the event workspace does, without the rest of it. */
export function PagesHarness({
  eventId,
  canEdit,
}: {
  readonly eventId: string;
  readonly canEdit: boolean;
}) {
  const state = useEventPagesState(eventId, canEdit);
  return (
    <>
      <CommandScope pathname={`/events/${eventId}`} commands={state.commands} />
      <EventStrip
        pages={state.pages}
        selectedPageId={state.selectedPage?.id}
        showingPages
        onSelectPage={state.selectPage}
        canAddPage={state.canAddPage}
        onAddPage={() => state.setAdding({ pageId: null })}
        addPageRef={state.addPageButton}
        pageMenu={state.pageMenu}
        pageDrop={state.pageDrop}
        onInsertComponent={
          state.canAddComponent && state.selectedPage
            ? () => state.setAdding({ pageId: state.selectedPage?.id ?? null })
            : undefined
        }
        views={[]}
        activeView="pages"
        onSelectView={() => {}}
        tabRef={() => {}}
      />
      <EventPages
        layout={state.layout}
        selected={state.selectedPage}
        selectedId={state.selectedPageId}
        canEdit={canEdit}
        onSelect={state.selectPage}
        adding={state.adding}
        onAddingChange={state.setAdding}
        arranging={state.arranging}
        onArrangingChange={state.setArranging}
        layoutUndo={state.layoutUndo}
        pageDrop={state.pageDrop}
      />
      {state.dialog}
    </>
  );
}
