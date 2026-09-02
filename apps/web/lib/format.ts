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

export function formatMoney(amount: string, currency: string): string {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) {
    return `${currency} ${amount}`;
  }
  return new Intl.NumberFormat(undefined, {
    currency,
    style: "currency",
  }).format(numericAmount);
}

export function shortId(id: string): string {
  return id.slice(-8);
}
