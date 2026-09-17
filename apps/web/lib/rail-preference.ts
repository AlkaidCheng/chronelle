import type { RailPreference } from "@chronelle/schemas";

/** The rail as shown: every known collection key in order, and the keys left out. */
export interface RailArrangement {
  readonly order: readonly string[];
  readonly hidden: ReadonlySet<string>;
}

/**
 * Applies the account's rail preference to the collections the app knows:
 * the kept order first, keys it does not name appended in default order,
 * keys it names that the app lacks ignored; hidden keys the same way.
 */
export function arrangeRail(
  rail: RailPreference,
  known: readonly string[],
): RailArrangement {
  const kept = (rail.order ?? []).filter((key) => known.includes(key));
  const order = [...kept, ...known.filter((key) => !kept.includes(key))];
  const hidden = new Set(
    (rail.hidden ?? []).filter((key) => known.includes(key)),
  );
  return { order, hidden };
}

/** The preference to keep for an arrangement, with the keys the app does not know carried as they were. */
export function railPreferenceOf(
  arrangement: RailArrangement,
  previous: RailPreference,
  known: readonly string[],
): RailPreference {
  const unknown = (keys: readonly string[] | undefined) =>
    (keys ?? []).filter((key) => !known.includes(key));
  return {
    order: [...arrangement.order, ...unknown(previous.order)],
    hidden: [...arrangement.hidden, ...unknown(previous.hidden)],
  };
}

/** The order with one key moved by `delta` places, clamped to the ends. */
export function moveKey(
  order: readonly string[],
  key: string,
  delta: number,
): readonly string[] {
  const from = order.indexOf(key);
  if (from === -1) return order;
  const to = Math.min(Math.max(from + delta, 0), order.length - 1);
  if (to === from) return order;
  const next = order.filter((candidate) => candidate !== key);
  next.splice(to, 0, key);
  return next;
}

/** The order with `key` placed before `before`, or last when `before` is null. */
export function placeKey(
  order: readonly string[],
  key: string,
  before: string | null,
): readonly string[] {
  if (key === before) return order;
  const next = order.filter((candidate) => candidate !== key);
  const at = before === null ? next.length : next.indexOf(before);
  next.splice(at === -1 ? next.length : at, 0, key);
  return next;
}
