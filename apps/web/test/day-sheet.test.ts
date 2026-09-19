import type { EventResponse, TaskResponse } from "@chronelle/schemas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import en from "../messages/en.json";
import { setActiveLocale } from "../i18n/active-locale";
import {
  defaultTimePreferences,
  setActiveTimePreferences,
} from "../i18n/active-preferences";
import {
  daySheet,
  daySheetText,
  gapText,
  initialItineraryDay,
  itineraryDays,
} from "../lib/day-sheet";

const base = {
  workspaceId: "019d6e7d-0000-7000-8000-000000000001",
  createdBy: "019d6e7d-0000-7000-8000-000000000002",
  permissionScopeId: "019d6e7d-0000-7000-8000-000000000010",
  createdAt: "2026-09-02T20:00:00.000Z",
  updatedAt: "2026-09-02T20:00:00.000Z",
  version: 1,
  archivedAt: null,
  deletedAt: null,
  customProperties: {},
  metadata: {},
} as const;

let counter = 0;
function item(
  displayName: string,
  fields: Partial<EventResponse> = {},
): EventResponse {
  counter += 1;
  return {
    ...base,
    id: `019d6e7d-0000-7000-8000-0000000000${String(counter).padStart(2, "0")}`,
    objectType: "event",
    displayName,
    startsAt: null,
    endsAt: null,
    startsOn: null,
    endsOn: null,
    timezone: "Asia/Tokyo",
    isAllDay: false,
    location: null,
    ...fields,
  };
}

function task(
  displayName: string,
  fields: Partial<TaskResponse> = {},
): TaskResponse {
  counter += 1;
  return {
    ...base,
    id: `019d6e7d-0000-7000-8000-0000000000${String(counter).padStart(2, "0")}`,
    objectType: "task",
    displayName,
    status: "todo",
    dueOn: null,
    dueAt: null,
    durationMinutes: null,
    repeatRule: null,
    repeatUntil: null,
    completedAt: null,
    parentTaskId: null,
    assigneeId: null,
    location: null,
    rank: "00000001000",
    labelIds: [],
    ...fields,
  };
}

// Kyoto time: 09:30 in Kyoto on Nov 3 is 00:30Z.
const inKyoto = (day: string, time: string) =>
  new Date(`${day}T${time}:00+09:00`).toISOString();

beforeEach(() => {
  setActiveLocale("en", en);
  setActiveTimePreferences({
    timeZone: "Asia/Tokyo",
    hourCycle: "h23",
    weekStart: null,
  });
});

afterEach(() => {
  setActiveTimePreferences(defaultTimePreferences);
});

describe("the day sheet", () => {
  const trip = {
    startsOn: "2030-11-02",
    endsOn: "2030-11-06",
    startsAt: null,
    endsAt: null,
  };
  const items = [
    item("Kyoto, day 2", { startsOn: "2030-11-02", endsOn: "2030-11-04" }),
    item("Ryokan check-out by 11:00", {
      startsOn: "2030-11-03",
      isAllDay: true,
    }),
    item("Lunch", {
      startsAt: inKyoto("2030-11-03", "12:00"),
      endsAt: inKyoto("2030-11-03", "13:00"),
      location: "Nishiki Market",
    }),
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
    item("Tea ceremony", {
      startsAt: inKyoto("2030-11-03", "15:00"),
      endsAt: inKyoto("2030-11-03", "17:00"),
    }),
    item("Yasaka shrine at dusk", { startsOn: "2030-11-03" }),
    item("A call, no end", { startsAt: inKyoto("2030-11-03", "18:00") }),
    item("Late arrival", { startsAt: inKyoto("2030-11-09", "20:00") }),
    item("Not placed"),
  ];
  const tasks = [
    task("Confirm dinner headcount", {
      dueAt: inKyoto("2030-11-03", "18:00"),
    }),
    task("Book the Arashiyama bamboo tickets", { dueOn: "2030-11-03" }),
    task("Pack", { dueOn: "2030-11-01" }),
    task("Done already", { dueOn: "2030-11-03", status: "done" }),
  ];

  it("turns the event's days and every day an item falls on, opening on today when it can", () => {
    const days = itineraryDays(trip, items);
    expect(days).toEqual([
      "2030-11-02",
      "2030-11-03",
      "2030-11-04",
      "2030-11-05",
      "2030-11-06",
      "2030-11-09",
    ]);
    expect(initialItineraryDay(days, new Date("2030-11-04T03:00:00Z"))).toBe(
      "2030-11-04",
    );
    expect(initialItineraryDay(days, new Date("2031-01-01T00:00:00Z"))).toBe(
      "2030-11-02",
    );
    expect(
      itineraryDays(
        { startsOn: null, endsOn: null, startsAt: null, endsAt: null },
        [],
        new Date("2030-11-04T03:00:00Z"),
      ),
    ).toEqual(["2030-11-04"]);
  });

  it("lists a day's rows in start order with the free time, the pills, the due tasks and the untimed items", () => {
    const sheet = daySheet(
      "2030-11-03",
      items,
      tasks,
      new Date(inKyoto("2030-11-03", "10:00")),
    );
    expect(sheet.allDay.map((entry) => entry.displayName)).toEqual([
      "Kyoto, day 2",
      "Ryokan check-out by 11:00",
    ]);
    expect(
      sheet.rows.map((row) =>
        "item" in row
          ? [row.start, row.end, row.duration, row.now, row.item.displayName]
          : `${row.minutes} free`,
      ),
    ).toEqual([
      ["08:00", "09:00", "1 h", false, "Breakfast at the ryokan"],
      "30 free",
      ["09:30", "11:30", "2 h", true, "Fushimi Inari, the lower loop"],
      "30 free",
      ["12:00", "13:00", "1 h", false, "Lunch"],
      "120 free",
      ["15:00", "17:00", "2 h", false, "Tea ceremony"],
      "60 free",
      ["18:00", "", "", false, "A call, no end"],
    ]);
    expect(sheet.due.map((entry) => entry.displayName)).toEqual([
      "Book the Arashiyama bamboo tickets",
      "Confirm dinner headcount",
      "Done already",
    ]);
    expect(sheet.untimed.map((entry) => entry.displayName)).toEqual([
      "Yasaka shrine at dusk",
    ]);
  });

  it("leaves out a gap under a quarter of an hour", () => {
    const sheet = daySheet(
      "2030-11-05",
      [
        item("First", {
          startsAt: inKyoto("2030-11-05", "09:00"),
          endsAt: inKyoto("2030-11-05", "09:50"),
        }),
        item("Second", {
          startsAt: inKyoto("2030-11-05", "10:00"),
          endsAt: inKyoto("2030-11-05", "10:30"),
        }),
      ],
      [],
    );
    expect(
      sheet.rows.map((row) => ("item" in row ? row.start : "gap")),
    ).toEqual(["09:00", "10:00"]);
  });

  it("words free time and copies the day as plain text", () => {
    expect(gapText(30)).toBe("30 min free");
    expect(gapText(120)).toBe("2 h free");
    expect(gapText(75)).toBe("1 h 15 min free");
    const sheet = daySheet("2030-11-03", items, tasks);
    expect(daySheetText(sheet)).toBe(
      [
        "Sun, Nov 3",
        "Kyoto, day 2",
        "Ryokan check-out by 11:00",
        "08:00-09:00  Breakfast at the ryokan - Yoshida-sanso, dining room",
        "09:30-11:30  Fushimi Inari, the lower loop - Fushimi Inari Taisha, main gate",
        "12:00-13:00  Lunch - Nishiki Market",
        "15:00-17:00  Tea ceremony",
        "18:00  A call, no end",
        "-  Yasaka shrine at dusk",
      ].join("\n"),
    );
  });
});
