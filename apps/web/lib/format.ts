export function toDateTimeInput(value: string | null): string {
  if (value === null) {
    return "";
  }
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function fromDateTimeInput(value: string): string | null {
  return value === "" ? null : new Date(value).toISOString();
}

export function formatDateTime(value: string | null): string {
  if (value === null) {
    return "Not scheduled";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(
    new Date(value),
  );
}

export function formatDatePart(
  value: string | null,
  part: "month" | "day",
): string {
  if (value === null) return part === "month" ? "TBD" : "-";
  return new Intl.DateTimeFormat(
    undefined,
    part === "month" ? { month: "short" } : { day: "2-digit" },
  ).format(new Date(value));
}

export function shortId(id: string): string {
  return id.slice(-8);
}

export function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
