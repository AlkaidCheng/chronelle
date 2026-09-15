// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQueryClient } from "@tanstack/react-query";
import {
  afterEach,
  assert,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ChronelleApiClient } from "@chronelle/api-client";
import {
  eventComponentKindSchema,
  type EventComponentKind,
} from "@chronelle/schemas";
import { Providers } from "../app/providers";
import { EventPages } from "../features/events/event-pages";
import { eventComponents } from "../lib/event-components";
import { queryKeys } from "../lib/queries";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";
import {
  WorkspaceCommandProvider,
  useContextCommands,
} from "../components/context-commands";

let store: SandboxStore;
let client: ChronelleApiClient;
let eventId: string;

beforeEach(async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  let saved: string | null = null;
  store = new SandboxStore({
    getItem: () => saved,
    setItem: (_key, value) => {
      saved = value;
    },
  });
  client = new ChronelleApiClient({
    getCredential: () => ({
      accessToken: "sample",
      workspaceId: sandboxWorkspaceId,
    }),
    fetch: (input, options) => store.fetch(input, options),
  });
  const events = await client.listEvents({});
  const event = events.items.find(
    (event) => event.displayName === "Autumn gathering",
  );
  assert(event);
  eventId = event.id;
  window.history.replaceState(null, "", `/events/${eventId}`);
  window.sessionStorage.setItem(
    "chronelle.session",
    JSON.stringify({ accessToken: "sample", workspaceId: sandboxWorkspaceId }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>((input, options) =>
      store.fetch(input, options),
    ),
  );
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/events");
});

function page(name: string, kinds: readonly EventComponentKind[]) {
  return {
    id: crypto.randomUUID(),
    name,
    components: kinds.map((kind) => ({ id: crypto.randomUUID(), kind })),
  };
}

function RefreshProbe() {
  const cache = useQueryClient();
  return (
    <button
      type="button"
      onClick={() =>
        void cache.invalidateQueries({ queryKey: queryKeys.event(eventId) })
      }
    >
      Refetch layout
    </button>
  );
}

function CommandProbe() {
  const commands = useContextCommands();
  return (
    <output aria-label="Available page actions">
      {commands
        .map((command) => `${command.label}: ${command.description}`)
        .join(", ")}
    </output>
  );
}

describe("insertable event components", () => {
  it("previews presets locally and preserves custom names and the underlying Task view on cancel", async () => {
    const pages = [page("Plan", ["todos"])];
    await client.updateEventLayout(eventId, { expectedVersion: 0, pages });
    const user = userEvent.setup();
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
    const filter = await screen.findByRole("button", { name: "all" });
    await user.click(filter);
    await user.click(screen.getByRole("button", { name: "Add page" }));
    const dialog = within(screen.getByRole("dialog"));
    const name = dialog.getByRole("textbox", { name: "Page name" });
    expect(name).toHaveFocus();
    expect(dialog.getByRole("radio", { name: "Blank" })).toBeChecked();
    expect(dialog.getByRole("button", { name: "Add page" })).toBeDisabled();
    vi.mocked(fetch).mockClear();
    await user.click(dialog.getByRole("radio", { name: "Gathering" }));
    expect(name).toHaveValue("Gathering");
    expect(
      dialog.getByRole("region", { name: "Page preview" }),
    ).toHaveTextContent("To-dosItineraryExpenses");
    await user.clear(name);
    await user.type(name, "Our plans");
    await user.click(dialog.getByRole("radio", { name: "Multi-day" }));
    expect(name).toHaveValue("Our plans");
    expect(
      dialog.getByRole("region", { name: "Page preview" }),
    ).toHaveTextContent("CalendarItineraryFiles");
    await user.click(dialog.getByRole("radio", { name: "Blank" }));
    expect(dialog.queryByRole("list")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "all" })).toBe(filter);
    expect(filter).toHaveAttribute("aria-pressed", "true");
    expect((await client.getEventLayout(eventId)).pages).toEqual(pages);
  });

  it("appends a preset as one recoverable layout change without changing canonical records", async () => {
    const pages = [page("Preparation", ["todos"])];
    await client.updateEventLayout(eventId, { expectedVersion: 0, pages });
    const before = await client.getEventDetail(eventId);
    const user = userEvent.setup();
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
    await user.click(await screen.findByRole("button", { name: "Add page" }));
    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("radio", { name: "Gathering" }));
    await user.click(dialog.getByRole("button", { name: "Add page" }));
    await screen.findByText("Gathering page added.");
    const saved = await client.getEventLayout(eventId);
    expect(saved.version).toBe(2);
    expect(saved.pages[0]).toEqual(pages[0]);
    expect(saved.pages[1]?.components.map(({ kind }) => kind)).toEqual([
      "todos",
      "itinerary",
      "expenses",
    ]);
    expect(saved.pages[1]?.components[0]?.id).not.toBe(
      pages[0]?.components[0]?.id,
    );
    expect(await client.getEventDetail(eventId)).toEqual(before);
    await user.click(screen.getByRole("button", { name: "Page options" }));
    const recovery = within(screen.getByRole("dialog"));
    await user.click(
      recovery.getByRole("button", { name: "Undo layout change" }),
    );
    await waitFor(() =>
      expect(
        recovery.getByRole("button", { name: "Redo layout change" }),
      ).toBeEnabled(),
    );
    expect((await client.getEventLayout(eventId)).pages).toEqual(pages);
    await user.click(
      recovery.getByRole("button", { name: "Redo layout change" }),
    );
    await waitFor(() =>
      expect(
        recovery.getByRole("button", { name: "Undo layout change" }),
      ).toBeEnabled(),
    );
    expect((await client.getEventLayout(eventId)).pages).toEqual(saved.pages);
    await user.click(recovery.getByRole("button", { name: "Layout history" }));
    await user.click(
      await recovery.findByRole("button", { name: "Preview version 2" }),
    );
    expect(recovery.getByText(/To-dos, Itinerary, Expenses/)).toBeVisible();
    expect(await client.getEventDetail(eventId)).toEqual(before);
  });

  it.each([98, 100])(
    "respects the shared component limit with %s existing views",
    async (count) => {
      const pages = Array.from({ length: 5 }, (_, index) =>
        page(
          `Page ${index}`,
          Array.from(
            { length: Math.min(20, count - index * 20) },
            () => "files" as const,
          ),
        ),
      );
      await client.updateEventLayout(eventId, { expectedVersion: 0, pages });
      const user = userEvent.setup();
      render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
      await user.click(await screen.findByRole("button", { name: "Add page" }));
      const dialog = within(screen.getByRole("dialog"));
      await user.type(
        dialog.getByRole("textbox", { name: "Page name" }),
        "Notes",
      );
      await user.click(dialog.getByRole("radio", { name: "Multi-day" }));
      expect(dialog.getByText(/exceeds a layout limit/)).toBeVisible();
      expect(dialog.getByRole("button", { name: "Add page" })).toBeDisabled();
      await user.click(dialog.getByRole("radio", { name: "Blank" }));
      expect(dialog.queryByText(/exceeds a layout limit/)).toBeNull();
      await user.click(dialog.getByRole("button", { name: "Add page" }));
      await screen.findByText("Notes page added.");
      const saved = await client.getEventLayout(eventId);
      expect(saved.pages.slice(0, 5)).toEqual(pages);
      expect(saved.pages[5]?.components).toEqual([]);
    },
  );

  it("preserves preset and name on stale writes without overwriting the current layout", async () => {
    const user = userEvent.setup();
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
    await user.click(await screen.findByRole("button", { name: "Add page" }));
    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("radio", { name: "Gathering" }));
    const concurrent = [page("Another planner", ["calendar"])];
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: concurrent,
    });
    await user.click(dialog.getByRole("button", { name: "Add page" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "A newer version is available",
    );
    expect(dialog.getByRole("textbox", { name: "Page name" })).toHaveValue(
      "Gathering",
    );
    expect(dialog.getByRole("radio", { name: "Gathering" })).toBeChecked();
    expect((await client.getEventLayout(eventId)).pages).toEqual(concurrent);
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    await screen.findByRole("heading", { name: "Another planner" });
  });

  it("guards page creation during composition and an in-flight save", async () => {
    const user = userEvent.setup();
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
    await user.click(await screen.findByRole("button", { name: "Add page" }));
    const element = screen.getByRole("dialog");
    const dialog = within(element);
    await user.click(dialog.getByRole("radio", { name: "Gathering" }));
    const name = dialog.getByRole("textbox", { name: "Page name" });
    vi.mocked(fetch).mockClear();
    for (const properties of [{ isComposing: true }, { keyCode: 229 }])
      expect(fireEvent.keyDown(name, { key: "Enter", ...properties })).toBe(
        false,
      );
    expect(fetch).not.toHaveBeenCalled();
    const { promise, resolve } = Promise.withResolvers<void>();
    vi.mocked(fetch).mockImplementation(async (input, options) => {
      if (options?.method === "PATCH") await promise;
      return store.fetch(input, options);
    });
    await user.click(dialog.getByRole("button", { name: "Add page" }));
    expect(name).toBeDisabled();
    for (const radio of dialog.getAllByRole("radio"))
      expect(radio).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent(element, new Event("cancel", { cancelable: true }));
    expect(element).toBeVisible();
    resolve();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await client.getEventLayout(eventId)).version).toBe(1);
  });

  it("rejects a preset write when the server has revoked editing permission", async () => {
    const user = userEvent.setup();
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
    await user.click(await screen.findByRole("button", { name: "Add page" }));
    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("radio", { name: "Gathering" }));
    vi.mocked(fetch).mockImplementation((input, options) =>
      store.fetch(input, options, "viewer"),
    );
    await user.click(dialog.getByRole("button", { name: "Add page" }));
    expect(await dialog.findByRole("alert")).toBeVisible();
    expect(dialog.getByRole("radio", { name: "Gathering" })).toBeChecked();
    expect((await client.getEventLayout(eventId)).pages).toEqual([]);
  });

  it("discards page presets on edit-access loss without reviving them", async () => {
    const user = userEvent.setup();
    const view = render(<EventPages eventId={eventId} canEdit />, {
      wrapper: Providers,
    });
    await user.click(await screen.findByRole("button", { name: "Add page" }));
    await user.click(screen.getByRole("radio", { name: "Gathering" }));
    view.rerender(<EventPages eventId={eventId} canEdit={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(<EventPages eventId={eventId} canEdit />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((await client.getEventLayout(eventId)).pages).toEqual([]);
  });

  it("keeps the Task view mounted and performs no writes when toggling arrangement", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Plan", ["todos", "calendar"])],
    });
    const user = userEvent.setup();
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
    const filter = await screen.findByRole("button", { name: "all" });
    await user.click(filter);
    const trigger = screen.getByRole("button", { name: "Arrange layout" });
    expect(screen.queryByRole("group", { name: /layout controls/ })).toBeNull();
    const before = await client.getEventLayout(eventId);
    vi.mocked(fetch).mockClear();
    await user.click(trigger);
    expect(
      screen.getAllByRole("group", { name: /layout controls/ }),
    ).toHaveLength(2);
    expect(screen.getByText(/Moves save immediately/)).toBeVisible();
    expect(screen.getByRole("button", { name: "all" })).toBe(filter);
    expect(filter).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{Enter}");
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveTextContent("Arrange");
    expect(screen.queryByRole("group", { name: /layout controls/ })).toBeNull();
    expect(screen.getByRole("button", { name: "all" })).toBe(filter);
    expect(filter).toHaveAttribute("aria-pressed", "true");
    expect(fetch).not.toHaveBeenCalled();
    expect(await client.getEventLayout(eventId)).toEqual(before);
  });

  it.each(["finish", "access-loss"])(
    "discards a drag after %s without reviving Arrange mode or writing a layout",
    async (reason) => {
      await client.updateEventLayout(eventId, {
        expectedVersion: 0,
        pages: [page("Plan", ["todos"]), page("Day", [])],
      });
      const user = userEvent.setup();
      const view = render(<EventPages eventId={eventId} canEdit />, {
        wrapper: Providers,
      });
      await user.click(
        await screen.findByRole("button", { name: "Arrange layout" }),
      );
      const dataTransfer = {
        setData: vi.fn(),
        effectAllowed: "",
        dropEffect: "",
      };
      fireEvent.dragStart(screen.getByRole("button", { name: "Drag To-dos" }), {
        dataTransfer,
      });
      expect(screen.getByText("Drop at end of Plan")).toBeVisible();
      if (reason === "finish")
        await user.click(
          screen.getByRole("button", { name: "Done arranging" }),
        );
      else {
        view.rerender(<EventPages eventId={eventId} canEdit={false} />);
        expect(screen.queryByRole("button", { name: /arrang/i })).toBeNull();
        expect(
          screen.queryByRole("button", { name: /^Move |^Drag / }),
        ).toBeNull();
        view.rerender(<EventPages eventId={eventId} canEdit />);
      }
      expect(
        screen.getByRole("button", { name: "Arrange layout" }),
      ).toBeVisible();
      expect(screen.queryByText("Drop at end of Plan")).toBeNull();
      fireEvent.drop(screen.getByRole("button", { name: "Day" }), {
        dataTransfer,
      });
      await user.click(screen.getByRole("button", { name: "Arrange layout" }));
      fireEvent.drop(screen.getByRole("button", { name: "Day" }), {
        dataTransfer,
      });
      expect((await client.getEventLayout(eventId)).version).toBe(1);
    },
  );

  it("updates the command destination and removes page actions during a canvas save", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Preparation", []), page("On the day", [])],
    });
    const { promise, resolve } = Promise.withResolvers<void>();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (input, options) => {
        if (options?.method === "PATCH") await promise;
        return store.fetch(input, options);
      }),
    );
    render(
      <WorkspaceCommandProvider pathname={`/events/${eventId}`}>
        <EventPages eventId={eventId} canEdit />
        <CommandProbe />
      </WorkspaceCommandProvider>,
      { wrapper: Providers },
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "On the day" }));
    const commands = screen.getByLabelText("Available page actions");
    expect(commands).toHaveTextContent("Choose a component for On the day");
    await user.click(screen.getByRole("button", { name: "Arrange layout" }));
    expect(commands).toHaveTextContent("Done arranging");
    await user.click(screen.getByRole("button", { name: "Move page earlier" }));
    await waitFor(() => expect(commands).toBeEmptyDOMElement());
    expect(
      screen.getByRole("button", { name: "Add component" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Done arranging" }),
    ).toBeDisabled();
    resolve();
    await waitFor(() =>
      expect(commands).toHaveTextContent("Choose a component for On the day"),
    );
  });

  it.each(["empty", "viewer", "page-limit", "component-limit", "total-limit"])(
    "matches context actions to the visible controls for %s",
    async (scenario) => {
      const full = () =>
        page(
          "Full page",
          Array.from({ length: 20 }, () => "files" as const),
        );
      const pages =
        scenario === "empty"
          ? []
          : scenario === "page-limit"
            ? Array.from({ length: 20 }, (_, i) => page(`Page ${i}`, []))
            : scenario === "component-limit"
              ? [full()]
              : scenario === "total-limit"
                ? [
                    page("Selected page", []),
                    ...Array.from({ length: 5 }, full),
                  ]
                : [page("Read-only page", [])];
      await client.updateEventLayout(eventId, { expectedVersion: 0, pages });
      render(
        <WorkspaceCommandProvider pathname={`/events/${eventId}`}>
          <EventPages eventId={eventId} canEdit={scenario !== "viewer"} />
          <CommandProbe />
        </WorkspaceCommandProvider>,
        { wrapper: Providers },
      );
      await screen.findByRole("region", { name: "Event pages" });
      const commands = screen.getByLabelText("Available page actions");
      for (const name of ["Add page", "Add component"]) {
        const available = screen.queryByRole("button", { name });
        if (available) expect(commands).toHaveTextContent(name);
        else expect(commands).not.toHaveTextContent(name);
      }
      if (scenario === "page-limit")
        expect(commands).toHaveTextContent("Choose a component for Page 0");
    },
  );

  it.each([false, true])(
    "explains the next step for empty layouts without offering viewer actions (canEdit=%s)",
    async (canEdit) => {
      const user = userEvent.setup();
      render(<EventPages eventId={eventId} canEdit={canEdit} />, {
        wrapper: Providers,
      });
      await screen.findByRole("heading", { name: "A place for your event" });
      expect(screen.queryByText(/Drag a handle/)).toBeNull();
      if (!canEdit) {
        expect(
          screen.getByText("The planner has not added any pages yet."),
        ).toBeVisible();
        expect(screen.queryByRole("button", { name: "Add page" })).toBeNull();
        return;
      }
      await user.click(screen.getByRole("button", { name: "Add page" }));
      const dialog = within(screen.getByRole("dialog", { name: "Add a page" }));
      const name = dialog.getByRole("textbox", { name: "Page name" });
      expect(name).toHaveAccessibleDescription(/Pages organize this event/);
      await user.type(name, "Preparation");
      await user.click(dialog.getByRole("button", { name: "Add page" }));
      await screen.findByRole("heading", { name: "Preparation" });
      expect(screen.getByText(/Choose Add component/)).toBeVisible();
      expect(screen.queryByText(/Drag a handle/)).toBeNull();
      await user.click(screen.getByRole("button", { name: "Add component" }));
      await user.click(screen.getByRole("button", { name: "Add To-dos" }));
      await user.click(screen.getByRole("button", { name: "Arrange layout" }));
      expect(screen.getByText(/Drag a handle/)).toBeVisible();
      expect(screen.queryByText(/Choose Add component/)).toBeNull();
    },
  );

  it("does not instruct a viewer to insert components into an empty page", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Preparation", [])],
    });
    render(<EventPages eventId={eventId} canEdit={false} />, {
      wrapper: Providers,
    });
    expect(
      await screen.findByText("This page has no components yet."),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add component" })).toBeNull();
    expect(screen.queryByText(/Drag a handle/)).toBeNull();
  });

  it.each([503, 403, 404])(
    "handles layout refresh status %s without losing drafts on temporary failures",
    async (status) => {
      await client.updateEventLayout(eventId, {
        expectedVersion: 0,
        pages: [page("Plan", ["todos"])],
      });
      let fail = false;
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof globalThis.fetch>((input, options) => {
          if (fail && String(input).endsWith("/layout"))
            return Promise.resolve(
              Response.json(
                {
                  error: { code: "unavailable", message: "Layout unavailable" },
                },
                { status },
              ),
            );
          return store.fetch(input, options);
        }),
      );
      const user = userEvent.setup();
      render(
        <>
          <EventPages eventId={eventId} canEdit />
          <RefreshProbe />
        </>,
        { wrapper: Providers },
      );
      await user.click(await screen.findByRole("button", { name: "Add task" }));
      const input = await screen.findByRole("textbox", { name: "Task" });
      await user.type(input, "Unfinished plan");
      fail = true;
      await user.click(screen.getByRole("button", { name: "Refetch layout" }));
      expect(
        await screen.findByRole("alert", {}, { timeout: 3000 }),
      ).toHaveTextContent("Layout unavailable");
      if (status === 503)
        expect(screen.getByRole("textbox", { name: "Task" })).toBe(input);
      else expect(screen.queryByRole("textbox", { name: "Task" })).toBeNull();
      fail = false;
      await user.click(screen.getByRole("button", { name: "Refresh latest" }));
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
      if (status !== 503)
        await user.click(screen.getByRole("button", { name: "Add task" }));
      expect(await screen.findByRole("textbox", { name: "Task" })).toHaveValue(
        status === 503 ? "Unfinished plan" : "",
      );
    },
  );

  it("confirms removal and walks undo, redo, and saved history without changing records", async () => {
    const pages = [page("Plan", ["todos", "calendar"])];
    await client.updateEventLayout(eventId, { expectedVersion: 0, pages });
    const before = await client.getEventDetail(eventId);
    const user = userEvent.setup();
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
    await user.click(
      await screen.findByRole("button", { name: "Page options" }),
    );
    const dialog = within(
      screen.getByRole("dialog", { name: "Manage event pages" }),
    );
    await user.click(
      dialog.getByRole("button", { name: "Remove To-dos from Plan" }),
    );
    expect((await client.getEventLayout(eventId)).pages).toEqual(pages);
    await user.click(
      dialog.getByRole("button", { name: "Remove from layout" }),
    );
    await waitFor(() =>
      expect(
        dialog.getByRole("button", { name: "Undo layout change" }),
      ).toBeEnabled(),
    );
    expect((await client.getEventLayout(eventId)).pages[0]?.components).toEqual(
      pages[0]?.components.slice(1),
    );
    await user.click(
      dialog.getByRole("button", { name: "Undo layout change" }),
    );
    await waitFor(() =>
      expect(
        dialog.getByRole("button", { name: "Redo layout change" }),
      ).toBeEnabled(),
    );
    expect((await client.getEventLayout(eventId)).pages).toEqual(pages);
    await user.click(
      dialog.getByRole("button", { name: "Redo layout change" }),
    );
    await waitFor(() =>
      expect(
        dialog.getByRole("button", { name: "Undo layout change" }),
      ).toBeEnabled(),
    );
    expect((await client.getEventLayout(eventId)).version).toBe(4);
    await user.click(dialog.getByRole("button", { name: "Remove page" }));
    await user.click(
      dialog.getByRole("button", { name: "Remove from layout" }),
    );
    await waitFor(() =>
      expect(dialog.getByText("No pages in this layout")).toBeVisible(),
    );
    await user.click(dialog.getByRole("button", { name: "Layout history" }));
    await user.click(
      await dialog.findByRole("button", { name: "Preview version 1" }),
    );
    expect(
      dialog.getByText("To-dos, Calendar", { exact: false }),
    ).toBeVisible();
    await user.click(dialog.getByRole("button", { name: "Restore layout" }));
    await waitFor(() =>
      expect(
        dialog.getByRole("heading", { name: "Version 6 (current)" }),
      ).toBeVisible(),
    );
    expect((await client.getEventLayout(eventId)).pages).toEqual(pages);
    expect(await client.getEventDetail(eventId)).toEqual(before);
    await user.click(dialog.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Page options" })).toHaveFocus();
  });

  it("requires an explicit refresh after a stale removal confirmation", async () => {
    const pages = [page("Plan", ["todos"])];
    await client.updateEventLayout(eventId, { expectedVersion: 0, pages });
    const user = userEvent.setup();
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
    await user.click(
      await screen.findByRole("button", { name: "Page options" }),
    );
    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Remove page" }));
    const external = [page("External", ["expenses"])];
    await client.updateEventLayout(eventId, {
      expectedVersion: 1,
      pages: external,
    });
    await user.click(
      dialog.getByRole("button", { name: "Remove from layout" }),
    );
    expect(await dialog.findByRole("alert")).toHaveTextContent(/changed/i);
    expect(
      dialog.getByRole("heading", { name: "Remove page Plan?" }),
    ).toBeVisible();
    expect((await client.getEventLayout(eventId)).pages).toEqual(external);
    await user.click(dialog.getByRole("button", { name: /Refresh/ }));
    expect(
      await dialog.findByRole("heading", { name: "External" }),
    ).toBeVisible();
    expect(
      dialog.getByRole("button", { name: "Undo layout change" }),
    ).toBeDisabled();
  });

  it("saves a chosen view with the layout and offers none to a viewer", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Plan", ["todos", "calendar"])],
    });
    const user = userEvent.setup();
    const { unmount } = render(<EventPages eventId={eventId} canEdit />, {
      wrapper: Providers,
    });
    // The sample task is due fourteen days from now; the heading names that day.
    const due = new Date();
    due.setDate(due.getDate() + 14);
    const dueDay = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(due);
    const dayHeading = (name: string) => name.startsWith(`${dueDay},`);
    const view = within(await screen.findByRole("group", { name: "View" }));
    expect(view.getByRole("button", { name: "List" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("table")).toBeVisible();
    await user.click(view.getByRole("button", { name: "By day" }));
    await screen.findByRole("region", { name: dayHeading });
    expect(screen.queryByRole("table")).toBeNull();
    await waitFor(() =>
      expect(screen.getByText("Shown by day.")).toHaveAttribute(
        "role",
        "status",
      ),
    );
    const layout = await client.getEventLayout(eventId);
    expect(layout.version).toBe(2);
    expect(
      layout.pages[0]?.components.map((component) => component.view),
    ).toEqual(["by-day", undefined]);
    // Calendar offers one view and shows no control.
    expect(screen.getAllByRole("group", { name: "View" })).toHaveLength(1);
    unmount();

    render(<EventPages eventId={eventId} canEdit={false} />, {
      wrapper: Providers,
    });
    await screen.findByRole("region", { name: dayHeading });
    expect(screen.queryByRole("group", { name: "View" })).toBeNull();
  });

  it("allows a viewer to preview saved layouts without mutation controls", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Plan", ["todos"])],
    });
    const user = userEvent.setup();
    render(<EventPages eventId={eventId} canEdit={false} />, {
      wrapper: Providers,
    });
    await user.click(
      await screen.findByRole("button", { name: "Layout history" }),
    );
    const dialog = within(
      screen.getByRole("dialog", { name: "Layout history" }),
    );
    await user.click(
      await dialog.findByRole("button", { name: "Preview version 1" }),
    );
    expect(dialog.getByText("To-dos", { exact: false })).toBeVisible();
    expect(dialog.queryByRole("button", { name: "Restore layout" })).toBeNull();
    expect(
      dialog.queryByRole("button", { name: "Undo layout change" }),
    ).toBeNull();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(
          ([, options]) => !options?.method || options.method === "GET",
        ),
    ).toBe(true);
  });

  it("renders every component using existing projections without changing business records", async () => {
    const before = await client.getEventDetail(eventId);
    const pages = [page("Plan", eventComponentKindSchema.options)];
    await client.updateEventLayout(eventId, { expectedVersion: 0, pages });
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
    for (const { label } of Object.values(eventComponents)) {
      expect(await screen.findByRole("heading", { name: label })).toBeVisible();
    }
    expect(await screen.findByText("No files attached")).toBeVisible();
    expect(await client.getEventDetail(eventId)).toEqual(before);
    expect(
      screen.getAllByText("Welcome and coffee", { exact: true }),
    ).toHaveLength(3);
    const paths = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
    expect(paths.filter((path) => path.endsWith("/detail"))).toHaveLength(1);
    expect(paths.filter((path) => path.endsWith("/calendar"))).toHaveLength(1);
  });

  it("coalesces duplicate components, loads only the selected page, and preserves independent filters", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Work", ["todos", "todos"]), page("Schedule", ["calendar"])],
    });
    const user = userEvent.setup();
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
    await waitFor(() =>
      expect(screen.getAllByRole("heading", { name: "To-dos" })).toHaveLength(
        2,
      ),
    );
    const requests = () =>
      vi.mocked(fetch).mock.calls.map(([input]) => String(input));
    expect(requests().filter((path) => path.endsWith("/todos"))).toHaveLength(
      1,
    );
    expect(requests().some((path) => path.endsWith("/calendar"))).toBe(false);
    const [first, second] = screen
      .getAllByRole("heading", { name: "To-dos" })
      .map((heading) => {
        const panel = heading.closest("section");
        assert(panel);
        return within(panel);
      });
    assert(first && second);
    await user.click(
      first.getByRole("button", {
        name: "Complete Confirm the garden venue",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", {
          name: "Complete Confirm the garden venue",
        }),
      ).toBeNull(),
    );
    await user.click(first.getByRole("button", { name: "all" }));
    expect(
      first.getByRole("button", {
        name: "Reopen Confirm the garden venue",
      }),
    ).toBeVisible();
    expect(
      second.queryByRole("button", {
        name: "Reopen Confirm the garden venue",
      }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Schedule" }));
    expect(
      await screen.findByRole("heading", { name: "Calendar" }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: "To-dos" })).toBeNull();
    expect(
      requests().filter((path) => path.endsWith("/calendar")),
    ).toHaveLength(1);
  });

  it("keeps a failed projection local to its component and retries it independently", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Plan", ["todos", "calendar"])],
    });
    let fail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>((input, options) => {
        if (String(input).endsWith("/calendar") && fail)
          return Promise.resolve(
            Response.json(
              {
                error: {
                  code: "service_unavailable",
                  message: "Schedule unavailable",
                },
              },
              { status: 503 },
            ),
          );
        return store.fetch(input, options);
      }),
    );
    const user = userEvent.setup();
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
    expect(
      await screen.findByRole("heading", { name: "To-dos" }),
    ).toBeVisible();
    expect(
      await screen.findByRole("alert", {}, { timeout: 3000 }),
    ).toHaveTextContent("Schedule unavailable");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Refresh latest" }));
    expect(
      await screen.findByRole("heading", { name: "Calendar" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "To-dos" })).toBeVisible();
  });

  it("offers all component kinds in a focused picker and preserves selection on a stale save", async () => {
    const pages = [page("Plan", [])];
    await client.updateEventLayout(eventId, { expectedVersion: 0, pages });
    const user = userEvent.setup();
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
    const trigger = await screen.findByRole("button", {
      name: "Add component",
    });
    await user.click(trigger);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getAllByRole("radio")).toHaveLength(7);
    expect(
      dialog.getByRole("searchbox", { name: "Find a component" }),
    ).toHaveFocus();
    await user.click(dialog.getByRole("radio", { name: /^Calendar/ }));
    await client.updateEventLayout(eventId, { expectedVersion: 1, pages });
    await user.click(dialog.getByRole("button", { name: "Add Calendar" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "A newer version is available",
    );
    expect(dialog.getByRole("radio", { name: /^Calendar/ })).toBeChecked();
    expect((await client.getEventLayout(eventId)).pages).toEqual(pages);
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(trigger).toHaveFocus();
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.filter(([input]) => String(input).endsWith("/layout"))
          .length,
      ).toBeGreaterThan(2),
    );
  });

  it("quick-inserts a filtered component without intercepting typing in fields", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Plan", ["todos"])],
    });
    const user = userEvent.setup();
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
    await user.click(await screen.findByRole("button", { name: "Plan" }));
    await user.keyboard("/");
    const search = screen.getByRole("searchbox", { name: "Find a component" });
    expect(search).toHaveFocus();
    await user.type(search, "/unknown");
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Add component",
      }),
    ).toBeDisabled();
    await user.clear(search);
    await user.type(search, "/calendar{Enter}");
    expect(
      await screen.findByRole("heading", { name: "Calendar" }),
    ).toBeVisible();
    expect(
      (await client.getEventLayout(eventId)).pages[0]?.components.map(
        (item) => item.kind,
      ),
    ).toEqual(["todos", "calendar"]);
    await user.click(screen.getByRole("button", { name: "Add task" }));
    const input = screen.getByRole("textbox", { name: "Task" });
    await user.type(input, "Plan / review");
    expect(input).toHaveValue("Plan / review");
    expect(screen.getByRole("dialog", { name: "Add task" })).toBeVisible();
    expect(
      screen.queryByRole("searchbox", { name: "Find a component" }),
    ).toBeNull();
  });

  it("explains repeated views and adds only a layout reference to the selected page", async () => {
    const pages = [page("Preparation", ["todos"]), page("On the day", [])];
    const before = await client.getEventDetail(eventId);
    await client.updateEventLayout(eventId, { expectedVersion: 0, pages });
    const user = userEvent.setup();
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
    await user.click(await screen.findByRole("button", { name: "On the day" }));
    await user.click(screen.getByRole("button", { name: "Add component" }));
    const dialog = within(screen.getByRole("dialog"));
    const search = dialog.getByRole("searchbox", { name: "Find a component" });
    expect(search).toHaveAccessibleDescription("Add to On the day.");
    expect(
      dialog.getByText(/To-dos is already used on another page/),
    ).toBeVisible();
    vi.mocked(fetch).mockClear();
    await user.type(search, "no matching view");
    expect(dialog.queryAllByRole("radio")).toHaveLength(0);
    await user.click(dialog.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveFocus();
    expect(dialog.getAllByRole("radio")).toHaveLength(7);
    await user.type(search, "checklist");
    await user.keyboard("{ArrowDown}");
    expect(dialog.getByRole("radio", { name: "To-dos" })).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
    await user.click(dialog.getByRole("button", { name: "Add To-dos" }));
    expect(
      await screen.findByText("To-dos added to On the day."),
    ).toBeVisible();
    const saved = await client.getEventLayout(eventId);
    expect(saved.version).toBe(2);
    expect(saved.pages[0]).toEqual(pages[0]);
    expect(saved.pages[1]?.components).toEqual([
      { id: expect.any(String), kind: "todos" },
    ]);
    expect(await client.getEventDetail(eventId)).toEqual(before);
    await user.click(screen.getByRole("button", { name: "Add component" }));
    expect(
      screen.getByText(/To-dos is already used on this page/),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect((await client.getEventLayout(eventId)).version).toBe(2);
  });

  it("keeps catalog interaction inert during composition and a pending save", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Plan", [])],
    });
    const user = userEvent.setup();
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
    await user.click(
      await screen.findByRole("button", { name: "Add component" }),
    );
    const element = screen.getByRole("dialog");
    const dialog = within(element);
    const search = dialog.getByRole("searchbox", { name: "Find a component" });
    vi.mocked(fetch).mockClear();
    for (const properties of [{ isComposing: true }, { keyCode: 229 }]) {
      expect(fireEvent.keyDown(search, { key: "Enter", ...properties })).toBe(
        false,
      );
      fireEvent.keyDown(search, { key: "ArrowDown", ...properties });
      expect(search).toHaveFocus();
    }
    expect(fetch).not.toHaveBeenCalled();
    const { promise, resolve } = Promise.withResolvers<void>();
    vi.mocked(fetch).mockImplementation(async (input, options) => {
      if (options?.method === "PATCH") await promise;
      return store.fetch(input, options);
    });
    await user.click(dialog.getByRole("button", { name: "Add To-dos" }));
    expect(search).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent(element, new Event("cancel", { cancelable: true }));
    expect(element).toBeVisible();
    resolve();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await client.getEventLayout(eventId)).version).toBe(2);
  });

  it("closes the catalog when edit access is lost without inserting anything", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Plan", [])],
    });
    const user = userEvent.setup();
    const view = render(<EventPages eventId={eventId} canEdit />, {
      wrapper: Providers,
    });
    await user.click(
      await screen.findByRole("button", { name: "Add component" }),
    );
    await user.type(
      screen.getByRole("searchbox", { name: "Find a component" }),
      "costs",
    );
    view.rerender(<EventPages eventId={eventId} canEdit={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(<EventPages eventId={eventId} canEdit />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((await client.getEventLayout(eventId)).version).toBe(1);
  });

  it("moves components and pages with accessible controls while preserving canonical data", async () => {
    const pages = [page("Work", ["todos", "calendar"]), page("Day", [])];
    const before = await client.getEventDetail(eventId);
    await client.updateEventLayout(eventId, { expectedVersion: 0, pages });
    const user = userEvent.setup();
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
    await user.click(
      await screen.findByRole("button", { name: "Arrange layout" }),
    );
    const down = await screen.findByRole("button", {
      name: "Move To-dos down",
    });
    await user.click(down);
    await waitFor(() => expect(down).toBeDisabled());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Drag To-dos" })).toHaveFocus(),
    );
    expect(
      screen
        .getAllByRole("region", { name: /component \d/ })
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual(["Calendar component 1", "To-dos component 2"]);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Move To-dos to page" }),
      pages[1]?.id ?? "",
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Day" })).toHaveAttribute(
        "aria-current",
        "page",
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Day" })).toHaveFocus(),
    );
    await user.click(screen.getByRole("button", { name: "Move page earlier" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Move page earlier" }),
      ).toBeDisabled(),
    );
    const saved = await client.getEventLayout(eventId);
    expect(saved.version).toBe(4);
    expect(saved.pages.map((item) => item.id)).toEqual([
      pages[1]?.id,
      pages[0]?.id,
    ]);
    expect(saved.pages[0]?.components).toEqual([pages[0]?.components[0]]);
    expect(saved.pages[1]?.components).toEqual([pages[0]?.components[1]]);
    expect(await client.getEventDetail(eventId)).toEqual(before);
  });

  it("keeps the displayed layout on conflict and requires a refresh before retrying", async () => {
    const pages = [page("Work", ["todos", "calendar"]), page("Day", [])];
    await client.updateEventLayout(eventId, { expectedVersion: 0, pages });
    const user = userEvent.setup();
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
    await user.click(
      await screen.findByRole("button", { name: "Arrange layout" }),
    );
    const concurrent = pages.map((item) => ({
      ...item,
      name: `Updated ${item.name}`,
    }));
    await client.updateEventLayout(eventId, {
      expectedVersion: 1,
      pages: concurrent,
    });
    await user.click(screen.getByRole("button", { name: "Move To-dos down" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A newer version is available",
    );
    expect(
      screen.getAllByRole("region", { name: /component \d/ })[0],
    ).toHaveAttribute("aria-label", "To-dos component 1");
    expect((await client.getEventLayout(eventId)).pages).toEqual(concurrent);
    await user.click(screen.getByRole("button", { name: "Refresh latest" }));
    await screen.findByRole("button", { name: "Updated Work" });
    await user.click(screen.getByRole("button", { name: "Move To-dos down" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Move To-dos down" }),
      ).toBeDisabled(),
    );
    expect((await client.getEventLayout(eventId)).version).toBe(3);
  });

  it("keeps the default selected page open when moving it later", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Work", []), page("Day", [])],
    });
    const user = userEvent.setup();
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
    await user.click(
      await screen.findByRole("button", { name: "Arrange layout" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Move page later" }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("navigation", { name: "Pages" }))
          .getAllByRole("button")
          .map((button) => button.textContent),
      ).toEqual(["Day", "Work"]),
    );
    expect(screen.getByRole("heading", { name: "Work" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Work" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("ignores external drops and rejects a drag based on an outdated layout snapshot", async () => {
    const pages = [page("Work", ["todos", "calendar"]), page("Day", [])];
    await client.updateEventLayout(eventId, { expectedVersion: 0, pages });
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Arrange layout" }));
    const target = await screen.findByRole("button", { name: "Day" });
    const dataTransfer = {
      setData: vi.fn(),
      effectAllowed: "",
      dropEffect: "",
    };
    fireEvent.drop(target, { dataTransfer });
    expect((await client.getEventLayout(eventId)).version).toBe(1);
    const handle = screen.getByRole("button", { name: "Drag To-dos" });
    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.drop(screen.getByRole("region", { name: "To-dos component 1" }), {
      dataTransfer,
    });
    expect((await client.getEventLayout(eventId)).version).toBe(1);
    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.dragEnd(handle, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    expect((await client.getEventLayout(eventId)).version).toBe(1);
    fireEvent.dragStart(screen.getByRole("button", { name: "Drag To-dos" }), {
      dataTransfer,
    });
    await client.updateEventLayout(eventId, { expectedVersion: 1, pages });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A newer version is available",
    );
    expect((await client.getEventLayout(eventId)).pages).toEqual(pages);
    expect(screen.queryByText("Drop at end of Work")).toBeNull();
  });

  it("lets viewers use mixed pages without showing mutation controls", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Plan", eventComponentKindSchema.options)],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>((input, options) =>
        store.fetch(input, options, "viewer"),
      ),
    );
    render(<EventPages eventId={eventId} canEdit={false} />, {
      wrapper: Providers,
    });
    expect(await screen.findByText("Read-only files")).toBeVisible();
    for (const label of [
      "Arrange layout",
      "Add component",
      "Add page",
      "Add schedule item",
      "Add task",
      "Add expense",
      "Add reminder",
      "Attach file",
    ]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
    expect(
      screen.getByRole("button", { name: "Complete Confirm the garden venue" }),
    ).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^Drag / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Plan" }));
    await user.keyboard("/");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
