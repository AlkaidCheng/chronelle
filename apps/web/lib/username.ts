/** The shape a username takes: 3 to 30 letters, digits, hyphens or underscores, starting with a letter. */
export const usernameShape = /^[A-Za-z][A-Za-z0-9_-]{2,29}$/u;

/**
 * A username to offer from a display name: its Latin letters and digits,
 * lowercased, with runs of anything else as one hyphen; padded to three
 * characters and started with a letter when the name gives none.
 */
export function suggestUsername(displayName: string): string {
  const base = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 30);
  const started = /^[a-z]/u.test(base) ? base : `u${base}`.slice(0, 30);
  return started.length >= 3
    ? started
    : `${started}${"x".repeat(3)}`.slice(0, 3);
}
