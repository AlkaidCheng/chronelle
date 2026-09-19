import { describe, expect, it } from "vitest";

import { csvFile, exportFileName } from "../lib/export/csv";

describe("csvFile", () => {
  it("opens with a byte-order mark, ends rows in CRLF, and quotes only what needs it", () => {
    const file = csvFile(
      ["Name", "Place"],
      [
        ["Coffee", "Gion"],
        ['Dinner, "late"', "Second alley\non the left"],
        ["", "Plain"],
      ],
    );
    expect(file.startsWith("\uFEFF")).toBe(true);
    expect(file.slice(1)).toBe(
      [
        "Name,Place",
        "Coffee,Gion",
        '"Dinner, ""late""","Second alley\non the left"',
        ",Plain",
        "",
      ].join("\r\n"),
    );
  });

  it("holds the header alone when there are no rows", () => {
    expect(csvFile(["Name"], [])).toBe("\uFEFFName\r\n");
  });
});

describe("exportFileName", () => {
  it("joins the parts with a dash and drops what a file system refuses", () => {
    expect(
      exportFileName(["Kyoto: in / November?", "To-dos", "2026-09-19"]),
    ).toBe("Kyoto in November - To-dos - 2026-09-19");
  });

  it("leaves out an empty part", () => {
    expect(exportFileName(["", "Calendar", "2026-09-19"])).toBe(
      "Calendar - 2026-09-19",
    );
    expect(exportFileName(["  ", "\t", "Notes"])).toBe("Notes");
  });

  it("collapses runs of spaces and control characters", () => {
    expect(exportFileName(["A   quiet\u0007  studio", "x"])).toBe(
      "A quiet studio - x",
    );
  });
});
