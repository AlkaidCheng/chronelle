import { describe, expect, it } from "vitest";

import { commandDescription } from "../lib/commands";

describe("commandDescription", () => {
  it("names a command by the fields it touched", () => {
    expect(
      commandDescription(
        { expectedVersion: 3, displayName: "Kyoto in November" },
        "Kyoto in November",
      ),
    ).toEqual({ kind: "rename", name: "Kyoto in November" });
    expect(
      commandDescription(
        { expectedVersion: 3, status: "done", completedAt: "2030-01-01" },
        "Book the ryokan",
      ),
    ).toEqual({ kind: "complete", name: "Book the ryokan" });
    expect(
      commandDescription(
        { expectedVersion: 3, status: "todo", completedAt: null },
        "Book the ryokan",
      ),
    ).toEqual({ kind: "reopen", name: "Book the ryokan" });
    expect(
      commandDescription({ expectedVersion: 3, rank: "b" }, "Book the ryokan"),
    ).toEqual({ kind: "move", name: "Book the ryokan" });
    expect(
      commandDescription(
        { expectedVersion: 3, dueOn: "2030-10-04" },
        "Book the ryokan",
      ),
    ).toEqual({ kind: "edit", name: "Book the ryokan" });
  });
});
