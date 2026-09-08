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
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

let store: SandboxStore;
let client: ChronelleApiClient;
let eventId: string;

beforeEach(async () => {
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
  window.sessionStorage.setItem(
    "chronelle.development-session",
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
});

function page(name: string, kinds: readonly EventComponentKind[]) {
  return {
    id: crypto.randomUUID(),
    name,
    components: kinds.map((kind) => ({ id: crypto.randomUUID(), kind })),
  };
}

describe("insertable event components", () => {
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
    await user.click(screen.getByRole("button", { name: "Try again" }));
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
    const input = screen.getByRole("textbox", { name: "Task" });
    await user.type(input, "Plan / review");
    expect(input).toHaveValue("Plan / review");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves components and pages with accessible controls while preserving canonical data", async () => {
    const pages = [page("Work", ["todos", "calendar"]), page("Day", [])];
    const before = await client.getEventDetail(eventId);
    await client.updateEventLayout(eventId, { expectedVersion: 0, pages });
    const user = userEvent.setup();
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
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
    await screen.findByRole("button", { name: "Move To-dos down" });
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

  it("ignores external drops and rejects a drag based on an outdated layout snapshot", async () => {
    const pages = [page("Work", ["todos", "calendar"]), page("Day", [])];
    await client.updateEventLayout(eventId, { expectedVersion: 0, pages });
    render(<EventPages eventId={eventId} canEdit />, { wrapper: Providers });
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
