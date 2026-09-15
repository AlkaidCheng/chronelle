// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DateTile,
  objectTypeLabel,
  StatusChip,
} from "../features/events/component-frame";

describe("component frame", () => {
  it("labels statuses for reading and keeps the status class", () => {
    render(<StatusChip status="in_progress" />);
    const chip = screen.getByText("In progress");
    expect(chip).toHaveClass("status-chip", "status-in_progress");
  });

  it("shows an unknown status as stored", () => {
    render(<StatusChip status="snoozed" />);
    expect(screen.getByText("snoozed")).toHaveClass("status-snoozed");
  });

  it("marks a date with the month above the day", () => {
    render(<DateTile dateTime="2027-07-12" day="12" month="Jul" />);
    const tile = screen.getByText("JUL").closest("time");
    expect(tile).toHaveAttribute("datetime", "2027-07-12");
    expect(tile).toHaveTextContent(/^JUL12$/);
  });

  it("names object kinds the way the views do", () => {
    expect(objectTypeLabel("event")).toBe("Scheduled event");
    expect(objectTypeLabel("task")).toBe("Task");
    expect(objectTypeLabel("document")).toBe("document");
  });
});
