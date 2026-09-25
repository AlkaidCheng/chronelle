// @vitest-environment jsdom

import { ChronelleApiClient } from "@livtales/api-client";
import type { EventResponse } from "@livtales/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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
import { EventComponent } from "../features/events/event-component";
import { queryKeys } from "../lib/queries";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/events",
}));

let store: SandboxStore;
let client: ChronelleApiClient;
let event: EventResponse;
const saved: { name: string; type: string; blob: Blob }[] = [];

beforeEach(async () => {
  let snapshot: string | null = null;
  store = new SandboxStore({
    getItem: () => snapshot,
    setItem: (_key, value) => {
      snapshot = value;
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
  const found = events.items.find(
    (candidate) => candidate.displayName === "Autumn gathering",
  );
  assert(found);
  event = found;
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
  // The browser hands the file over through an object URL and a link; here
  // the link's click is caught and the file kept for the assertions.
  saved.length = 0;
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => {
        saved.push({ name: "", type: blob.type, blob });
        return "blob:sample";
      }),
      revokeObjectURL: vi.fn(),
    }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    const last = saved.at(-1);
    if (last !== undefined) last.name = this.download;
  });
  vi.stubGlobal("print", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  delete document.documentElement.dataset.printing;
});

/** The event as the workspace holds it, so the export can name it. */
function KnownEvent() {
  const cache = useQueryClient();
  useState(() => cache.setQueryData(queryKeys.eventResource(event.id), event));
  return null;
}

function renderTodos() {
  return render(
    <Providers>
      <KnownEvent />
      <EventComponent canEdit eventId={event.id} kind="todos" />
    </Providers>,
  );
}

async function exportAs(
  user: ReturnType<typeof userEvent.setup>,
  item: string,
) {
  await user.click(screen.getByRole("button", { name: "Export" }));
  await user.click(screen.getByRole("menuitem", { name: item }));
}

/** The saved file's bytes, through the reader the test browser offers. */
function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** The saved file's text after its byte-order mark, which the test asserts apart. */
async function textOf(blob: Blob): Promise<string> {
  const bytes = await bytesOf(blob);
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  return new TextDecoder().decode(bytes.slice(3));
}

describe("Export", () => {
  it("offers the two exports as plain items at the end of the head row", async () => {
    const user = userEvent.setup();
    renderTodos();
    await screen.findByText("Confirm the garden venue");
    const tools = screen.getByRole("heading", { level: 2, name: "To-dos" })
      .parentElement?.parentElement;
    assert(tools);
    const buttons = within(tools).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Sort",
      "Filter",
      "Export",
    ]);
    // Each word sits in the span a phone hides, beside a symbol, so the
    // names stay while the symbols alone show.
    for (const button of buttons) {
      expect(button.querySelector("svg")).not.toBeNull();
      expect(button.querySelector(".head-menu-text")?.textContent).toBe(
        button.textContent,
      );
    }
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Export as PDF", "Export data (CSV)"]);
  });

  it("writes the shown rows, with the filter applied, as a CSV file named after the event and the view", async () => {
    const user = userEvent.setup();
    renderTodos();
    await screen.findByText("Confirm the garden venue");
    await exportAs(user, "Export data (CSV)");
    expect(saved).toHaveLength(1);
    const [file] = saved;
    assert(file);
    expect(file.type).toBe("text/csv;charset=utf-8");
    expect(file.name).toMatch(
      /^Autumn gathering - To-dos - \d{4}-\d{2}-\d{2}\.csv$/u,
    );
    const lines = (await textOf(file.blob)).split("\r\n");
    expect(lines[0]).toBe(
      "Name,Status,Due date,Due time,Duration (minutes),Repeat,Repeat until,Assignee,Labels,Location,Description,Event",
    );
    expect(lines.slice(1)).toEqual([
      expect.stringMatching(
        /^Confirm the garden venue,todo,\d{4}-\d{2}-\d{2},\d{2}:\d{2},,,,,,,,Autumn gathering$/u,
      ),
      "",
    ]);

    // Filter: All adds the done task; the file follows the list.
    await user.click(screen.getByRole("button", { name: "Filter" }));
    await user.click(screen.getByRole("menuitemradio", { name: "All" }));
    await screen.findByText("Send invitations");
    await exportAs(user, "Export data (CSV)");
    const second = saved.at(-1);
    assert(second);
    const names = (await textOf(second.blob))
      .split("\r\n")
      .slice(1, -1)
      .map((line) => line.split(",")[0]);
    expect(names).toEqual(["Confirm the garden venue", "Send invitations"]);
  });

  it("prints the view alone: the document and the panel are marked until the dialog closes", async () => {
    const user = userEvent.setup();
    renderTodos();
    await screen.findByText("Confirm the garden venue");
    await exportAs(user, "Export as PDF");
    expect(window.print).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.printing).toBe("todos");
    const panel = document.querySelector('[data-printing="true"]');
    assert(panel);
    expect(
      within(panel as HTMLElement).getByRole("heading", {
        level: 2,
        name: "To-dos",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Sort: Manual. Show: Open.")).toHaveClass(
      "print-caption",
    );
    window.dispatchEvent(new Event("afterprint"));
    expect(document.documentElement.dataset.printing).toBeUndefined();
    expect(document.querySelector("[data-printing]")).toBeNull();
  });
});
