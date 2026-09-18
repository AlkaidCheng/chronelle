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
