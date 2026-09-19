// @vitest-environment jsdom

import type { EventResponse, TaskResponse } from "@chronelle/schemas";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "../app/providers";
import { ItineraryPanel } from "../features/events/itinerary-panel";
import {
  defaultTimePreferences,
  setActiveTimePreferences,
} from "../i18n/active-preferences";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

let store: SandboxStore;
let eventId: string;
let tasks: TaskResponse[];
let counter = 0;

const inKyoto = (day: string, time: string) =>
  new Date(`${day}T${time}:00+09:00`).toISOString();

function item(
  displayName: string,
  fields: Partial<EventResponse> = {},
): EventResponse {
  counter += 1;
  return {
    id: `019d6e7d-0000-7000-8000-0000000000${String(counter).padStart(2, "0")}`,
    workspaceId: sandboxWorkspaceId,
    createdBy: "019d6e7d-0000-7000-8000-000000000002",
    permissionScopeId: eventId,
    createdAt: "2026-09-02T20:00:00.000Z",
    updatedAt: "2026-09-02T20:00:00.000Z",
    version: 1,
    archivedAt: null,
    deletedAt: null,
    customProperties: {},
    metadata: {},
    objectType: "event",
    displayName,
    startsAt: null,
    endsAt: null,
    startsOn: null,
    endsOn: null,
    timezone: "Asia/Tokyo",
    isAllDay: false,
    location: null,
    description: null,
    ...fields,
  };
}

const trip = {
  startsOn: "2030-11-02",
  endsOn: "2030-11-04",
  startsAt: null,
  endsAt: null,
};

beforeEach(async () => {
  vi.useFakeTimers({
    now: new Date(inKyoto("2030-11-03", "10:00")),
    toFake: ["Date"],
  });
  setActiveTimePreferences({
    timeZone: "Asia/Tokyo",
    hourCycle: "h23",
    weekStart: null,
  });
  let stored: string | null = null;
  store = new SandboxStore({
    getItem: () => stored,
    setItem: (_key, value) => {
      stored = value;
    },
  });
  const events = await (await store.fetch("/api/events")).json();
  eventId = events.items[0].id;
  // One of the sample tasks is due on the shown day.
  const todos = await (
    await store.fetch(`/api/events/${eventId}/todos`)
  ).json();
  const first = todos.items[0];
  const moved = await (
    await store.fetch(`/api/tasks/${first.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersion: first.version,
        dueOn: "2030-11-03",
        dueAt: null,
      }),
    })
  ).json();
  tasks = [moved];
  window.sessionStorage.setItem(
    "chronelle.session",
    JSON.stringify({ accessToken: "sample", workspaceId: sandboxWorkspaceId }),
  );
  for (const method of ["showModal", "close"] as const) {
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.toggleAttribute("open", method === "showModal");
      },
    });
  }
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((input, options) => store.fetch(input, options)),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setActiveTimePreferences(defaultTimePreferences);
  window.sessionStorage.clear();
});

const items = () => [
  item("Kyoto, day 2", { startsOn: "2030-11-02", endsOn: "2030-11-04" }),
  item("Breakfast at the ryokan", {
    startsAt: inKyoto("2030-11-03", "08:00"),
    endsAt: inKyoto("2030-11-03", "09:00"),
    location: "Yoshida-sanso, dining room",
  }),
  item("Fushimi Inari, the lower loop", {
    startsAt: inKyoto("2030-11-03", "09:30"),
    endsAt: inKyoto("2030-11-03", "11:30"),
    location: "Fushimi Inari Taisha, main gate",
  }),
  item("Yasaka shrine at dusk", { startsOn: "2030-11-03" }),
  item("Arashiyama", {
    startsAt: inKyoto("2030-11-04", "09:00"),
    endsAt: inKyoto("2030-11-04", "12:00"),
  }),
];

describe("the Itinerary panel", () => {
  it("opens on today, reads the day's sheet, turns days, and copies the day", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const onChangeView = vi.fn();
    render(
      <ItineraryPanel
        canEdit
        event={trip}
        eventId={eventId}
        items={items()}
        onChangeView={onChangeView}
        tasks={tasks}
      />,
      { wrapper: Providers },
    );
    expect(screen.getByRole("heading", { name: "Itinerary" })).toBeVisible();
    expect(screen.getByText("Day 2 of 3")).toBeVisible();
    const sheet = screen.getByRole("region", { name: "Sun, Nov 3" });
    expect(
      within(sheet).getByRole("list", { name: "All day" }),
    ).toHaveTextContent("Kyoto, day 2");
    const rows = within(sheet).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Kyoto, day 2",
      "08:0009:001 hBreakfast at the ryokanYoshida-sanso, dining room1 h",
      "30 min free",
      "09:3011:302 hFushimi Inari, the lower loopFushimi Inari Taisha, main gate2 h",
      `${tasks[0]?.displayName}`,
      `${String.fromCharCode(0x2013)}Yasaka shrine at dusk`,
    ]);
    expect(rows[3]).toHaveAttribute("data-now");
    expect(screen.getByRole("heading", { name: "Due today" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Not yet timed" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Today" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Next day" }));
    expect(screen.getByText("Day 3 of 3")).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Mon, Nov 4" }),
    ).toHaveTextContent("Arashiyama");
    expect(screen.getByRole("button", { name: "Next day" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByText("Day 2 of 3")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Previous day" }));
    expect(screen.getByText("Day 1 of 3")).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Sat, Nov 2" }),
    ).toHaveTextContent("Kyoto, day 2");
    expect(screen.getByRole("button", { name: "Previous day" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Today" }));
    await user.click(screen.getByRole("button", { name: "Copy day" }));
    expect(writeText).toHaveBeenCalledWith(
      [
        "Sun, Nov 3",
        "Kyoto, day 2",
        "08:00-09:00  Breakfast at the ryokan - Yoshida-sanso, dining room",
        "09:30-11:30  Fushimi Inari, the lower loop - Fushimi Inari Taisha, main gate",
        "-  Yasaka shrine at dusk",
      ].join("\n"),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Day copied.");

    // The view menu offers Day and All days by the itinerary's own names.
    await user.click(screen.getByRole("button", { name: "Layout: Day" }));
    await user.click(screen.getByRole("menuitemradio", { name: "All days" }));
    expect(onChangeView).toHaveBeenCalledWith("list");
  });

  it("stacks every day in All days and completes a task due that day", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ItineraryPanel
        canEdit
        event={trip}
        eventId={eventId}
        items={items()}
        tasks={tasks}
        view="list"
      />,
      { wrapper: Providers },
    );
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    ).toEqual(["Sat, Nov 2", "Sun, Nov 3", "Mon, Nov 4"]);
    expect(screen.queryByRole("button", { name: "Next day" })).toBeNull();
    const name = tasks[0]?.displayName ?? "";
    await user.click(screen.getByRole("button", { name: `Complete ${name}` }));
    await waitFor(async () => {
      const saved = await (
        await store.fetch(`/api/tasks/${tasks[0]?.id}`)
      ).json();
      expect(saved.status).toBe("done");
    });
  });

  it("says when a day has nothing on it and opens the schedule dialog", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ItineraryPanel
        canEdit
        event={trip}
        eventId={eventId}
        items={[]}
        tasks={[]}
      />,
      { wrapper: Providers },
    );
    expect(screen.getByText("Nothing scheduled this day.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Add schedule item" }));
    expect(
      screen.getByRole("dialog", { name: "Add schedule item" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Place")).toBeVisible();
  });
});
