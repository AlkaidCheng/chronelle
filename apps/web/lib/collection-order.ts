import { rankAfter, rankBetween } from "@chronelle/schemas";

interface Ranked {
  readonly id: string;
  readonly rank: string;
}

/** Ranks first, then ids, as the API lists a collection in manual order. */
export function byRank(a: Ranked, b: Ranked): number {
  return a.rank < b.rank
    ? -1
    : a.rank > b.rank
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;
}

/**
 * The rank of a record placed between two neighbours. When the neighbours
 * are not themselves in rank order (a subtask nested under its parent, a
 * group ordered by something else) the record goes just after the one
 * before it.
 */
export function rankBetweenRows(
  before: Ranked | undefined,
  after: Ranked | undefined,
): string {
  try {
    return rankBetween(before?.rank ?? null, after?.rank ?? null);
  } catch {
    return before === undefined
      ? rankAfter(after?.rank ?? null)
      : rankBetween(before.rank, null);
  }
}

/** The rows a record would sit between when dropped at an index among `rows`. */
export function rankAtIndex(rows: readonly Ranked[], index: number): string {
  return rankBetweenRows(rows[index - 1], rows[index]);
}

/**
 * Whether dropping a record at `index` among `rows` (which exclude it)
 * leaves it where it was in `from`: the same neighbours on both sides.
 */
export function staysInPlace(
  from: readonly Ranked[],
  id: string,
  rows: readonly Ranked[],
  index: number,
): boolean {
  const at = from.findIndex((row) => row.id === id);
  if (at < 0) return false;
  const others = from.filter((row) => row.id !== id);
  if (others.length !== rows.length) return false;
  if (others.some((row, position) => row.id !== rows[position]?.id))
    return false;
  return index === at;
}

/**
 * The rank that moves a record one place up or down among its rows: it
 * takes the midpoint beyond its neighbour, so only the moved record is
 * written. Null when it is already first or last.
 */
export function rankForStep(
  rows: readonly Ranked[],
  id: string,
  direction: -1 | 1,
): string | null {
  const at = rows.findIndex((row) => row.id === id);
  if (at < 0) return null;
  const target = at + direction;
  if (target < 0 || target >= rows.length) return null;
  return direction < 0
    ? rankBetweenRows(rows[target - 1], rows[target])
    : rankBetweenRows(rows[target], rows[target + 1]);
}
