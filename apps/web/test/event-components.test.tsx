// @vitest-environment jsdom

import { ChronelleApiClient } from "@chronelle/api-client";
import {
  type EventComponentKind,
  eventComponentKindSchema,
} from "@chronelle/schemas";
import { useQueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  assert,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Providers } from "../app/providers";
import {
  useContextCommands,
  WorkspaceCommandProvider,
} from "../components/context-commands";
import {
  addDays,
  type DayKey,
  dayKeyOf,
  monthDays,
  parseDayKey,
} from "../lib/day-placement";
import {
  eventComponentKinds,
  componentKindLabel,
  eventComponents,
} from "../lib/event-components";
import { queryKeys } from "../lib/queries";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";
import { PagesHarness } from "./pages-harness";
import { openTaskEditor } from "./quick-add-support";
import { chooseRowAction } from "./row-menu-support";

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

const pageOptions = () => screen.getByRole("button", { name: /^Options for / });
async function choosePageOption(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(pageOptions());
  await user.click(screen.getByRole("menuitem", { name }));
}
const arrange = (user: ReturnType<typeof userEvent.setup>) =>
  choosePageOption(user, "Arrange components");

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
  it.each([200, 404])(
    "loads itinerary and to-dos concurrently behind the itinerary's loading and access state (%s)",
    async (status) => {
      await client.updateEventLayout(eventId, {
        expectedVersion: 0,
        pages: [page("Day", ["itinerary"])],
      });
      const release = Promise.withResolvers<void>();
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, options) => {
        if (String(input).endsWith("/itinerary")) {
          await release.promise;
          if (status === 404)
            return Response.json(
              {
                error: {
                  code: "not_found",
                  message: "The itinerary is unavailable.",
                  requestId: "request",
                },
              },
              { status },
            );
        }
        return store.fetch(input, options);
      });
      vi.stubGlobal("fetch", fetch);
      render(<PagesHarness eventId={eventId} canEdit />, {
        wrapper: Providers,
      });
      try {
        await waitFor(() => {
          for (const view of ["itinerary", "todos"])
            expect(
              fetch.mock.calls.filter(([url]) =>
                String(url).endsWith(`/${view}`),
              ),
            ).toHaveLength(1);
        });
        expect(screen.queryByRole("heading", { name: "Itinerary" })).toBeNull();
      } finally {
        await act(async () => release.resolve());
      }
      if (status === 200)
        expect(
          await screen.findByRole("heading", { name: "Itinerary" }),
        ).toBeVisible();
      else {
        expect(
          await screen.findByText("The itinerary is unavailable."),
        ).toBeVisible();
        expect(screen.queryByText("Confirm the garden venue")).toBeNull();
      }
    },
  );

  it("loads the Files target names without the full event detail", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Files", ["files"])],
    });
    const detail = await client.getEventDetail(eventId);
    const summary = ({
      id,
      displayName,
    }: {
      id: string;
      displayName: string;
    }) => ({ id, displayName });
    await expect(client.getEventAttachmentTargets(eventId)).resolves.toEqual({
      event: summary(detail.event),
      tasks: detail.tasks.map(summary),
      expenses: detail.expenses.map(summary),
    });
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    await screen.findByRole("heading", { name: "Files" });
    const requests = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(requests).toContain(`/api/events/${eventId}/attachment-targets`);
    expect(requests).not.toContain(`/api/events/${eventId}/detail`);
  });

  it("previews presets locally and preserves custom names and the underlying Task view on cancel", async () => {
    const pages = [page("Plan", ["todos"])];
    await client.updateEventLayout(eventId, { expectedVersion: 0, pages });
    const user = userEvent.setup();
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    const filter = await screen.findByRole("button", { name: "Filter" });
    await user.click(filter);
    await user.click(screen.getByRole("menuitemradio", { name: "All" }));
    await user.keyboard("{Escape}");
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
    ).toHaveTextContent("To-dosCalendarExpenses");
    await user.clear(name);
    await user.type(name, "Our plans");
    await user.click(dialog.getByRole("radio", { name: "Multi-day" }));
    expect(name).toHaveValue("Our plans");
    expect(
      dialog.getByRole("region", { name: "Page preview" }),
    ).toHaveTextContent("CalendarFiles");
    await user.click(dialog.getByRole("radio", { name: "Blank" }));
    expect(dialog.queryByRole("list")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Filter: 1 filter" })).toBe(
      filter,
    );
    expect(filter).toHaveClass("is-active");
    expect((await client.getEventLayout(eventId)).pages).toEqual(pages);
  });

  it("appends a preset as one recoverable layout change without changing canonical records", async () => {
    const pages = [page("Preparation", ["todos"])];
    await client.updateEventLayout(eventId, { expectedVersion: 0, pages });
    const before = await client.getEventDetail(eventId);
    const user = userEvent.setup();
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    await user.click(await screen.findByRole("button", { name: "Add page" }));
    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("radio", { name: "Gathering" }));
    await user.click(dialog.getByRole("button", { name: "Add page" }));
    await screen.findByText("Gathering page added.");
    const saved = await client.getEventLayout(eventId);
    expect(saved.version).toBe(2);
    expect(saved.pages[0]).toEqual(pages[0]);
    expect(
      saved.pages[1]?.components.map(({ kind, view }) => [kind, view]),
    ).toEqual([
      ["todos", undefined],
      ["calendar", "agenda"],
      ["expenses", undefined],
    ]);
    expect(saved.pages[1]?.components[0]?.id).not.toBe(
      pages[0]?.components[0]?.id,
    );
    expect(await client.getEventDetail(eventId)).toEqual(before);
    await choosePageOption(user, "Page options");
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
    expect(recovery.getByText(/To-dos, Calendar, Expenses/)).toBeVisible();
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
      render(<PagesHarness eventId={eventId} canEdit />, {
        wrapper: Providers,
      });
      await user.click(await screen.findByRole("button", { name: "Add page" }));
      const dialog = within(screen.getByRole("dialog"));
      await user.type(
        dialog.getByRole("textbox", { name: "Page name" }),
        "Notes",
      );
      await user.click(dialog.getByRole("radio", { name: "Gathering" }));
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
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
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
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
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
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
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
    const view = render(<PagesHarness eventId={eventId} canEdit />, {
      wrapper: Providers,
    });
    await user.click(await screen.findByRole("button", { name: "Add page" }));
    await user.click(screen.getByRole("radio", { name: "Gathering" }));
    view.rerender(<PagesHarness eventId={eventId} canEdit={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(<PagesHarness eventId={eventId} canEdit />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((await client.getEventLayout(eventId)).pages).toEqual([]);
  });

  it("keeps the Task view mounted and performs no writes when toggling arrangement", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Plan", ["todos", "calendar"])],
    });
    const user = userEvent.setup();
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    const filter = await screen.findByRole("button", { name: "Filter" });
    await user.click(filter);
    await user.click(screen.getByRole("menuitemradio", { name: "All" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: /layout controls/ })).toBeNull();
    const before = await client.getEventLayout(eventId);
    vi.mocked(fetch).mockClear();
    await arrange(user);
    expect(
      screen.getAllByRole("group", { name: /layout controls/ }),
    ).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Filter: 1 filter" })).toBe(
      filter,
    );
    expect(filter).toHaveClass("is-active");
    await user.click(screen.getByRole("button", { name: "Done arranging" }));
    expect(pageOptions()).toHaveFocus();
    expect(screen.queryByRole("group", { name: /layout controls/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Filter: 1 filter" })).toBe(
      filter,
    );
    expect(filter).toHaveClass("is-active");
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
      const view = render(<PagesHarness eventId={eventId} canEdit />, {
        wrapper: Providers,
      });
      await screen.findByRole("region", { name: "Event pages" });
      await arrange(user);
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
        view.rerender(<PagesHarness eventId={eventId} canEdit={false} />);
        expect(screen.queryByRole("button", { name: /arrang/i })).toBeNull();
        expect(
          screen.queryByRole("button", { name: /^Move |^Drag / }),
        ).toBeNull();
        view.rerender(<PagesHarness eventId={eventId} canEdit />);
      }
      expect(
        screen.queryByRole("button", { name: "Done arranging" }),
      ).toBeNull();
      expect(screen.queryByText("Drop at end of Plan")).toBeNull();
      fireEvent.drop(screen.getByRole("button", { name: "Day" }), {
        dataTransfer,
      });
      await arrange(user);
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
        <PagesHarness eventId={eventId} canEdit />
        <CommandProbe />
      </WorkspaceCommandProvider>,
      { wrapper: Providers },
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "On the day" }));
    const commands = screen.getByLabelText("Available page actions");
    expect(commands).toHaveTextContent("Choose a component for On the day");
    await arrange(user);
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
          <PagesHarness eventId={eventId} canEdit={scenario !== "viewer"} />
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
      render(<PagesHarness eventId={eventId} canEdit={canEdit} />, {
        wrapper: Providers,
      });
      await screen.findByRole("region", { name: "Event pages" });
      if (!canEdit) {
        expect(screen.getByText("No pages yet.")).toBeVisible();
        expect(screen.queryByRole("button", { name: "Add page" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Add a page" })).toBeNull();
        return;
      }
      await user.click(screen.getByRole("button", { name: "Add a page" }));
      const dialog = within(screen.getByRole("dialog", { name: "Add a page" }));
      const name = dialog.getByRole("textbox", { name: "Page name" });
      expect(name).not.toHaveAccessibleDescription(/Pages organize/);
      expect(
        dialog.getByRole("button", { name: "About this dialog" }),
      ).toHaveAttribute("aria-expanded", "false");
      await user.type(name, "Preparation");
      await user.click(dialog.getByRole("button", { name: "Add page" }));
      await screen.findByRole("heading", { name: "Preparation" });
      expect(
        screen.getByRole("button", { name: "Add component" }),
      ).toBeVisible();
      expect(
        screen.queryByRole("group", { name: /layout controls/ }),
      ).toBeNull();
      await user.click(screen.getByRole("button", { name: "Add component" }));
      await user.click(screen.getByRole("button", { name: "Add To-dos" }));
      await arrange(user);
      expect(
        screen.getByRole("button", { name: "Done arranging" }),
      ).toBeVisible();
      expect(
        screen.getAllByRole("group", { name: /layout controls/ }),
      ).toHaveLength(1);
    },
  );

  it("does not instruct a viewer to insert components into an empty page", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Preparation", [])],
    });
    render(<PagesHarness eventId={eventId} canEdit={false} />, {
      wrapper: Providers,
    });
    expect(await screen.findByText("No components yet.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add component" })).toBeNull();
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
          <PagesHarness eventId={eventId} canEdit />
          <RefreshProbe />
        </>,
        { wrapper: Providers },
      );
      await openTaskEditor(user);
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
      if (status !== 503) await openTaskEditor(user);
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
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    await screen.findByRole("region", { name: "Event pages" });
    await choosePageOption(user, "Page options");
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
    expect(pageOptions()).toHaveFocus();
  });

  it("requires an explicit refresh after a stale removal confirmation", async () => {
    const pages = [page("Plan", ["todos"])];
    await client.updateEventLayout(eventId, { expectedVersion: 0, pages });
    const user = userEvent.setup();
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    await screen.findByRole("region", { name: "Event pages" });
    await choosePageOption(user, "Page options");
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
    const { unmount } = render(<PagesHarness eventId={eventId} canEdit />, {
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
    const layoutButton = await screen.findByRole("button", {
      name: "Layout: List",
    });
    expect(screen.getByRole("table")).toBeVisible();
    await user.click(layoutButton);
    await user.click(screen.getByRole("menuitemradio", { name: "By day" }));
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
    // Calendar offers its own layouts: list, agenda, week, board, calendar.
    const layouts = screen.getAllByRole("button", { name: /^Layout: / });
    expect(layouts).toHaveLength(2);
    await user.click(layouts[1] as HTMLElement);
    expect(
      screen.getAllByRole("menuitemradio").map((item) => item.textContent),
    ).toEqual(["List", "Agenda", "By week", "Board", "Calendar"]);
    await user.keyboard("{Escape}");
    unmount();

    render(<PagesHarness eventId={eventId} canEdit={false} />, {
      wrapper: Providers,
    });
    await screen.findByRole("region", { name: dayHeading });
    expect(screen.queryByRole("button", { name: /^Layout: / })).toBeNull();
  });

  it("shows To-dos and Calendar by week and by month around today without saving the period", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Plan", ["todos", "calendar"])],
    });
    const today = dayKeyOf(new Date());
    const tomorrow = dayKeyOf(addDays(new Date(), 1));
    const inTwoWeeks = dayKeyOf(addDays(new Date(), 14));
    await client.createEventResource(eventId, {
      commandId: crypto.randomUUID(),
      resource: {
        objectType: "task",
        displayName: "Confirm the caterer",
        dueOn: today,
      },
    });
    await client.createEventResource(eventId, {
      commandId: crypto.randomUUID(),
      resource: {
        objectType: "event",
        displayName: "Setup weekend",
        startsOn: today,
        endsOn: tomorrow,
      },
    });
    const fullDay = (day: DayKey) =>
      new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(parseDayKey(day));
    const user = userEvent.setup();
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    await screen.findByText("Confirm the caterer");
    const panel = (title: string) =>
      within(
        screen
          .getByRole("heading", { name: title })
          .closest(".planning-panel") as HTMLElement,
      );
    const version = async () => (await client.getEventLayout(eventId)).version;

    // To-dos by week: today's column holds today's task, undated tasks sit
    // under the strip, and moving the period is session state only.
    const todos = panel("To-dos");
    await user.click(todos.getByRole("button", { name: "Filter" }));
    await user.click(todos.getByRole("menuitemradio", { name: "All" }));
    await user.keyboard("{Escape}");
    const choose = async (panel: ReturnType<typeof within>, view: string) => {
      await user.click(panel.getByRole("button", { name: /^Layout: / }));
      await user.click(panel.getByRole("menuitemradio", { name: view }));
    };
    await choose(todos, "By week");
    const todayColumn = () =>
      within(todos.getByRole("listitem", { name: fullDay(today) }));
    expect(todayColumn().getByText("Confirm the caterer")).toBeVisible();
    expect(
      within(todos.getByRole("region", { name: "No due date" })).getByText(
        "Send invitations",
      ),
    ).toBeVisible();
    expect(todos.queryByText("Confirm the garden venue")).toBeNull();
    await waitFor(async () => expect(await version()).toBe(2));
    const todosPeriod = todos.getByRole("group", { name: "Period" });
    await user.click(
      within(todosPeriod).getByRole("button", { name: "Next week" }),
    );
    await user.click(
      within(todosPeriod).getByRole("button", { name: "Next week" }),
    );
    expect(
      within(
        todos.getByRole("listitem", { name: fullDay(inTwoWeeks) }),
      ).getByText("Confirm the garden venue"),
    ).toBeVisible();
    expect(todos.queryByText("Confirm the caterer")).toBeNull();
    expect(await version()).toBe(2);
    await user.click(
      within(todosPeriod).getByRole("button", { name: "This week" }),
    );
    await user.click(
      todayColumn().getByRole("button", {
        name: "Complete Confirm the caterer",
      }),
    );
    expect(
      await todayColumn().findByRole("button", {
        name: "Reopen Confirm the caterer",
      }),
    ).toBeVisible();

    // To-dos as a calendar: today's cell holds its task as a row with the
    // same check; the grid ends with the week of the month's last day.
    await choose(todos, "Calendar");
    const todayCell = todos.getByRole("cell", {
      name: `${fullDay(today)}, 1 item`,
    });
    expect(
      within(todayCell).getByText("Confirm the caterer").closest("li"),
    ).toHaveClass("is-done");
    expect(
      within(todayCell).getByRole("button", {
        name: "Reopen Confirm the caterer",
      }),
    ).toBeInTheDocument();
    const monthCells = monthDays(new Date());
    const cells = todos.getAllByRole("cell");
    expect(cells).toHaveLength(monthCells.length);
    // The last cell ends the week of the month's last day; the sample task
    // two weeks out lands on it on some days, so only the day is checked.
    expect(cells.at(-1)).toHaveAccessibleName(
      new RegExp(`^${fullDay(monthCells.at(-1) as DayKey)}(,|$)`),
    );
    await waitFor(async () => expect(await version()).toBe(3));

    // Calendar by week and by month: a two-day item sits on both of its
    // days; the sample item two weeks out stays outside the current period.
    const calendar = panel("Calendar");
    await choose(calendar, "By week");
    expect(
      within(
        calendar.getByRole("listitem", { name: fullDay(today) }),
      ).getByText("Setup weekend"),
    ).toBeVisible();
    expect(calendar.queryByText("Welcome and coffee")).toBeNull();
    await choose(calendar, "Calendar");
    expect(
      calendar
        .getAllByRole("cell")
        .filter((cell) => cell.textContent?.includes("Setup weekend")),
    ).toHaveLength(monthCells.includes(tomorrow) ? 2 : 1);
    expect(
      within(
        calendar.getByRole("cell", { name: `${fullDay(today)}, 1 item` }),
      ).getByRole("heading", { name: "Setup weekend" }),
    ).toBeVisible();
    await waitFor(async () => expect(await version()).toBe(5));
    const layout = await client.getEventLayout(eventId);
    expect(
      layout.pages[0]?.components.map((component) => component.view),
    ).toEqual(["month", "month"]);
  });

  it("shows Expenses and Reminders by day, by week, and by month with the same rows", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Money", ["expenses", "reminders"])],
    });
    const today = new Date();
    today.setHours(9, 15, 0, 0);
    for (const [displayName, amount] of [
      ["Flowers", "18.5000"],
      ["Chairs", "60.0000"],
    ] as const)
      await client.createEventResource(eventId, {
        commandId: crypto.randomUUID(),
        resource: {
          objectType: "expense",
          displayName,
          amount,
          currency: "USD",
          occurredAt: today.toISOString(),
        },
      });
    await client.createEventResource(eventId, {
      commandId: crypto.randomUUID(),
      resource: {
        objectType: "reminder",
        displayName: "Call the florist",
        remindAt: today.toISOString(),
      },
    });
    const user = userEvent.setup();
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    await screen.findByText("Call the florist");
    const panel = (title: string) =>
      within(
        screen
          .getByRole("heading", { name: title })
          .closest(".planning-panel") as HTMLElement,
      );
    const choose = async (panel: ReturnType<typeof within>, view: string) => {
      await user.click(panel.getByRole("button", { name: /^Layout: / }));
      await user.click(panel.getByRole("menuitemradio", { name: view }));
    };

    // Expenses by day: one heading per day carrying the day's totals; the
    // sample deposit sits under its own day two weeks out.
    const expenses = panel("Expenses");
    await choose(expenses, "By day");
    const todayGroup = expenses.getByRole("region", { name: /Today/ });
    expect(within(todayGroup).getByText("Flowers")).toBeVisible();
    expect(within(todayGroup).getByText("Chairs")).toBeVisible();
    expect(
      within(todayGroup).getByRole("heading", { level: 3, name: /Today/ }),
    ).toHaveTextContent("$78.50");
    expect(expenses.getAllByRole("region")).toHaveLength(2);
    expect(expenses.getByText("Venue deposit")).toBeVisible();
    // Calendar: the cell holds the rows, each with its amount and Edit.
    await choose(expenses, "Calendar");
    const cells = expenses.getAllByRole("cell");
    expect(cells).toHaveLength(monthDays(new Date()).length);
    const fullDay = new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(today);
    const todayCell = expenses.getByRole("cell", {
      name: `${fullDay}, 2 items`,
    });
    expect(
      within(todayCell).getByRole("heading", { name: "Flowers" }),
    ).toBeVisible();
    expect(within(todayCell).getByText("$18.50")).toBeVisible();
    expect(
      within(todayCell).getAllByRole("button", { name: /^Edit / }),
    ).toHaveLength(2);
    await waitFor(async () =>
      expect(
        (await client.getEventLayout(eventId)).pages[0]?.components[0]?.view,
      ).toBe("month"),
    );

    // Reminders by week: today's column holds the reminder with Dismiss;
    // dismissing strikes it through in the month cell.
    const reminders = panel("Reminders");
    await choose(reminders, "By week");
    const column = within(reminders.getByRole("listitem", { name: fullDay }));
    expect(column.getByText("Call the florist")).toBeVisible();
    await chooseRowAction(
      user,
      reminders.getByRole("listitem", { name: fullDay }),
      "Dismiss",
    );
    await waitFor(() => expect(column.getByText("Dismissed")).toBeVisible());
    await choose(reminders, "Calendar");
    expect(
      within(reminders.getByRole("cell", { name: `${fullDay}, 1 item` }))
        .getByRole("heading", { name: "Call the florist" })
        .closest("article"),
    ).toHaveClass("is-done");
    await choose(reminders, "By day");
    expect(
      within(reminders.getByRole("region", { name: /Today/ })).getByText(
        "Call the florist",
      ),
    ).toBeVisible();
    expect(
      (await client.getEventLayout(eventId)).pages[0]?.components.map(
        (component) => component.view,
      ),
    ).toEqual(["month", "by-day"]);
  });

  it("filters the To-dos by the labels and people its tasks carry, for the session", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Plan", ["todos"])],
    });
    const urgent = await client.createLabel({ name: "Urgent" });
    const mira = await client.createPerson({ displayName: "Mira" });
    const me = await client.createPerson({
      displayName: "Sample planner",
      userId: (await client.getSession()).user.id,
    });
    const task = async (input: {
      readonly displayName: string;
      readonly labelIds?: string[];
      readonly assigneeId?: string;
    }) =>
      (
        await client.createEventResource(eventId, {
          commandId: crypto.randomUUID(),
          resource: { objectType: "task", ...input },
        })
      ).resource;
    const cake = await task({
      displayName: "Order the cake",
      labelIds: [urgent.id],
      assigneeId: mira.id,
    });
    await task({ displayName: "Call the band", assigneeId: me.id });
    const user = userEvent.setup();
    render(
      <>
        <PagesHarness eventId={eventId} canEdit />
        <RefreshProbe />
      </>,
      { wrapper: Providers },
    );
    await screen.findByText("Order the cake");
    await user.click(screen.getByRole("button", { name: "Filter" }));
    await user.click(screen.getByRole("menuitemradio", { name: "All" }));
    // The menu offers only what the tasks carry: one label, Me, and Mira.
    const choices = () =>
      [...screen.getByRole("menu").querySelectorAll("[role^='menuitem']")].map(
        (item) => item.textContent,
      );
    expect(choices()).toEqual([
      "Open",
      "All",
      "Done",
      "Has a time",
      "Overdue",
      "Any label",
      "Urgent",
      "Anyone",
      "Me",
      "Mira",
      "Clear filters",
    ]);
    const choose = (name: string) =>
      user.click(screen.getByRole("menuitemradio", { name }));
    await choose("Urgent");
    expect(screen.getByRole("row", { name: /Order the cake/ })).toBeVisible();
    expect(screen.queryByRole("row", { name: /Call the band/ })).toBeNull();
    expect(
      screen.queryByRole("row", { name: /Confirm the garden venue/ }),
    ).toBeNull();
    // The filters combine; a match-less pair leaves the view empty.
    await choose("Me");
    expect(
      screen.getByRole("heading", { name: "Nothing in this view" }),
    ).toBeVisible();
    await choose("Any label");
    expect(screen.getByRole("row", { name: /Call the band/ })).toBeVisible();
    expect(screen.queryByRole("row", { name: /Order the cake/ })).toBeNull();
    await choose("Mira");
    expect(screen.getByRole("row", { name: /Order the cake/ })).toBeVisible();
    expect(screen.getByText("1 of 3 open")).toBeVisible();
    // The choice is session state: the layout saved nothing for it.
    expect((await client.getEventLayout(eventId)).version).toBe(1);
    // A label the tasks no longer carry leaves the menu; the list widens.
    await choose("Urgent");
    expect(
      screen.getByRole("button", { name: "Filter: 3 filters" }),
    ).toBeVisible();
    await client.updateTask(cake.id, {
      expectedVersion: cake.version,
      labelIds: [],
    });
    await user.click(screen.getByRole("button", { name: "Refetch layout" }));
    expect(
      await screen.findByRole("button", { name: "Filter: 2 filters" }),
    ).toBeVisible();
    expect(screen.getByRole("row", { name: /Order the cake/ })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Filter: 2 filters" }));
    expect(choices()).not.toContain("Urgent");
    expect(screen.getByRole("menuitemradio", { name: "Mira" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("lists To-dos and Reminders in manual order and moves them from the row menu", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Plan", ["todos", "reminders"])],
    });
    // Created in one order, due in the other: the rows follow creation.
    // Both days lie beyond the coming Monday, so the Next week snooze
    // below always moves the reminder, whatever day the test runs on.
    const later = new Date();
    later.setDate(later.getDate() + 10);
    const soon = new Date();
    soon.setDate(soon.getDate() + 8);
    const create = async (
      resource:
        | { objectType: "task"; displayName: string; dueAt: string }
        | { objectType: "reminder"; displayName: string; remindAt: string },
    ) =>
      (
        await client.createEventResource(eventId, {
          commandId: crypto.randomUUID(),
          resource,
        })
      ).resource;
    await create({
      objectType: "task",
      displayName: "Order the cake",
      dueAt: later.toISOString(),
    });
    await create({
      objectType: "task",
      displayName: "Call the band",
      dueAt: soon.toISOString(),
    });
    await create({
      objectType: "reminder",
      displayName: "Pay the deposit",
      remindAt: later.toISOString(),
    });
    const ring = await create({
      objectType: "reminder",
      displayName: "Ring the venue",
      remindAt: soon.toISOString(),
    });
    const user = userEvent.setup();
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    const todos = within(await screen.findByRole("heading", { name: "To-dos" }))
      .getByText("To-dos")
      .closest("section") as HTMLElement;
    await within(todos).findByText("Call the band");
    // The task rows only: the header, the add row, and the Add section
    // line are rows of the table too.
    const taskNames = () =>
      Array.from(todos.querySelectorAll("tr[data-row-id]")).map(
        (row) => row.querySelector("strong")?.textContent,
      );
    expect(taskNames()).toEqual([
      "Confirm the garden venue",
      "Order the cake",
      "Call the band",
    ]);
    // The row's actions live in its menu; a viewer's row would offer
    // Copy link and History only.
    await chooseRowAction(
      user,
      within(todos).getByRole("row", { name: /Call the band/ }),
      "Move up",
    );
    await waitFor(() =>
      expect(taskNames()).toEqual([
        "Confirm the garden venue",
        "Call the band",
        "Order the cake",
      ]),
    );
    const reminders = within(screen.getByRole("heading", { name: "Reminders" }))
      .getByText("Reminders")
      .closest("section") as HTMLElement;
    const reminderNames = () =>
      within(reminders)
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent);
    expect(reminderNames()).toEqual([
      "Check the weather forecast",
      "Pay the deposit",
      "Ring the venue",
    ]);
    const ringRow = within(reminders)
      .getByRole("heading", { name: "Ring the venue" })
      .closest("article") as HTMLElement;
    await user.click(
      within(ringRow).getByRole("button", {
        name: "Actions for Ring the venue",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Snooze" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Next week" }));
    await waitFor(async () => {
      const moved = await client.getReminder(ring.id);
      expect(moved.version).toBe(2);
      expect(new Date(moved.remindAt).getHours()).toBe(soon.getHours());
      expect(new Date(moved.remindAt).getDay()).toBe(1);
    });
    await chooseRowAction(user, ringRow, "Move up");
    await waitFor(() =>
      expect(reminderNames()).toEqual([
        "Check the weather forecast",
        "Ring the venue",
        "Pay the deposit",
      ]),
    );
  });

  it("allows a viewer to preview saved layouts without mutation controls", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Plan", ["todos"])],
    });
    const user = userEvent.setup();
    render(<PagesHarness eventId={eventId} canEdit={false} />, {
      wrapper: Providers,
    });
    await screen.findByRole("region", { name: "Event pages" });
    await choosePageOption(user, "Layout history");
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
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    for (const kind of eventComponentKinds) {
      expect(
        (
          await screen.findAllByRole("heading", {
            name: componentKindLabel(kind),
          })
        )[0],
      ).toBeVisible();
    }
    // The itinerary is its own component: one day sheet, beside one Calendar.
    expect(screen.getAllByRole("heading", { name: "Calendar" })).toHaveLength(
      1,
    );
    expect(screen.getByRole("heading", { name: "Itinerary" })).toBeVisible();
    expect(document.querySelectorAll(".day-sheet")).toHaveLength(1);
    expect(await screen.findByText("Attach a file")).toBeVisible();
    expect(await client.getEventDetail(eventId)).toEqual(before);
    expect(
      screen.getAllByText("Welcome and coffee", { exact: true }),
    ).toHaveLength(3);
    const paths = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
    expect(
      paths.filter((path) => path.endsWith("/attachment-targets")),
    ).toHaveLength(1);
    expect(paths.filter((path) => path.endsWith("/calendar"))).toHaveLength(1);
  });

  it("coalesces duplicate components, loads only the selected page, and preserves independent filters", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Work", ["todos", "todos"]), page("Schedule", ["calendar"])],
    });
    const user = userEvent.setup();
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
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
    await user.click(first.getByRole("button", { name: "Filter" }));
    await user.click(first.getByRole("menuitemradio", { name: "All" }));
    await user.keyboard("{Escape}");
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
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
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

  it("offers every component kind as a card and keeps the dialog open on a stale save", async () => {
    const pages = [page("Plan", [])];
    await client.updateEventLayout(eventId, { expectedVersion: 0, pages });
    const user = userEvent.setup();
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    const trigger = await screen.findByRole("button", {
      name: "Add component",
    });
    await user.click(trigger);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getAllByRole("button", { name: /^Add / })).toHaveLength(9);
    expect(
      dialog.getByRole("searchbox", { name: "Find a component" }),
    ).toHaveFocus();
    expect(
      dialog.getByRole("button", { name: "Add Calendar" }),
    ).toHaveAccessibleDescription(/schedule/i);
    await client.updateEventLayout(eventId, { expectedVersion: 1, pages });
    await user.click(dialog.getByRole("button", { name: "Add Calendar" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "A newer version is available",
    );
    expect(dialog.getByRole("button", { name: "Add Calendar" })).toBeEnabled();
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
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    await user.click(await screen.findByRole("button", { name: "Plan" }));
    await user.keyboard("/");
    const search = screen.getByRole("searchbox", { name: "Find a component" });
    expect(search).toHaveFocus();
    await user.type(search, "/unknown");
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryAllByRole("button", { name: /^Add / })).toHaveLength(0);
    expect(dialog.getByRole("status")).toHaveTextContent(
      "No matching components.",
    );
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
    await openTaskEditor(user);
    const input = screen.getByRole("textbox", { name: "Task" });
    await user.type(input, "Plan / review");
    expect(input).toHaveValue("Plan / review");
    expect(screen.getByRole("dialog", { name: "Add task" })).toBeVisible();
    expect(
      screen.queryByRole("searchbox", { name: "Find a component" }),
    ).toBeNull();
  });

  it("marks repeated views on their cards and adds only a layout reference to the selected page", async () => {
    const pages = [page("Preparation", ["todos"]), page("On the day", [])];
    const before = await client.getEventDetail(eventId);
    await client.updateEventLayout(eventId, { expectedVersion: 0, pages });
    const user = userEvent.setup();
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    await user.click(await screen.findByRole("button", { name: "On the day" }));
    await user.click(screen.getByRole("button", { name: "Add component" }));
    const dialog = within(screen.getByRole("dialog"));
    const search = dialog.getByRole("searchbox", { name: "Find a component" });
    expect(search).toHaveAccessibleDescription("Add to On the day.");
    expect(
      dialog.getByRole("button", { name: "Add To-dos" }),
    ).toHaveTextContent("On another page");
    expect(
      dialog.getByRole("button", { name: "Add Calendar" }),
    ).not.toHaveTextContent(/On /);
    vi.mocked(fetch).mockClear();
    await user.type(search, "no matching view");
    expect(dialog.queryAllByRole("button", { name: /^Add / })).toHaveLength(0);
    await user.click(dialog.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveFocus();
    expect(dialog.getAllByRole("button", { name: /^Add / })).toHaveLength(9);
    await user.type(search, "checklist");
    await user.keyboard("{ArrowDown}");
    expect(dialog.getByRole("button", { name: "Add To-dos" })).toHaveFocus();
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
      screen.getByRole("button", { name: "Add To-dos" }),
    ).toHaveTextContent("On this page");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect((await client.getEventLayout(eventId)).version).toBe(2);
  });

  it("keeps catalog interaction inert during composition and a pending save", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Plan", [])],
    });
    const user = userEvent.setup();
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
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
    expect(dialog.getByRole("button", { name: "Add To-dos" })).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Add Calendar" })).toBeDisabled();
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
    const view = render(<PagesHarness eventId={eventId} canEdit />, {
      wrapper: Providers,
    });
    await user.click(
      await screen.findByRole("button", { name: "Add component" }),
    );
    await user.type(
      screen.getByRole("searchbox", { name: "Find a component" }),
      "costs",
    );
    view.rerender(<PagesHarness eventId={eventId} canEdit={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(<PagesHarness eventId={eventId} canEdit />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((await client.getEventLayout(eventId)).version).toBe(1);
  });

  it("moves components and pages with accessible controls while preserving canonical data", async () => {
    const pages = [page("Work", ["todos", "calendar"]), page("Day", [])];
    const before = await client.getEventDetail(eventId);
    await client.updateEventLayout(eventId, { expectedVersion: 0, pages });
    const user = userEvent.setup();
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    await screen.findByRole("region", { name: "Event pages" });
    await arrange(user);
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

  it("takes a move back and brings it again from the arrange bar", async () => {
    await client.updateEventLayout(eventId, {
      expectedVersion: 0,
      pages: [page("Work", ["todos", "calendar"])],
    });
    const user = userEvent.setup();
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    await screen.findByRole("region", { name: "Event pages" });
    expect(
      screen.queryByRole("group", { name: "Arranging components" }),
    ).toBeNull();
    await arrange(user);
    const bar = screen.getByRole("group", { name: "Arranging components" });
    const undo = within(bar).getByRole("button", {
      name: "Undo layout change",
    });
    const redo = within(bar).getByRole("button", {
      name: "Redo layout change",
    });
    const order = () =>
      screen
        .getAllByRole("region", { name: /component \d/ })
        .map((item) => item.getAttribute("aria-label"));
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Move To-dos down" }));
    await waitFor(() => expect(undo).toBeEnabled());
    expect(order()).toEqual(["Calendar component 1", "To-dos component 2"]);
    await user.click(undo);
    await waitFor(() =>
      expect(order()).toEqual(["To-dos component 1", "Calendar component 2"]),
    );
    await waitFor(() => expect(redo).toBeEnabled());
    expect(undo).toBeDisabled();
    await user.click(redo);
    await waitFor(() =>
      expect(order()).toEqual(["Calendar component 1", "To-dos component 2"]),
    );
    expect((await client.getEventLayout(eventId)).version).toBe(4);
    await user.click(
      within(bar).getByRole("button", { name: "Done arranging" }),
    );
    expect(
      screen.queryByRole("group", { name: "Arranging components" }),
    ).toBeNull();
  });

  it("keeps the displayed layout on conflict and requires a refresh before retrying", async () => {
    const pages = [page("Work", ["todos", "calendar"]), page("Day", [])];
    await client.updateEventLayout(eventId, { expectedVersion: 0, pages });
    const user = userEvent.setup();
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    await screen.findByRole("region", { name: "Event pages" });
    await arrange(user);
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
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    await screen.findByRole("region", { name: "Event pages" });
    await arrange(user);
    await user.click(
      await screen.findByRole("button", { name: "Move page later" }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("navigation", { name: "Pages" }))
          .getAllByRole("button")
          .filter((button) => button.dataset.pageId)
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
    render(<PagesHarness eventId={eventId} canEdit />, { wrapper: Providers });
    await screen.findByRole("region", { name: "Event pages" });
    await arrange(userEvent.setup());
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
    render(<PagesHarness eventId={eventId} canEdit={false} />, {
      wrapper: Providers,
    });
    expect(
      await screen.findByRole("heading", { name: "No files attached" }),
    ).toBeVisible();
    expect(screen.queryByText("Attach a file")).toBeNull();
    for (const label of [
      "Arrange components",
      "Add component",
      "Add page",
      "Add schedule item",
      "Add task",
      "Add expense",
      "Add reminder",
      "Attach a file",
    ]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
    // The task is due today, so To-dos and the Itinerary both list it.
    for (const check of screen.getAllByRole("button", {
      name: "Complete Confirm the garden venue",
    }))
      expect(check).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^Drag / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Plan" }));
    await user.keyboard("/");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
