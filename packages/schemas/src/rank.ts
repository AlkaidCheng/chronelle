import { z } from "zod";

/**
 * A record's place in a collection's manual order: eleven digits, optionally
 * followed by a fraction with no trailing zero. Written this way, text order
 * is numeric order, so a database sorts ranks with a plain comparison, a new
 * item goes last by adding to the integer part, and an item dropped between
 * two others takes their midpoint without moving anyone else.
 */
export const rankSchema = z
  .string()
  .regex(/^[0-9]{11}(\.[0-9]*[1-9])?$/, "rank is a position in manual order.");

const integerDigits = 11;
const step = 1000n;

/** The rank after the last one in a collection, or the first rank of an empty one. */
export function rankAfter(last: string | null): string {
  const integer = last === null ? 0n : BigInt(last.slice(0, integerDigits));
  return String(integer + step).padStart(integerDigits, "0");
}

/**
 * A rank between two neighbours: `before` may be null at the start and
 * `after` null at the end. Neighbours must be in order and distinct.
 */
export function rankBetween(
  before: string | null,
  after: string | null,
): string {
  if (before === null && after === null) return rankAfter(null);
  if (after === null) return rankAfter(before);
  if (before !== null && before >= after)
    throw new RangeError("Ranks must be in order.");
  const low = before ?? "0".repeat(integerDigits);
  // The midpoint of two decimals, at whatever precision separates them.
  const scale = Math.max(fraction(low).length, fraction(after).length) + 1;
  const sum = scaled(low, scale) + scaled(after, scale);
  const midpoint = sum / 2n;
  return format(midpoint, scale);
}

function fraction(rank: string): string {
  return rank.slice(integerDigits + 1);
}

function scaled(rank: string, scale: number): bigint {
  const digits = fraction(rank).padEnd(scale, "0");
  return BigInt(rank.slice(0, integerDigits) + digits);
}

function format(value: bigint, scale: number): string {
  const text = value.toString().padStart(integerDigits + scale, "0");
  const integer = text.slice(0, text.length - scale);
  const decimals = text.slice(text.length - scale).replace(/0+$/, "");
  return decimals === "" ? integer : `${integer}.${decimals}`;
}
