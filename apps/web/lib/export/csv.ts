/**
 * A comma-separated file of one header row and one row per record: a
 * field that holds a comma, a quote, or a line break is quoted with its
 * quotes doubled, rows end in CRLF, and the file opens with a byte-order
 * mark so spreadsheet applications read it as UTF-8.
 */
export function csvFile(
  header: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  return `\uFEFF${[header, ...rows].map(csvLine).join("\r\n")}\r\n`;
}

function csvLine(fields: readonly string[]): string {
  return fields.map(csvField).join(",");
}

function csvField(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * A file name from its parts joined with " - ", the characters a file
 * system refuses replaced by a space and runs of spaces collapsed:
 * "Kyoto in November - To-dos - 2026-09-19".
 */
export function exportFileName(parts: readonly string[]): string {
  return parts
    .map((part) =>
      part
        .replaceAll(/[\\/:*?"<>|\p{Cc}]/gu, " ")
        .replaceAll(/\s+/gu, " ")
        .trim(),
    )
    .filter((part) => part !== "")
    .join(" - ");
}

/** Hands the browser a file to save, through an object URL and a temporary link. */
export function saveFile(name: string, contents: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // The download has the URL by now; the object is freed on the next turn.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
